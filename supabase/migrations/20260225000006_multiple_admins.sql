-- Allow multiple admin accounts (was previously limited to 1)
DROP INDEX IF EXISTS one_admin_only;

-- Drop the trigger entirely (DISABLE doesn't work reliably in SQL Editor)
DROP TRIGGER IF EXISTS guard_admin_flag_trigger ON public.accounts;

-- Create AdminJPs admin account if the auth user exists
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'adminjps@zhl.com' LIMIT 1;
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.accounts (user_id, display_name, email, phone, password_hash, is_admin)
    VALUES (v_user_id, 'AdminJPs', 'adminjps@zhl.com', NULL, 'managed_by_supabase_auth', true)
    ON CONFLICT (email) DO UPDATE SET is_admin = true, display_name = 'AdminJPs';
  END IF;
END $$;

-- Create AdminGPs admin account if the auth user exists
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'admingps@zhl.com' LIMIT 1;
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.accounts (user_id, display_name, email, phone, password_hash, is_admin)
    VALUES (v_user_id, 'AdminGPs', 'admingps@zhl.com', NULL, 'managed_by_supabase_auth', true)
    ON CONFLICT (email) DO UPDATE SET is_admin = true, display_name = 'AdminGPs';
  END IF;
END $$;

-- Recreate the trigger
CREATE TRIGGER guard_admin_flag_trigger
BEFORE INSERT OR UPDATE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.guard_admin_flag();
