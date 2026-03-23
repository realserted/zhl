-- Update admin account from admin@zhl.com to presaling@gmail.com

-- 1. Update the auto_set_admin trigger to recognize the new admin email
CREATE OR REPLACE FUNCTION public.auto_set_admin()
RETURNS trigger AS $$
BEGIN
  IF NEW.email = 'presaling@gmail.com' THEN
    NEW.is_admin := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Remove admin flag from old account
UPDATE public.zhl_accounts SET is_admin = false WHERE email = 'admin@zhl.com';

-- 3. Disable guard trigger, set admin flag on new account, re-enable
ALTER TABLE public.zhl_accounts DISABLE TRIGGER guard_admin_flag_trigger;
UPDATE public.zhl_accounts SET is_admin = true WHERE email = 'presaling@gmail.com';
ALTER TABLE public.zhl_accounts ENABLE TRIGGER guard_admin_flag_trigger;
