-- Remove the auth.users foreign key from project_accounts.
-- This table is a standalone vault; rows are not tied to any auth user.

ALTER TABLE public.project_accounts
  ALTER COLUMN created_by DROP NOT NULL,
  ALTER COLUMN created_by SET DEFAULT NULL;

-- Also drop the FK constraint so the column no longer references auth.users
ALTER TABLE public.project_accounts
  DROP CONSTRAINT IF EXISTS project_accounts_created_by_fkey;
