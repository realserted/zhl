import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/crypto';

/**
 * GET /api/auth/google/callback
 * Handles the OAuth2 callback from Google. Exchanges auth code for tokens,
 * encrypts the refresh token, and stores it in the database.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!clientId || !clientSecret || !redirectUri || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server configuration incomplete.' }, { status: 500 });
  }

  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/?google_auth=error&reason=' + error, req.url));
  }

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code.' }, { status: 400 });
  }

  // Parse state to get returnUrl
  let returnUrl = '/';
  if (stateParam) {
    try {
      const parsed = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
      returnUrl = parsed.returnUrl || '/';
    } catch {
      // Ignore malformed state
    }
  }

  // Get the Supabase user from the cookie/session
  // The user must be logged in via Supabase before connecting Google
  const supabaseToken = req.cookies.get('sb-access-token')?.value
    || req.headers.get('authorization')?.replace('Bearer ', '');

  if (!supabaseToken) {
    // Try to get from Supabase auth cookie (standard name varies by project)
    const allCookies = req.cookies.getAll();
    const sbCookie = allCookies.find(c => c.name.includes('auth-token'));
    if (!sbCookie) {
      return NextResponse.redirect(new URL('/?google_auth=error&reason=not_logged_in', req.url));
    }
  }

  // Exchange authorization code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    console.error('Google token exchange failed:', err);
    return NextResponse.redirect(new URL('/?google_auth=error&reason=token_exchange_failed', req.url));
  }

  const tokens = await tokenResponse.json();
  const { access_token, refresh_token } = tokens;

  if (!refresh_token) {
    console.error('No refresh token received. User may need to revoke and re-authorize.');
    return NextResponse.redirect(new URL('/?google_auth=error&reason=no_refresh_token', req.url));
  }

  // Get user's Google email for display
  let googleEmail: string | null = null;
  try {
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (userInfoRes.ok) {
      const userInfo = await userInfoRes.json();
      googleEmail = userInfo.email || null;
    }
  } catch {
    // Non-critical — email is just for display
  }

  // We need the Supabase user ID. Since this is a redirect flow,
  // we'll pass the encrypted token info back to the client which will
  // call a separate endpoint to store it. This avoids complex cookie parsing.
  const encryptedRefreshToken = encrypt(refresh_token);

  // Use a service-role client to store the token
  // First, we need to identify the user. We'll use a temporary token approach:
  // Store with a temporary claim key, and the client will finalize it.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Try to get user from the Supabase session cookie
  // Supabase JS v2+ stores auth as chunked cookies: sb-<ref>-auth-token.0, .1, etc.
  // or as a single sb-<ref>-auth-token cookie.
  let userId: string | null = null;

  const allCookies = req.cookies.getAll();

  // Strategy 1: Reassemble chunked Supabase auth cookies
  const authCookieBase = allCookies
    .map(c => c.name)
    .find(n => n.match(/^sb-.*-auth-token/))
    ?.replace(/\.\d+$/, '');

  if (authCookieBase) {
    try {
      // Collect all chunks in order
      const chunks: Array<{ idx: number; value: string }> = [];
      for (const cookie of allCookies) {
        if (cookie.name === authCookieBase) {
          chunks.push({ idx: 0, value: cookie.value });
        } else if (cookie.name.startsWith(authCookieBase + '.')) {
          const idx = parseInt(cookie.name.split('.').pop() || '0', 10);
          chunks.push({ idx, value: cookie.value });
        }
      }
      chunks.sort((a, b) => a.idx - b.idx);
      const combined = chunks.map(c => c.value).join('');

      // Try to parse as base64url-encoded JSON
      let sessionData: { access_token?: string } | null = null;
      try {
        sessionData = JSON.parse(Buffer.from(combined, 'base64url').toString());
      } catch {
        try {
          sessionData = JSON.parse(Buffer.from(combined, 'base64').toString());
        } catch {
          try {
            sessionData = JSON.parse(decodeURIComponent(combined));
          } catch {
            // Not parseable
          }
        }
      }

      if (sessionData?.access_token) {
        const { data: userData } = await adminClient.auth.getUser(sessionData.access_token);
        if (userData?.user) {
          userId = userData.user.id;
        }
      }
    } catch {
      // Cookie parsing failed, will fall through to finalize
    }
  }

  // Strategy 2: Try each auth-looking cookie directly
  if (!userId) {
    for (const cookie of allCookies) {
      if (cookie.name.includes('auth-token') || cookie.name === 'sb-access-token') {
        try {
          const { data: userData } = await adminClient.auth.getUser(cookie.value);
          if (userData?.user) {
            userId = userData.user.id;
            break;
          }
        } catch {
          continue;
        }
      }
    }
  }

  if (!userId) {
    // Fallback: redirect with encrypted data, let client finalize
    const finalizeData = Buffer.from(JSON.stringify({
      encrypted_refresh_token: encryptedRefreshToken,
      google_email: googleEmail,
    })).toString('base64url');

    return NextResponse.redirect(
      new URL(`${returnUrl}?google_auth=finalize&data=${finalizeData}`, req.url)
    );
  }

  // Store the encrypted refresh token
  const { error: upsertError } = await adminClient
    .from('zhl_google_tokens')
    .upsert(
      {
        user_id: userId,
        encrypted_refresh_token: encryptedRefreshToken,
        google_email: googleEmail,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (upsertError) {
    console.error('Failed to store Google token:', upsertError.message);
    return NextResponse.redirect(new URL('/?google_auth=error&reason=storage_failed', req.url));
  }

  return NextResponse.redirect(new URL(`${returnUrl}?google_auth=success`, req.url));
}
