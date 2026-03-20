-- Add notes column to financial loans
ALTER TABLE public.zhl_financial_loans
  ADD COLUMN IF NOT EXISTS notes text;
