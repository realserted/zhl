-- Fix circular RLS dependency between projects and project_permissions

-- Drop the problematic policies
DROP POLICY IF EXISTS "Project owners can manage permissions" ON public.project_permissions;

-- Create a SECURITY DEFINER function to check ownership without triggering RLS
CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project_id AND owner_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Re-create the policy using the function instead of a subquery
CREATE POLICY "Project owners can manage permissions" ON public.project_permissions
  FOR ALL USING (public.is_project_owner(project_id));
