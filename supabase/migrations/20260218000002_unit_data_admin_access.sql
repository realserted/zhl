-- Allow admins to insert/update/delete unit data tables

-- Drop and recreate categories INSERT policy with admin access
DROP POLICY IF EXISTS "Users can insert categories for their projects" ON public.unit_data_categories;
CREATE POLICY "Users can insert categories for their projects" ON public.unit_data_categories
  FOR INSERT WITH CHECK (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can update categories for their projects" ON public.unit_data_categories;
CREATE POLICY "Users can update categories for their projects" ON public.unit_data_categories
  FOR UPDATE USING (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete categories for their projects" ON public.unit_data_categories;
CREATE POLICY "Users can delete categories for their projects" ON public.unit_data_categories
  FOR DELETE USING (public.has_project_access(project_id) OR public.is_admin());

-- Drop and recreate fields INSERT policy with admin access
DROP POLICY IF EXISTS "Users can insert fields for their projects" ON public.unit_data_fields;
CREATE POLICY "Users can insert fields for their projects" ON public.unit_data_fields
  FOR INSERT WITH CHECK (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can update fields for their projects" ON public.unit_data_fields;
CREATE POLICY "Users can update fields for their projects" ON public.unit_data_fields
  FOR UPDATE USING (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete fields for their projects" ON public.unit_data_fields;
CREATE POLICY "Users can delete fields for their projects" ON public.unit_data_fields
  FOR DELETE USING (public.has_project_access(project_id) OR public.is_admin());

-- Drop and recreate rows INSERT policy with admin access
DROP POLICY IF EXISTS "Users can insert rows for their projects" ON public.unit_data_rows;
CREATE POLICY "Users can insert rows for their projects" ON public.unit_data_rows
  FOR INSERT WITH CHECK (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete rows for their projects" ON public.unit_data_rows;
CREATE POLICY "Users can delete rows for their projects" ON public.unit_data_rows
  FOR DELETE USING (public.has_project_access(project_id) OR public.is_admin());

-- Drop and recreate values policies with admin access
DROP POLICY IF EXISTS "Users can insert values" ON public.unit_data_values;
CREATE POLICY "Users can insert values" ON public.unit_data_values
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.unit_data_rows r WHERE r.id = row_id AND public.has_project_access(r.project_id))
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Users can update values" ON public.unit_data_values;
CREATE POLICY "Users can update values" ON public.unit_data_values
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.unit_data_rows r WHERE r.id = row_id AND public.has_project_access(r.project_id))
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Users can delete values" ON public.unit_data_values;
CREATE POLICY "Users can delete values" ON public.unit_data_values
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.unit_data_rows r WHERE r.id = row_id AND public.has_project_access(r.project_id))
    OR public.is_admin()
  );
