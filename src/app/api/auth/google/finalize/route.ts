import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

/**
 * POST /api/auth/google/finalize
 * Called when the OAuth callback couldn't identify the Supabase user from cookies.
 * The client sends the encrypted token data along with its Supabase Bearer token
 * so we can store the Google refresh token for the correct user.
 *
 * Body: { encrypted_refresh_token: string, google_email: string | null }
 */
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return NextResponse.json({ error: 'Server configuration incomplete.' }, { status: 500 });
  }

  // Authenticate the Supabase user
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token.' }, { status: 401 });
  }

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'Invalid auth token.' }, { status: 401 });
  }

  // Parse body
  const body = await req.json().catch(() => null) as {
    encrypted_refresh_token?: string;
    google_email?: string | null;
  } | null;

  if (!body?.encrypted_refresh_token) {
    return NextResponse.json({ error: 'Missing encrypted_refresh_token.' }, { status: 400 });
  }

  // Store the encrypted refresh token
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: upsertError } = await adminClient
    .from('zhl_google_tokens')
    .upsert(
      {
        user_id: userData.user.id,
        encrypted_refresh_token: body.encrypted_refresh_token,
        google_email: body.google_email || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (upsertError) {
    console.error('Failed to store Google token:', upsertError.message);
    return NextResponse.json({ error: 'Failed to store token.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
