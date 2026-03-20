-- Add soft-clear support to notifications
-- cleared_at is set when a user "clears" their inbox; rows are never deleted.
-- The app filters out cleared notifications on read, but they remain for monitoring.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_cleared
  ON public.notifications(user_id, cleared_at);
