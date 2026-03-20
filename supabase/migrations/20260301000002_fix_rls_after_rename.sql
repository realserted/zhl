-- Fix all functions and RLS policies that reference old table names after rename

-- 1) is_admin() references public.accounts → zhl_accounts
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.zhl_accounts WHERE user_id = auth.uid() AND is_admin = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2) auto_set_admin() trigger function (references admin emails, trigger is on accounts table)
--    Trigger itself moves with the table rename, no change needed for the function body

-- 3) admin_requests policies that inline-reference public.accounts
DROP POLICY IF EXISTS "Users read own requests; admins read all" ON public.zhl_admin_requests;
CREATE POLICY "Users read own requests; admins read all"
  ON public.zhl_admin_requests FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.zhl_accounts WHERE user_id = auth.uid() AND is_admin = true)
  );

DROP POLICY IF EXISTS "Admins can update requests" ON public.zhl_admin_requests;
CREATE POLICY "Admins can update requests"
  ON public.zhl_admin_requests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.zhl_accounts WHERE user_id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "Admins can delete requests" ON public.zhl_admin_requests;
CREATE POLICY "Admins can delete requests"
  ON public.zhl_admin_requests FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.zhl_accounts WHERE user_id = auth.uid() AND is_admin = true));

-- 4) unit_data_recovery_requests policies that inline-reference old table names
DROP POLICY IF EXISTS "Project members and admins can view recovery requests" ON public.zhl_unit_data_recovery_requests;
CREATE POLICY "Project members and admins can view recovery requests"
  ON public.zhl_unit_data_recovery_requests FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.zhl_projects WHERE id = project_id AND owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.zhl_project_permissions WHERE project_id = zhl_unit_data_recovery_requests.project_id AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.zhl_accounts WHERE user_id = auth.uid() AND is_admin = true)
  );

DROP POLICY IF EXISTS "Admins can update recovery requests" ON public.zhl_unit_data_recovery_requests;
CREATE POLICY "Admins can update recovery requests"
  ON public.zhl_unit_data_recovery_requests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.zhl_accounts WHERE user_id = auth.uid() AND is_admin = true));

-- 5) unit_data_values policy that references unit_data_rows
DROP POLICY IF EXISTS "Members can manage values" ON public.zhl_unit_data_values;
CREATE POLICY "Members can manage values"
  ON public.zhl_unit_data_values FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.zhl_unit_data_rows r WHERE r.id = row_id AND (public.has_project_access(r.project_id) OR public.is_admin()))
  );
