/**
 * Seed Extra Admin Accounts (AdminJPs + AdminGPs)
 *
 * Step 1: Creates auth users + account rows (with is_admin = false to bypass trigger)
 * Step 2: Prints SQL to run in Supabase SQL Editor to drop the one_admin_only index,
 *         disable the guard trigger, and set is_admin = true.
 *
 * Usage:
 *   npx tsx scripts/seed-extra-admins.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
  process.exit(1);
}

const ADMINS = [
  { email: 'adminjps@zhl.com', password: 'AdminJPs2026!', displayName: 'AdminJPs' },
  { email: 'admingps@zhl.com', password: 'AdminGPs2026!', displayName: 'AdminGPs' },
];

async function main() {
  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('Seeding extra admin accounts...\n');

  const createdEmails: string[] = [];

  for (const admin of ADMINS) {
    // Check if account already exists
    const { data: existing } = await supabase
      .from('zhl_accounts')
      .select('id, email, is_admin')
      .eq('email', admin.email)
      .maybeSingle();

    if (existing?.is_admin) {
      console.log(`  Already exists as admin: ${admin.email}`);
      continue;
    }

    // Step 1: Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: admin.email,
      password: admin.password,
      email_confirm: true,
      user_metadata: { display_name: admin.displayName },
    });

    let userId: string;

    if (authError) {
      if (authError.message.includes('already been registered')) {
        console.log(`  Auth user already exists for ${admin.email}. Looking up user ID...`);
        const { data: users } = await supabase.auth.admin.listUsers();
        const authUser = users?.users.find((u) => u.email === admin.email);
        if (!authUser) {
          console.error(`  Could not find auth user for ${admin.email}. Skipping.`);
          continue;
        }
        userId = authUser.id;
      } else {
        console.error(`  Error creating auth user for ${admin.email}:`, authError.message);
        continue;
      }
    } else {
      userId = authData.user.id;
      console.log(`  Auth user created: ${admin.email}`);
    }

    // Step 2: Insert account row WITHOUT is_admin (bypasses guard trigger)
    if (!existing) {
      const { error } = await supabase.from('zhl_accounts').insert({
        user_id: userId,
        display_name: admin.displayName,
        email: admin.email,
        phone: null,
        password_hash: 'managed_by_supabase_auth',
        is_admin: false,
      });
      if (error) {
        console.error(`  Error creating account for ${admin.email}:`, error.message);
        continue;
      }
      console.log(`  Account created: ${admin.displayName} (${admin.email})`);
    } else {
      console.log(`  Account already exists: ${admin.email} (is_admin=${existing.is_admin})`);
    }

    createdEmails.push(admin.email);
  }

  // Step 3: Print the SQL to run in Supabase SQL Editor
  console.log('\n========================================');
  console.log('Auth users and account rows are ready.');
  console.log('Now run this SQL in Supabase SQL Editor:');
  console.log('========================================\n');

  const emails = ADMINS.map((a) => `'${a.email}'`).join(', ');
  console.log(`-- Drop the one-admin-only constraint
DROP INDEX IF EXISTS one_admin_only;

-- Drop the trigger entirely (DISABLE doesn't work in SQL Editor)
DROP TRIGGER IF EXISTS guard_admin_flag_trigger ON public.accounts;

-- Set is_admin = true for the new admins
UPDATE public.accounts SET is_admin = true WHERE email IN (${emails});

-- Recreate the trigger
CREATE TRIGGER guard_admin_flag_trigger
BEFORE INSERT OR UPDATE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.guard_admin_flag();`);

  console.log('\n========================================');
  console.log('Credentials:');
  for (const admin of ADMINS) {
    console.log(`  ${admin.displayName}: ${admin.email} / ${admin.password}`);
  }
  console.log('========================================');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
