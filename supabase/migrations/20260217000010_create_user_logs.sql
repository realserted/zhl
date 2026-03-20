-- Create user_logs table to track user actions
CREATE TABLE IF NOT EXISTS public.user_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name VARCHAR(255) NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  action VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_logs_project_id ON public.user_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_user_logs_user_id ON public.user_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_logs_created_at ON public.user_logs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.user_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view logs for projects they have access to
CREATE POLICY "Users can view logs for their projects" ON public.user_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.project_permissions pp
      WHERE pp.project_id = user_logs.project_id AND pp.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = user_logs.project_id AND p.owner_id = auth.uid()
    )
  );

-- Admins can view all logs
CREATE POLICY "Admins can view all logs" ON public.user_logs
  FOR SELECT USING (public.is_admin());

-- Anyone can insert logs for their own actions
CREATE POLICY "Users can insert logs" ON public.user_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Only service role can update/delete logs
CREATE POLICY "Service role can manage all logs" ON public.user_logs
  FOR ALL USING (
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );
