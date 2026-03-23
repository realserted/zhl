-- Add timezone column to project settings
ALTER TABLE public.zhl_project_settings
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(255) NOT NULL DEFAULT '';
