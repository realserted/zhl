-- Add admin access to project_permissions for project settings
CREATE POLICY "Admins can view all project permissions" ON public.project_permissions
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can manage all project permissions" ON public.project_permissions
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update all project permissions" ON public.project_permissions
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "Admins can delete all project permissions" ON public.project_permissions
  FOR DELETE USING (public.is_admin());
