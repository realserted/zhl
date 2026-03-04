import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData } = await anonClient.auth.getUser(token);
  if (!userData?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = userData.user.id;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Revoke the Google token
  const { data: tokenRow } = await adminClient
    .from('zhl_google_tokens')
    .select('access_token')
    .eq('user_id', userId)
    .single();

  if (tokenRow?.access_token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${tokenRow.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => {});
  }

  // Delete all event mappings and the token row
  await adminClient.from('zhl_tasker_gcal_events').delete().eq('user_id', userId);
  await adminClient.from('zhl_google_tokens').delete().eq('user_id', userId);

  return NextResponse.json({ ok: true });
}
