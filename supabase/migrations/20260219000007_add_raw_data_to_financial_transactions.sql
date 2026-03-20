-- Add raw_data column to store all original columns from uploaded files
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS raw_data JSONB DEFAULT NULL;
