-- Google OAuth refresh tokens (per user)
CREATE TABLE public.zhl_google_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_refresh_token TEXT NOT NULL,
  google_email TEXT,
  connected_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.zhl_google_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own token" ON public.zhl_google_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role full access tokens" ON public.zhl_google_tokens
  FOR ALL USING (true) WITH CHECK (true);

-- Project Drive configuration
CREATE TABLE public.zhl_project_drive_config (
  project_id UUID PRIMARY KEY REFERENCES public.zhl_projects(id) ON DELETE CASCADE,
  root_folder_id TEXT NOT NULL,
  root_folder_url TEXT NOT NULL,
  apps_script_url TEXT NOT NULL,
  apps_script_api_key TEXT NOT NULL,
  archive_folder_id TEXT,
  configured_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.zhl_project_drive_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can read drive config" ON public.zhl_project_drive_config
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.zhl_project_permissions
      WHERE project_id = zhl_project_drive_config.project_id
        AND user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.zhl_projects
      WHERE id = zhl_project_drive_config.project_id
        AND owner_id = auth.uid()
    )
  );

CREATE POLICY "Project owners can manage drive config" ON public.zhl_project_drive_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.zhl_projects
      WHERE id = zhl_project_drive_config.project_id
        AND owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.zhl_projects
      WHERE id = zhl_project_drive_config.project_id
        AND owner_id = auth.uid()
    )
  );
