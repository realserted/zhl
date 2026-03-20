-- Unit Data Views: stores view configurations per project
CREATE TABLE IF NOT EXISTS public.unit_data_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  view_name VARCHAR(100) NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL = project view, set = personal view
  field_visibility JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_project_view UNIQUE NULLS NOT DISTINCT (project_id, view_name, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ud_views_project ON public.unit_data_views(project_id);
CREATE INDEX IF NOT EXISTS idx_ud_views_user ON public.unit_data_views(user_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_ud_views_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ud_views_updated_at_trigger ON public.unit_data_views;
CREATE TRIGGER ud_views_updated_at_trigger
BEFORE UPDATE ON public.unit_data_views
FOR EACH ROW
EXECUTE FUNCTION public.update_ud_views_updated_at();

-- RLS
ALTER TABLE public.unit_data_views ENABLE ROW LEVEL SECURITY;

-- Project owners can manage all views
CREATE POLICY "Owner access" ON public.unit_data_views
  FOR ALL USING (public.is_project_owner(project_id));

-- Users can read project views (user_id IS NULL) for projects they can access
CREATE POLICY "Members can view project views" ON public.unit_data_views
  FOR SELECT USING (user_id IS NULL AND public.has_project_access(project_id));

-- Users can manage their own personal views
CREATE POLICY "Users can insert personal views" ON public.unit_data_views
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.has_project_access(project_id));

CREATE POLICY "Users can update personal views" ON public.unit_data_views
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete personal views" ON public.unit_data_views
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "Users can read personal views" ON public.unit_data_views
  FOR SELECT USING (user_id = auth.uid());

-- Admin access
CREATE POLICY "Admin access" ON public.unit_data_views
  FOR ALL USING (public.is_admin());

-- Add unit_data_view column to project_permissions
ALTER TABLE public.project_permissions
ADD COLUMN IF NOT EXISTS unit_data_view VARCHAR(100) DEFAULT 'All Project Users';
