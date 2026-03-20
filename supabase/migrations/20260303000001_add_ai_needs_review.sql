-- Add ai_needs_review flag to financial transactions
-- Persists low-confidence AI categorizations so the review icon survives page refresh

ALTER TABLE public.zhl_financial_transactions
  ADD COLUMN IF NOT EXISTS ai_needs_review BOOLEAN NOT NULL DEFAULT false;
