-- Add AI prompt columns to project_settings and financial_bank_types

ALTER TABLE public.zhl_project_settings
  ADD COLUMN IF NOT EXISTS tasker_name_ai_prompt TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS status_ai_prompt TEXT DEFAULT '';

ALTER TABLE public.zhl_financial_bank_types
  ADD COLUMN IF NOT EXISTS ai_prompt TEXT DEFAULT '';
