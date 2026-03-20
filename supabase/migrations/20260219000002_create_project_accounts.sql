-- Secure project accounts vault
-- Stores sensitive credentials and contact info per project

CREATE TABLE IF NOT EXISTS public.project_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  account_name TEXT,
  descriptor TEXT,
  company_name TEXT,
  person_name TEXT,
  phone TEXT,
  email TEXT,
  link TEXT,
  username TEXT,
  password TEXT,
  account_number TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_accounts_project_id ON public.project_accounts(project_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_project_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_accounts_updated_at_trigger ON public.project_accounts;
CREATE TRIGGER project_accounts_updated_at_trigger
BEFORE UPDATE ON public.project_accounts
FOR EACH ROW
EXECUTE FUNCTION public.update_project_accounts_updated_at();

-- Enable RLS
ALTER TABLE public.project_accounts ENABLE ROW LEVEL SECURITY;

-- Owner full access
CREATE POLICY "Project owners can manage accounts" ON public.project_accounts
  FOR ALL USING (public.is_project_owner(project_id));

-- Members can read accounts for their projects
CREATE POLICY "Members can view project accounts" ON public.project_accounts
  FOR SELECT USING (public.is_project_member(project_id));

-- Members can insert accounts
CREATE POLICY "Members can insert project accounts" ON public.project_accounts
  FOR INSERT WITH CHECK (public.is_project_member(project_id));

-- Members can update accounts
CREATE POLICY "Members can update project accounts" ON public.project_accounts
  FOR UPDATE USING (public.is_project_member(project_id));

-- Members can delete accounts
CREATE POLICY "Members can delete project accounts" ON public.project_accounts
  FOR DELETE USING (public.is_project_member(project_id));
