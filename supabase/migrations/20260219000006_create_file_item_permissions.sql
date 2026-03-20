-- File-level permissions (mirrors folder permissions but keyed on file_id)

CREATE TABLE IF NOT EXISTS public.project_file_item_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES public.project_files(id) ON DELETE CASCADE,
  allow_all_users BOOLEAN NOT NULL DEFAULT false,
  allow_project_manager BOOLEAN NOT NULL DEFAULT false,
  allow_property_manager BOOLEAN NOT NULL DEFAULT false,
  allow_accountant BOOLEAN NOT NULL DEFAULT false,
  allow_anyone_with_link BOOLEAN NOT NULL DEFAULT false,
  link_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(file_id)
);
CREATE INDEX IF NOT EXISTS idx_project_file_item_permissions_project ON public.project_file_item_permissions(project_id);

DROP TRIGGER IF EXISTS project_file_item_permissions_updated_at_trigger ON public.project_file_item_permissions;
CREATE TRIGGER project_file_item_permissions_updated_at_trigger
BEFORE UPDATE ON public.project_file_item_permissions
FOR EACH ROW
EXECUTE FUNCTION public.update_project_files_updated_at();

ALTER TABLE public.project_file_item_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view file permissions" ON public.project_file_item_permissions
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Users can insert file permissions" ON public.project_file_item_permissions
  FOR INSERT WITH CHECK (public.has_project_access(project_id));
CREATE POLICY "Users can update file permissions" ON public.project_file_item_permissions
  FOR UPDATE USING (public.has_project_access(project_id));
CREATE POLICY "Users can delete file permissions" ON public.project_file_item_permissions
  FOR DELETE USING (public.has_project_access(project_id));
