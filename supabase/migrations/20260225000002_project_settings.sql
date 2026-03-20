-- Per-project configurable settings (thresholds, feature flags, etc.)

CREATE TABLE IF NOT EXISTS public.project_settings (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                          UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Status threshold: Taskers without comments
  threshold_tw_comments_critical      INT  NOT NULL DEFAULT 5,
  threshold_tw_comments_problematic   INT  NOT NULL DEFAULT 3,
  threshold_tw_comments_good          INT  NOT NULL DEFAULT 1,

  -- Status threshold: Overdue taskers
  threshold_overdue_critical          INT  NOT NULL DEFAULT 5,
  threshold_overdue_problematic       INT  NOT NULL DEFAULT 3,
  threshold_overdue_good              INT  NOT NULL DEFAULT 1,

  -- Status threshold: Unit Data % complete (lower % = worse)
  threshold_unit_data_critical        INT  NOT NULL DEFAULT 70,
  threshold_unit_data_problematic     INT  NOT NULL DEFAULT 80,
  threshold_unit_data_good            INT  NOT NULL DEFAULT 95,

  -- Unit Data feature flags
  allow_user_customization            BOOLEAN NOT NULL DEFAULT false,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (project_id)
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_project_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_project_settings_updated_at ON public.project_settings;
CREATE TRIGGER trg_project_settings_updated_at
  BEFORE UPDATE ON public.project_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_project_settings_updated_at();

-- RLS
ALTER TABLE public.project_settings ENABLE ROW LEVEL SECURITY;

-- Project owners and members can read settings
CREATE POLICY "Project members can read settings"
  ON public.project_settings FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM public.project_permissions WHERE project_id = project_settings.project_id AND user_id = auth.uid())
  );

-- Only the project owner can write settings
CREATE POLICY "Project owners can write settings"
  ON public.project_settings FOR ALL
  USING  (public.is_project_owner(project_id))
  WITH CHECK (public.is_project_owner(project_id));
