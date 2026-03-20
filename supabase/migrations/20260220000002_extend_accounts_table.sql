-- Extend accounts table with vault-style columns
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS descriptor TEXT;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS person_name TEXT;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS notes TEXT;

-- Ensure admins can update all accounts (not just their own)
DROP POLICY IF EXISTS "Admins can update all accounts" ON public.accounts;
CREATE POLICY "Admins can update all accounts" ON public.accounts
  FOR UPDATE USING (public.is_admin());

-- Allow admins full access to ALL financial tables (so admin can seed defaults etc.)
DROP POLICY IF EXISTS "Admin access" ON public.financial_sections;
CREATE POLICY "Admin access" ON public.financial_sections FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "Admin access" ON public.financial_line_items;
CREATE POLICY "Admin access" ON public.financial_line_items FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "Admin access" ON public.financial_monthly_values;
CREATE POLICY "Admin access" ON public.financial_monthly_values FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "Admin access" ON public.financial_bank_types;
CREATE POLICY "Admin access" ON public.financial_bank_types FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "Admin access" ON public.financial_tx_categories;
CREATE POLICY "Admin access" ON public.financial_tx_categories FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "Admin access" ON public.financial_transactions;
CREATE POLICY "Admin access" ON public.financial_transactions FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "Admin access" ON public.financial_upload_sheets;
CREATE POLICY "Admin access" ON public.financial_upload_sheets FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "Admin access" ON public.financial_loans;
CREATE POLICY "Admin access" ON public.financial_loans FOR ALL USING (public.is_admin());
