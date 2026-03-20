-- ============================================================
-- Secure Admin: Remove insecure trigger, enforce single admin
-- ============================================================

-- 1. Drop the insecure email-based auto-admin trigger and function
DROP TRIGGER IF EXISTS set_admin_on_insert ON public.accounts;
DROP FUNCTION IF EXISTS public.auto_set_admin();

-- 2. Unique partial index: only ONE row can have is_admin = true
CREATE UNIQUE INDEX IF NOT EXISTS one_admin_only
  ON public.accounts ((true))
  WHERE is_admin = true;

-- 3. Trigger to prevent setting is_admin = true via normal operations.
--    Only the service_role (used by the seed script) can create admin accounts.
--    Regular authenticated/anon users are blocked.
CREATE OR REPLACE FUNCTION public.guard_admin_flag()
RETURNS trigger AS $$
BEGIN
  -- On INSERT: block is_admin = true unless called via service_role
  IF TG_OP = 'INSERT' AND NEW.is_admin = true THEN
    IF coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Cannot create admin accounts through normal operations';
    END IF;
  END IF;

  -- On UPDATE: block promoting any account to admin (unless service_role)
  IF TG_OP = 'UPDATE' AND OLD.is_admin = false AND NEW.is_admin = true THEN
    IF coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Cannot promote accounts to admin';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_admin_flag_trigger ON public.accounts;
CREATE TRIGGER guard_admin_flag_trigger
BEFORE INSERT OR UPDATE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.guard_admin_flag();
