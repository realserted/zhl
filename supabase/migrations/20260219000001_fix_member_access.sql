-- ============================================================
-- FIX: Robust member project access
--
-- All email lookups now use auth.users (not public.accounts)
-- ============================================================

-- 1) SECURITY DEFINER function to self-link user_id in project_permissions
--    Called by the client on login to fill in user_id where it's NULL
CREATE OR REPLACE FUNCTION public.link_user_permissions(p_user_id UUID, p_email TEXT)
RETURNS void AS $$
  UPDATE public.project_permissions
  SET user_id = p_user_id
  WHERE lower(user_email) = lower(p_email)
    AND user_id IS NULL;
$$ LANGUAGE sql SECURITY DEFINER;

-- 2) SECURITY DEFINER helper: does this user have a permission row for this project?
--    Queries auth.users for the email, bypasses all RLS
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_permissions
    WHERE project_id = p_project_id
      AND (
        user_id = auth.uid()
        OR lower(user_email) = (
          SELECT lower(email) FROM auth.users WHERE id = auth.uid() LIMIT 1
        )
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 3) Replace ALL projects SELECT policies with one robust policy
DROP POLICY IF EXISTS "Owners can view their projects" ON public.projects;
DROP POLICY IF EXISTS "Members can view projects they belong to" ON public.projects;
DROP POLICY IF EXISTS "Members can view projects by email" ON public.projects;

CREATE POLICY "Users can view their projects" ON public.projects
  FOR SELECT USING (
    auth.uid() = owner_id
    OR public.is_project_member(id)
  );

-- 4) Replace project_permissions SELECT policies for members
DROP POLICY IF EXISTS "Users can view their own permissions" ON public.project_permissions;
DROP POLICY IF EXISTS "Members can view their own permissions by email" ON public.project_permissions;
DROP POLICY IF EXISTS "Members can view their own permissions" ON public.project_permissions;

CREATE POLICY "Members can view their own permissions" ON public.project_permissions
  FOR SELECT USING (
    public.is_project_owner(project_id)
    OR user_id = auth.uid()
    OR lower(user_email) = (
      SELECT lower(email) FROM auth.users WHERE id = auth.uid() LIMIT 1
    )
  );

-- 5) Fix the self-link update policy to use auth.users for email
DROP POLICY IF EXISTS "Members can self-link user_id" ON public.project_permissions;
CREATE POLICY "Members can self-link user_id" ON public.project_permissions
  FOR UPDATE USING (
    lower(user_email) = (
      SELECT lower(email) FROM auth.users WHERE id = auth.uid() LIMIT 1
    )
  )
  WITH CHECK (
    lower(user_email) = (
      SELECT lower(email) FROM auth.users WHERE id = auth.uid() LIMIT 1
    )
  );
