-- Look up a user's display_name by email (SECURITY DEFINER to bypass accounts RLS)
CREATE OR REPLACE FUNCTION public.lookup_display_name_by_email(p_email TEXT)
RETURNS TEXT AS $$
  SELECT display_name
  FROM public.accounts
  WHERE lower(email) = lower(p_email)
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
