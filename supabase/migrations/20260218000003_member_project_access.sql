-- Allow members to see projects they are added to by email
-- (covers cases where user_id is not yet linked in project_permissions)
DROP POLICY IF EXISTS "Members can view projects by email" ON public.projects;
CREATE POLICY "Members can view projects by email" ON public.projects
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.project_permissions pp
      WHERE pp.project_id = id
        AND pp.user_email = (
          SELECT email FROM public.accounts WHERE user_id = auth.uid() LIMIT 1
        )
    )
  );

-- Allow members to view their own permission record by email
-- (covers cases where user_id is not yet set)
DROP POLICY IF EXISTS "Members can view their own permissions by email" ON public.project_permissions;
CREATE POLICY "Members can view their own permissions by email" ON public.project_permissions
  FOR SELECT USING (
    user_email = (
      SELECT email FROM public.accounts WHERE user_id = auth.uid() LIMIT 1
    )
  );

-- Allow members to update their own user_id (self-link on first login)
DROP POLICY IF EXISTS "Members can self-link user_id" ON public.project_permissions;
CREATE POLICY "Members can self-link user_id" ON public.project_permissions
  FOR UPDATE USING (
    user_email = (
      SELECT email FROM public.accounts WHERE user_id = auth.uid() LIMIT 1
    )
  )
  WITH CHECK (
    user_email = (
      SELECT email FROM public.accounts WHERE user_id = auth.uid() LIMIT 1
    )
  );
