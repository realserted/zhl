-- User-submitted requests visible to admins

CREATE TABLE IF NOT EXISTS public.admin_requests (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name  TEXT        NOT NULL DEFAULT '',
  user_email TEXT        NOT NULL DEFAULT '',
  message    TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_requests ENABLE ROW LEVEL SECURITY;

-- Users can submit requests
CREATE POLICY "Users can submit requests"
  ON public.admin_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can read their own; admins can read all
CREATE POLICY "Users read own requests; admins read all"
  ON public.admin_requests FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.accounts WHERE user_id = auth.uid() AND is_admin = true)
  );

-- Only admins can update (mark resolved) or delete
CREATE POLICY "Admins can update requests"
  ON public.admin_requests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.accounts WHERE user_id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can delete requests"
  ON public.admin_requests FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.accounts WHERE user_id = auth.uid() AND is_admin = true));
