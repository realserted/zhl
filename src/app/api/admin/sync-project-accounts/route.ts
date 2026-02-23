import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return NextResponse.json({ error: 'Server is missing Supabase configuration.' }, { status: 500 });
  }

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: 'Missing auth token.' }, { status: 401 });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'Invalid auth token.' }, { status: 401 });
  }

  const { data: adminAccount, error: adminCheckErr } = await adminClient
    .from('accounts')
    .select('is_admin')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (adminCheckErr || adminAccount?.is_admin !== true) {
    return NextResponse.json({ error: 'Only admins can sync accounts.' }, { status: 403 });
  }

  // Ensure all auth users have a corresponding accounts row.
  const { data: existingAccounts } = await adminClient
    .from('accounts')
    .select('user_id');

  const existingUserIds = new Set(
    (existingAccounts ?? []).map((r) => r.user_id)
  );

  const perPage = 200;
  let page = 1;
  let inserted = 0;

  while (true) {
    const { data: usersData, error: usersErr } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (usersErr) {
      return NextResponse.json({ error: usersErr.message }, { status: 400 });
    }

    const users = usersData.users ?? [];
    if (users.length === 0) break;

    const rowsToInsert = users.flatMap((u) => {
      if (existingUserIds.has(u.id)) return [];
      const email = (u.email ?? '').trim().toLowerCase();
      if (!email) return [];

      const displayName =
        (u.user_metadata?.display_name ?? '').toString().trim() || email;
      const phone = (u.user_metadata?.phone ?? null) as string | null;

      existingUserIds.add(u.id);
      return [{
        user_id: u.id,
        display_name: displayName,
        email,
        phone,
        password_hash: 'managed_by_supabase_auth',
      }];
    });

    if (rowsToInsert.length > 0) {
      const { error: insertErr } = await adminClient.from('accounts').insert(rowsToInsert);
      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 400 });
      }
      inserted += rowsToInsert.length;
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return NextResponse.json({ ok: true, inserted });
}
