-- RPC to return admin user IDs (bypasses RLS via SECURITY DEFINER)
-- Used by UserLogsPage to hide admin logs from non-admin viewers

CREATE OR REPLACE FUNCTION public.get_admin_user_ids()
RETURNS SETOF UUID AS $$
  SELECT user_id FROM public.zhl_accounts WHERE is_admin = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- RPC to return display names for all accounts (bypasses RLS via SECURITY DEFINER)
-- Used by UserLogsPage to resolve display names for all users

CREATE OR REPLACE FUNCTION public.get_account_display_names()
RETURNS TABLE(user_id UUID, display_name TEXT) AS $$
  SELECT a.user_id, a.display_name::TEXT FROM public.zhl_accounts a;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
