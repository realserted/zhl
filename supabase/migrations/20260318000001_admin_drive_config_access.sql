-- Allow admin users to read drive config for any project
DROP POLICY IF EXISTS "Project members can read drive config" ON public.zhl_project_drive_config;

CREATE POLICY "Project members can read drive config" ON public.zhl_project_drive_config
  FOR SELECT USING (
    -- Project members via permissions
    EXISTS (
      SELECT 1 FROM public.zhl_project_permissions
      WHERE project_id = zhl_project_drive_config.project_id
        AND user_id = auth.uid()
    )
    OR
    -- Project owner
    EXISTS (
      SELECT 1 FROM public.zhl_projects
      WHERE id = zhl_project_drive_config.project_id
        AND owner_id = auth.uid()
    )
    OR
    -- Admin users
    EXISTS (
      SELECT 1 FROM public.zhl_accounts
      WHERE user_id = auth.uid()
        AND is_admin = true
    )
  );

-- Also allow admins to manage drive config (insert/update/delete)
DROP POLICY IF EXISTS "Project owners can manage drive config" ON public.zhl_project_drive_config;

CREATE POLICY "Project owners can manage drive config" ON public.zhl_project_drive_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.zhl_projects
      WHERE id = zhl_project_drive_config.project_id
        AND owner_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.zhl_accounts
      WHERE user_id = auth.uid()
        AND is_admin = true
    )
  );
