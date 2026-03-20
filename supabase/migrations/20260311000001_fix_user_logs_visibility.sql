-- Only project owners (and admins) can view user logs for their projects
-- This replaces the restrictive "own logs only" policy

DROP POLICY IF EXISTS "Users can view their own logs" ON public.zhl_user_logs;
DROP POLICY IF EXISTS "Users can view project logs" ON public.zhl_user_logs;

-- Project owners can see all logs for projects they own
CREATE POLICY "Owners can view project logs" ON public.zhl_user_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.zhl_projects p
      WHERE p.id = zhl_user_logs.project_id AND p.owner_id = auth.uid()
    )
  );
