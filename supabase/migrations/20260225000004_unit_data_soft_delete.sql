-- Soft delete support for unit data categories and fields

ALTER TABLE public.unit_data_categories
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by  UUID REFERENCES auth.users(id);

ALTER TABLE public.unit_data_fields
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by  UUID REFERENCES auth.users(id);

-- Recovery requests: users ask admin to restore a soft-deleted field or category
CREATE TABLE IF NOT EXISTS public.unit_data_recovery_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requested_by    UUID        NOT NULL REFERENCES auth.users(id),
  requester_name  TEXT        NOT NULL DEFAULT '',
  item_type       TEXT        NOT NULL CHECK (item_type IN ('field', 'category')),
  item_id         UUID        NOT NULL,
  item_name       TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID        REFERENCES auth.users(id)
);

ALTER TABLE public.unit_data_recovery_requests ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can submit a recovery request
CREATE POLICY "Users can submit recovery requests"
  ON public.unit_data_recovery_requests FOR INSERT
  WITH CHECK (requested_by = auth.uid());

-- Project owner, members, and admins can view requests for that project
CREATE POLICY "Project members and admins can view recovery requests"
  ON public.unit_data_recovery_requests FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.projects      WHERE id = project_id AND owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.project_permissions WHERE project_id = unit_data_recovery_requests.project_id AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.accounts   WHERE user_id = auth.uid() AND is_admin = true)
  );

-- Only admins can approve / reject
CREATE POLICY "Admins can update recovery requests"
  ON public.unit_data_recovery_requests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.accounts WHERE user_id = auth.uid() AND is_admin = true));
