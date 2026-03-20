-- Tighten the insert policy so users can only create their own account record
DROP POLICY IF EXISTS "Service role can insert accounts" ON public.accounts;
CREATE POLICY "Users can insert their own account" ON public.accounts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
