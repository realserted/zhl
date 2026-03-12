import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Public endpoint called right after signUp to create the zhl_accounts record.
 * Uses the service role key to bypass RLS (the user has no confirmed session yet).
 */
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server config missing.' }, { status: 500 });
  }

  const body = await req.json().catch(() => null) as {
    user_id?: string;
    display_name?: string;
    email?: string;
    phone?: string | null;
    descriptor?: string | null;
    company_name?: string | null;
    person_name?: string | null;
    username?: string | null;
    account_number?: string | null;
    notes?: string | null;
  } | null;

  if (!body?.user_id || !body?.display_name || !body?.email) {
    return NextResponse.json({ error: 'user_id, display_name, and email are required.' }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await adminClient.from('zhl_accounts').upsert(
    [{
      user_id: body.user_id,
      display_name: body.display_name,
      email: body.email,
      phone: body.phone || null,
      password_hash: 'managed_by_supabase_auth',
      descriptor: body.descriptor || null,
      company_name: body.company_name || null,
      person_name: body.person_name || null,
      username: body.username || null,
      account_number: body.account_number || null,
      notes: body.notes || null,
    }],
    { onConflict: 'user_id' }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
