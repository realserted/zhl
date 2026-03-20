-- Initialize admin account by disabling trigger temporarily
-- Disable the guard trigger
ALTER TABLE public.accounts DISABLE TRIGGER guard_admin_flag_trigger;

-- Get the user_id for admin@zhl.com from auth.users and update/insert
DO $$
DECLARE
  admin_user_id UUID;
BEGIN
  -- Find the admin user in auth.users
  SELECT id INTO admin_user_id FROM auth.users WHERE email = 'admin@zhl.com' LIMIT 1;
  
  IF admin_user_id IS NOT NULL THEN
    -- Insert or update the admin account record with is_admin = true
    INSERT INTO public.accounts (user_id, display_name, email, phone, password_hash, is_admin)
    VALUES (admin_user_id, 'AdminJon', 'admin@zhl.com', NULL, 'managed_by_supabase_auth', true)
    ON CONFLICT (email) DO UPDATE SET is_admin = true;
  END IF;
END $$;

-- Re-enable the guard trigger
ALTER TABLE public.accounts ENABLE TRIGGER guard_admin_flag_trigger;
