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
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token.' }, { status: 401 });
  }

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
    return NextResponse.json({ error: 'Only admins can create users.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as {
    projectId?: string;
    email?: string;
    password?: string;
    displayName?: string;
    phone?: string | null;
    descriptor?: string | null;
    companyName?: string | null;
    personName?: string | null;
    username?: string | null;
    accountNumber?: string | null;
    notes?: string | null;
  } | null;

  const projectId = body?.projectId?.trim() ?? '';
  const email = body?.email?.trim().toLowerCase() ?? '';
  const password = body?.password ?? '';
  const displayName = body?.displayName?.trim() ?? '';
  const phone = body?.phone?.trim() || null;

  if (!projectId || !email || !displayName || password.length < 6) {
    return NextResponse.json(
      { error: 'Project, email, display name, and password (min 6 chars) are required.' },
      { status: 400 }
    );
  }

  const { data: createdUser, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, phone },
  });

  if (createErr || !createdUser.user) {
    return NextResponse.json({ error: createErr?.message ?? 'Failed to create auth user.' }, { status: 400 });
  }

  const { error: accountErr } = await adminClient.from('accounts').insert({
    user_id: createdUser.user.id,
    display_name: displayName,
    email,
    phone,
    password_hash: 'managed_by_supabase_auth',
    descriptor: body?.descriptor || null,
    company_name: body?.companyName || null,
    person_name: body?.personName || null,
    username: body?.username || null,
    account_number: body?.accountNumber || null,
    notes: body?.notes || null,
  });

  if (accountErr) {
    await adminClient.auth.admin.deleteUser(createdUser.user.id);
    return NextResponse.json({ error: accountErr.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: createdUser.user.id,
      email,
      display_name: displayName,
      phone,
    },
  });
}
