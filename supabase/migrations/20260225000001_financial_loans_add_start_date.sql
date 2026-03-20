-- Add a start_date (loan origination / first payment date) to financial_loans.
-- Previously the UI incorrectly used balloon_date as the schedule start,
-- which caused the amortization table to show wrong values.

ALTER TABLE public.financial_loans
  ADD COLUMN IF NOT EXISTS start_date DATE;
