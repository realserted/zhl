-- Seed admin account for presaling@gmail.com
-- The auth user already exists (created by seed script), just need the zhl_accounts row

ALTER TABLE public.zhl_accounts DISABLE TRIGGER guard_admin_flag_trigger;

DO $$
DECLARE
  admin_user_id UUID;
BEGIN
  SELECT id INTO admin_user_id FROM auth.users WHERE email = 'presaling@gmail.com' LIMIT 1;

  IF admin_user_id IS NOT NULL THEN
    INSERT INTO public.zhl_accounts (user_id, display_name, email, phone, password_hash, is_admin)
    VALUES (admin_user_id, 'AdminJon', 'presaling@gmail.com', NULL, 'managed_by_supabase_auth', true)
    ON CONFLICT (email) DO UPDATE SET is_admin = true;
  END IF;
END $$;

ALTER TABLE public.zhl_accounts ENABLE TRIGGER guard_admin_flag_trigger;
