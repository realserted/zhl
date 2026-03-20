-- Allow users to read their own account record
CREATE POLICY "Users can read their own account" ON public.accounts
  FOR SELECT USING (auth.uid() = user_id);
