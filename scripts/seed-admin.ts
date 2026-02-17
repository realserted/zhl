/**
 * Admin Account Seed Script
 *
 * Creates the single admin account using the Supabase Admin API (service_role key).
 * The service_role bypasses RLS and is recognized by the guard_admin_flag trigger.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=<your-key> npx tsx scripts/seed-admin.ts
 *
 * Or add SUPABASE_SERVICE_ROLE_KEY to your .env file and run:
 *   npx tsx scripts/seed-admin.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually (no extra dependencies needed)
function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file not found — rely on environment variables
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables:');
  if (!SUPABASE_URL) console.error('  - NEXT_PUBLIC_SUPABASE_URL');
  if (!SERVICE_ROLE_KEY) console.error('  - SUPABASE_SERVICE_ROLE_KEY');
  console.error('\nAdd SUPABASE_SERVICE_ROLE_KEY to your .env file or pass it as an env variable.');
  console.error('You can find it in your Supabase dashboard → Settings → API → service_role key.');
  process.exit(1);
}

const ADMIN_EMAIL = 'admin@zhl.com';
const ADMIN_PASSWORD = 'AdminZHL2026!';
const ADMIN_DISPLAY_NAME = 'AdminJon';

async function seedAdmin() {
  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Check if admin already exists in accounts table
  const { data: existing } = await supabase
    .from('accounts')
    .select('id, email')
    .eq('is_admin', true)
    .maybeSingle();

  if (existing) {
    console.log(`Admin account already exists: ${existing.email}`);
    console.log('No changes made.');
    return;
  }

  // Step 1: Create auth user via Admin API
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: ADMIN_DISPLAY_NAME },
  });

  let userId: string;

  if (authError) {
    if (authError.message.includes('already been registered')) {
      console.log('Auth user already exists. Looking up user ID...');
      const { data: users } = await supabase.auth.admin.listUsers();
      const authUser = users?.users.find((u) => u.email === ADMIN_EMAIL);
      if (!authUser) {
        console.error('Could not find auth user. Aborting.');
        process.exit(1);
      }
      userId = authUser.id;
    } else {
      console.error('Error creating auth user:', authError.message);
      process.exit(1);
    }
  } else {
    userId = authData.user.id;
  }

  // Step 2: Insert into accounts with is_admin = true
  // The service_role key is recognized by the guard_admin_flag trigger
  const { error } = await supabase.from('accounts').insert({
    user_id: userId,
    display_name: ADMIN_DISPLAY_NAME,
    email: ADMIN_EMAIL,
    phone: null,
    password_hash: 'managed_by_supabase_auth',
    is_admin: true,
  });

  if (error) {
    console.error('Error creating admin account record:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('Admin account created successfully!');
  console.log('================================');
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  console.log(`  Name:     ${ADMIN_DISPLAY_NAME}`);
  console.log('================================');
}

seedAdmin().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
