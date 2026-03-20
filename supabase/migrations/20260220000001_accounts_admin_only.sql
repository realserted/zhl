-- Restrict project_accounts access to admins only

DROP POLICY IF EXISTS "Project owners can manage accounts" ON public.project_accounts;
DROP POLICY IF EXISTS "Members can view project accounts" ON public.project_accounts;
DROP POLICY IF EXISTS "Members can insert project accounts" ON public.project_accounts;
DROP POLICY IF EXISTS "Members can update project accounts" ON public.project_accounts;
DROP POLICY IF EXISTS "Members can delete project accounts" ON public.project_accounts;

CREATE POLICY "Admins can view project accounts" ON public.project_accounts
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can insert project accounts" ON public.project_accounts
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update project accounts" ON public.project_accounts
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "Admins can delete project accounts" ON public.project_accounts
  FOR DELETE USING (public.is_admin());
