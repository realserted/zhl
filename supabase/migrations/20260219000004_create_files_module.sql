-- Files module: folders, files, role permissions, custom fields, download/backup workflows

CREATE TABLE IF NOT EXISTS public.project_file_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_folder_id UUID REFERENCES public.project_file_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_file_folders_project ON public.project_file_folders(project_id);
CREATE INDEX IF NOT EXISTS idx_project_file_folders_parent ON public.project_file_folders(parent_folder_id);

CREATE TABLE IF NOT EXISTS public.project_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.project_file_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  storage_path TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON public.project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_project_files_folder ON public.project_files(folder_id);

CREATE TABLE IF NOT EXISTS public.project_file_folder_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES public.project_file_folders(id) ON DELETE CASCADE,
  allow_all_users BOOLEAN NOT NULL DEFAULT false,
  allow_project_manager BOOLEAN NOT NULL DEFAULT false,
  allow_property_manager BOOLEAN NOT NULL DEFAULT false,
  allow_accountant BOOLEAN NOT NULL DEFAULT false,
  allow_anyone_with_link BOOLEAN NOT NULL DEFAULT false,
  link_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(folder_id)
);
CREATE INDEX IF NOT EXISTS idx_project_file_folder_permissions_project ON public.project_file_folder_permissions(project_id);

CREATE TABLE IF NOT EXISTS public.project_file_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('folder', 'file')),
  warning_message TEXT,
  ignore_warning_days INT,
  required BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_file_custom_fields_project ON public.project_file_custom_fields(project_id);
CREATE INDEX IF NOT EXISTS idx_project_file_custom_fields_target ON public.project_file_custom_fields(target_type);

CREATE TABLE IF NOT EXISTS public.project_file_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_field_id UUID NOT NULL REFERENCES public.project_file_custom_fields(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.project_file_folders(id) ON DELETE CASCADE,
  file_id UUID REFERENCES public.project_files(id) ON DELETE CASCADE,
  value_text TEXT,
  ignored_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_project_file_custom_field_values_target CHECK (
    (folder_id IS NOT NULL AND file_id IS NULL) OR (folder_id IS NULL AND file_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_file_custom_field_values_folder
  ON public.project_file_custom_field_values(custom_field_id, folder_id)
  WHERE folder_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_file_custom_field_values_file
  ON public.project_file_custom_field_values(custom_field_id, file_id)
  WHERE file_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.project_file_download_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_file_download_logs_project ON public.project_file_download_logs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.project_file_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('system', 'manual')),
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_file_backups_project ON public.project_file_backups(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.project_file_backup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled')),
  response_note TEXT,
  responded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_file_backup_requests_project ON public.project_file_backup_requests(project_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_project_files_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_file_folder_permissions_updated_at_trigger ON public.project_file_folder_permissions;
CREATE TRIGGER project_file_folder_permissions_updated_at_trigger
BEFORE UPDATE ON public.project_file_folder_permissions
FOR EACH ROW
EXECUTE FUNCTION public.update_project_files_updated_at();

DROP TRIGGER IF EXISTS project_file_custom_field_values_updated_at_trigger ON public.project_file_custom_field_values;
CREATE TRIGGER project_file_custom_field_values_updated_at_trigger
BEFORE UPDATE ON public.project_file_custom_field_values
FOR EACH ROW
EXECUTE FUNCTION public.update_project_files_updated_at();

DROP TRIGGER IF EXISTS project_file_backup_requests_updated_at_trigger ON public.project_file_backup_requests;
CREATE TRIGGER project_file_backup_requests_updated_at_trigger
BEFORE UPDATE ON public.project_file_backup_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_project_files_updated_at();

ALTER TABLE public.project_file_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_file_folder_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_file_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_file_custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_file_download_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_file_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_file_backup_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view folders" ON public.project_file_folders
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Users can insert folders" ON public.project_file_folders
  FOR INSERT WITH CHECK (public.has_project_access(project_id));
CREATE POLICY "Users can update folders" ON public.project_file_folders
  FOR UPDATE USING (public.has_project_access(project_id));
CREATE POLICY "Users can delete folders" ON public.project_file_folders
  FOR DELETE USING (public.has_project_access(project_id));

CREATE POLICY "Users can view files" ON public.project_files
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Users can insert files" ON public.project_files
  FOR INSERT WITH CHECK (public.has_project_access(project_id));
CREATE POLICY "Users can update files" ON public.project_files
  FOR UPDATE USING (public.has_project_access(project_id));
CREATE POLICY "Users can delete files" ON public.project_files
  FOR DELETE USING (public.has_project_access(project_id));

CREATE POLICY "Users can view folder permissions" ON public.project_file_folder_permissions
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Users can insert folder permissions" ON public.project_file_folder_permissions
  FOR INSERT WITH CHECK (public.has_project_access(project_id));
CREATE POLICY "Users can update folder permissions" ON public.project_file_folder_permissions
  FOR UPDATE USING (public.has_project_access(project_id));
CREATE POLICY "Users can delete folder permissions" ON public.project_file_folder_permissions
  FOR DELETE USING (public.has_project_access(project_id));

CREATE POLICY "Users can view custom fields" ON public.project_file_custom_fields
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Users can insert custom fields" ON public.project_file_custom_fields
  FOR INSERT WITH CHECK (public.has_project_access(project_id));
CREATE POLICY "Users can update custom fields" ON public.project_file_custom_fields
  FOR UPDATE USING (public.has_project_access(project_id));
CREATE POLICY "Users can delete custom fields" ON public.project_file_custom_fields
  FOR DELETE USING (public.has_project_access(project_id));

CREATE POLICY "Users can view custom field values" ON public.project_file_custom_field_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.project_file_custom_fields f
      WHERE f.id = custom_field_id
        AND (public.has_project_access(f.project_id) OR public.is_admin())
    )
  );
CREATE POLICY "Users can insert custom field values" ON public.project_file_custom_field_values
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.project_file_custom_fields f
      WHERE f.id = custom_field_id
        AND public.has_project_access(f.project_id)
    )
  );
CREATE POLICY "Users can update custom field values" ON public.project_file_custom_field_values
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.project_file_custom_fields f
      WHERE f.id = custom_field_id
        AND public.has_project_access(f.project_id)
    )
  );
CREATE POLICY "Users can delete custom field values" ON public.project_file_custom_field_values
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.project_file_custom_fields f
      WHERE f.id = custom_field_id
        AND public.has_project_access(f.project_id)
    )
  );

CREATE POLICY "Users can view download logs" ON public.project_file_download_logs
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Users can insert download logs" ON public.project_file_download_logs
  FOR INSERT WITH CHECK (public.has_project_access(project_id));

CREATE POLICY "Users can view backups" ON public.project_file_backups
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Admins can insert backups" ON public.project_file_backups
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update backups" ON public.project_file_backups
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "Users can view backup requests" ON public.project_file_backup_requests
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Users can insert backup requests" ON public.project_file_backup_requests
  FOR INSERT WITH CHECK (public.has_project_access(project_id));
CREATE POLICY "Admins can update backup requests" ON public.project_file_backup_requests
  FOR UPDATE USING (public.is_admin());
