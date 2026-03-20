-- Apps Script fields are no longer required — Drive API is called directly
ALTER TABLE public.zhl_project_drive_config
  ALTER COLUMN apps_script_url DROP NOT NULL,
  ALTER COLUMN apps_script_api_key DROP NOT NULL;

-- Set defaults to null for new rows
ALTER TABLE public.zhl_project_drive_config
  ALTER COLUMN apps_script_url SET DEFAULT NULL,
  ALTER COLUMN apps_script_api_key SET DEFAULT NULL;
