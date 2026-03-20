-- Projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON public.projects(owner_id);

-- Project permissions / users table
CREATE TABLE IF NOT EXISTS public.project_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name VARCHAR(255) NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  perm_taskers VARCHAR(50) NOT NULL DEFAULT 'View',
  perm_unit_data VARCHAR(50) NOT NULL DEFAULT 'View',
  perm_files VARCHAR(50) NOT NULL DEFAULT 'View',
  perm_accounts VARCHAR(50) NOT NULL DEFAULT 'View',
  perm_reports VARCHAR(50) NOT NULL DEFAULT 'View',
  perm_templates VARCHAR(50) NOT NULL DEFAULT 'View Only',
  perm_meetings VARCHAR(50) NOT NULL DEFAULT 'View',
  perm_user_logs VARCHAR(50) NOT NULL DEFAULT 'View / Don''t view',
  project_role VARCHAR(100) NOT NULL DEFAULT 'Project Manager',
  work_role VARCHAR(100) NOT NULL DEFAULT 'Administrative',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_project_permissions_project_id ON public.project_permissions(project_id);
CREATE INDEX IF NOT EXISTS idx_project_permissions_user_id ON public.project_permissions(user_id);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.update_project_permissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_permissions_updated_at_trigger ON public.project_permissions;
CREATE TRIGGER project_permissions_updated_at_trigger
BEFORE UPDATE ON public.project_permissions
FOR EACH ROW
EXECUTE FUNCTION public.update_project_permissions_updated_at();

-- SECURITY DEFINER helper to check project ownership without triggering RLS
-- This breaks the circular dependency between projects and project_permissions policies
CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project_id AND owner_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Enable RLS on both tables
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_permissions ENABLE ROW LEVEL SECURITY;

-- Projects policies
CREATE POLICY "Owners can view their projects" ON public.projects
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Owners can insert projects" ON public.projects
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update their projects" ON public.projects
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Owners can delete their projects" ON public.projects
  FOR DELETE USING (auth.uid() = owner_id);

-- Members can view projects they belong to (uses subquery on project_permissions,
-- which is safe because project_permissions policies use the SECURITY DEFINER function)
CREATE POLICY "Members can view projects they belong to" ON public.projects
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.project_permissions pp
      WHERE pp.project_id = id AND pp.user_id = auth.uid()
    )
  );

-- Project permissions policies (use SECURITY DEFINER function to avoid circular RLS)
CREATE POLICY "Project owners can manage permissions" ON public.project_permissions
  FOR ALL USING (public.is_project_owner(project_id));

CREATE POLICY "Users can view their own permissions" ON public.project_permissions
  FOR SELECT USING (auth.uid() = user_id);
