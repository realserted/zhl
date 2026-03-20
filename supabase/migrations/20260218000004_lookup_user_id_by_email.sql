-- SECURITY DEFINER function to look up a user's ID by their email address
-- Queries auth.users (the source of truth for user accounts)
CREATE OR REPLACE FUNCTION public.lookup_user_id_by_email(p_email TEXT)
RETURNS UUID AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- SECURITY DEFINER function to look up a user's info by display name
-- Used when assigning users to tasks by name
CREATE OR REPLACE FUNCTION public.lookup_account_by_name(p_name TEXT)
RETURNS TABLE(user_id UUID, display_name TEXT, email TEXT) AS $$
  SELECT u.id,
         COALESCE(u.raw_user_meta_data->>'display_name', u.email)::TEXT,
         u.email::TEXT
  FROM auth.users u
  WHERE lower(COALESCE(u.raw_user_meta_data->>'display_name', '')) = lower(p_name)
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
