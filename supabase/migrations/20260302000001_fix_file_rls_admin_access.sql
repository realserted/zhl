-- Fix file-related RLS policies: add OR is_admin() to INSERT/UPDATE/DELETE
-- Previously only SELECT policies included admin access

-- ── project_file_folders ──
DROP POLICY IF EXISTS "Users can insert folders" ON public.zhl_project_file_folders;
CREATE POLICY "Users can insert folders" ON public.zhl_project_file_folders
  FOR INSERT WITH CHECK (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can update folders" ON public.zhl_project_file_folders;
CREATE POLICY "Users can update folders" ON public.zhl_project_file_folders
  FOR UPDATE USING (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete folders" ON public.zhl_project_file_folders;
CREATE POLICY "Users can delete folders" ON public.zhl_project_file_folders
  FOR DELETE USING (public.has_project_access(project_id) OR public.is_admin());

-- ── project_files ──
DROP POLICY IF EXISTS "Users can insert files" ON public.zhl_project_files;
CREATE POLICY "Users can insert files" ON public.zhl_project_files
  FOR INSERT WITH CHECK (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can update files" ON public.zhl_project_files;
CREATE POLICY "Users can update files" ON public.zhl_project_files
  FOR UPDATE USING (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete files" ON public.zhl_project_files;
CREATE POLICY "Users can delete files" ON public.zhl_project_files
  FOR DELETE USING (public.has_project_access(project_id) OR public.is_admin());

-- ── project_file_folder_permissions ──
DROP POLICY IF EXISTS "Users can insert folder permissions" ON public.zhl_project_file_folder_permissions;
CREATE POLICY "Users can insert folder permissions" ON public.zhl_project_file_folder_permissions
  FOR INSERT WITH CHECK (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can update folder permissions" ON public.zhl_project_file_folder_permissions;
CREATE POLICY "Users can update folder permissions" ON public.zhl_project_file_folder_permissions
  FOR UPDATE USING (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete folder permissions" ON public.zhl_project_file_folder_permissions;
CREATE POLICY "Users can delete folder permissions" ON public.zhl_project_file_folder_permissions
  FOR DELETE USING (public.has_project_access(project_id) OR public.is_admin());

-- ── project_file_item_permissions ──
DROP POLICY IF EXISTS "Users can insert file permissions" ON public.zhl_project_file_item_permissions;
CREATE POLICY "Users can insert file permissions" ON public.zhl_project_file_item_permissions
  FOR INSERT WITH CHECK (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can update file permissions" ON public.zhl_project_file_item_permissions;
CREATE POLICY "Users can update file permissions" ON public.zhl_project_file_item_permissions
  FOR UPDATE USING (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete file permissions" ON public.zhl_project_file_item_permissions;
CREATE POLICY "Users can delete file permissions" ON public.zhl_project_file_item_permissions
  FOR DELETE USING (public.has_project_access(project_id) OR public.is_admin());

-- ── project_file_custom_fields ──
DROP POLICY IF EXISTS "Users can insert custom fields" ON public.zhl_project_file_custom_fields;
CREATE POLICY "Users can insert custom fields" ON public.zhl_project_file_custom_fields
  FOR INSERT WITH CHECK (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can update custom fields" ON public.zhl_project_file_custom_fields;
CREATE POLICY "Users can update custom fields" ON public.zhl_project_file_custom_fields
  FOR UPDATE USING (public.has_project_access(project_id) OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete custom fields" ON public.zhl_project_file_custom_fields;
CREATE POLICY "Users can delete custom fields" ON public.zhl_project_file_custom_fields
  FOR DELETE USING (public.has_project_access(project_id) OR public.is_admin());

-- ── project_file_download_logs ──
DROP POLICY IF EXISTS "Users can insert download logs" ON public.zhl_project_file_download_logs;
CREATE POLICY "Users can insert download logs" ON public.zhl_project_file_download_logs
  FOR INSERT WITH CHECK (public.has_project_access(project_id) OR public.is_admin());

-- ── project_file_backup_requests ──
DROP POLICY IF EXISTS "Users can insert backup requests" ON public.zhl_project_file_backup_requests;
CREATE POLICY "Users can insert backup requests" ON public.zhl_project_file_backup_requests
  FOR INSERT WITH CHECK (public.has_project_access(project_id) OR public.is_admin());
