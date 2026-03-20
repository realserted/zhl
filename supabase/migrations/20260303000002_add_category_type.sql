-- Add category_type to financial transaction categories
-- Allows explicit classification as 'expense' or 'income' for the overview

ALTER TABLE public.zhl_financial_tx_categories
  ADD COLUMN IF NOT EXISTS category_type TEXT NOT NULL DEFAULT 'expense';
