import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/crypto';

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

/**
 * POST /api/auth/google/token
 * Returns a fresh Google access token for the authenticated user.
 * Never exposes the refresh token to the client.
 */
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!supabaseUrl || !serviceRoleKey || !anonKey || !clientId || !clientSecret) {
    return NextResponse.json({ error: 'Server configuration incomplete.' }, { status: 500 });
  }

  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token.' }, { status: 401 });
  }

  // Verify Supabase user
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'Invalid auth token.' }, { status: 401 });
  }

  // Fetch encrypted refresh token
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: tokenRow, error: fetchErr } = await adminClient
    .from('zhl_google_tokens')
    .select('encrypted_refresh_token')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (fetchErr || !tokenRow) {
    return NextResponse.json({ error: 'Google account not connected.' }, { status: 404 });
  }

  // Decrypt refresh token and exchange for access token
  let refreshToken: string;
  try {
    refreshToken = decrypt(tokenRow.encrypted_refresh_token);
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt stored token.' }, { status: 500 });
  }

  const googleRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!googleRes.ok) {
    const errText = await googleRes.text();
    console.error('Google token refresh failed:', errText);
    // If refresh token is revoked/expired, clean up
    if (googleRes.status === 400 || googleRes.status === 401) {
      await adminClient
        .from('zhl_google_tokens')
        .delete()
        .eq('user_id', userData.user.id);
      return NextResponse.json({ error: 'Google authorization expired. Please reconnect.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to refresh Google token.' }, { status: 502 });
  }

  const googleTokens = await googleRes.json();

  return NextResponse.json({
    access_token: googleTokens.access_token,
    expires_in: googleTokens.expires_in,
  });
}
