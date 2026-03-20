-- Allow authenticated users (e.g. project owners) to create notifications
-- for other users. Without this, client-side inserts are blocked by RLS when
-- the target user_id differs from auth.uid().
--
-- The function runs as the DB owner (SECURITY DEFINER), so it bypasses RLS.

CREATE OR REPLACE FUNCTION public.create_notification_for_user(
  p_user_id     UUID,
  p_type        TEXT,
  p_title       TEXT,
  p_message     TEXT,
  p_related_id  UUID    DEFAULT NULL,
  p_related_type TEXT   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
  VALUES (p_user_id, p_type, p_title, p_message, p_related_id, p_related_type);
END;
$$;

-- Any authenticated user may call this function (the caller's identity is
-- still available via auth.uid() inside the function if needed for auditing).
GRANT EXECUTE ON FUNCTION public.create_notification_for_user TO authenticated;
