-- Fix project_accounts owner RLS for INSERT operations.
-- FOR ALL USING without WITH CHECK does not reliably cover INSERT in Supabase.
-- Drop and recreate with explicit WITH CHECK so owners can insert rows.

DROP POLICY IF EXISTS "Project owners can manage accounts" ON public.project_accounts;

CREATE POLICY "Project owners can manage accounts" ON public.project_accounts
  FOR ALL
  USING (public.is_project_owner(project_id))
  WITH CHECK (public.is_project_owner(project_id));
