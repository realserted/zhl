-- Update user logs RLS policies to be more restrictive
-- Users can only see their own logs, admins see all

DROP POLICY IF EXISTS "Users can view logs for their projects" ON public.user_logs;

-- Users can only view their own logs
CREATE POLICY "Users can view their own logs" ON public.user_logs
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can view all logs (this policy already exists but keeping for clarity)
-- Policy "Admins can view all logs" will take precedence for admins
