-- ============================================================
-- Financial module: 7 tables for Overview, AutoBooks, Debt Schedule
-- ============================================================

-- 1) financial_sections — top-level groups (GROSS INCOME, EXPENSES, etc.)
CREATE TABLE IF NOT EXISTS public.financial_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_financial_sections_project ON public.financial_sections(project_id);

-- 2) financial_line_items — rows within sections
CREATE TABLE IF NOT EXISTS public.financial_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES public.financial_sections(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_financial_line_items_section ON public.financial_line_items(section_id);
CREATE INDEX idx_financial_line_items_project ON public.financial_line_items(project_id);

-- 3) financial_monthly_values — cell values per line item per month
CREATE TABLE IF NOT EXISTS public.financial_monthly_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id UUID NOT NULL REFERENCES public.financial_line_items(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(line_item_id, year, month)
);
CREATE INDEX idx_financial_monthly_values_project ON public.financial_monthly_values(project_id);

-- 4) financial_bank_types — bank account types for AutoBooks
CREATE TABLE IF NOT EXISTS public.financial_bank_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_financial_bank_types_project ON public.financial_bank_types(project_id);

-- 5) financial_tx_categories — transaction category options
CREATE TABLE IF NOT EXISTS public.financial_tx_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_financial_tx_categories_project ON public.financial_tx_categories(project_id);

-- 6) financial_transactions — imported bank transactions
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bank_type_id UUID REFERENCES public.financial_bank_types(id) ON DELETE SET NULL,
  date DATE,
  amount NUMERIC(12,2),
  category_id UUID REFERENCES public.financial_tx_categories(id) ON DELETE SET NULL,
  notes TEXT,
  description TEXT,
  auto_grouping TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_financial_transactions_project ON public.financial_transactions(project_id);

-- 7) financial_loans — loan definitions for Debt Schedule
CREATE TABLE IF NOT EXISTS public.financial_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  loan_name TEXT,
  lender TEXT,
  due_on_the TEXT,
  autopays_on_the TEXT,
  amortization INT,
  interest_only BOOLEAN NOT NULL DEFAULT false,
  interest_rate NUMERIC(6,3),
  original_amount NUMERIC(14,2),
  payment NUMERIC(12,2),
  balloon_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_financial_loans_project ON public.financial_loans(project_id);

-- Auto-update triggers for updated_at
CREATE OR REPLACE FUNCTION public.update_financial_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS financial_monthly_values_updated_at ON public.financial_monthly_values;
CREATE TRIGGER financial_monthly_values_updated_at BEFORE UPDATE ON public.financial_monthly_values
FOR EACH ROW EXECUTE FUNCTION public.update_financial_updated_at();

DROP TRIGGER IF EXISTS financial_transactions_updated_at ON public.financial_transactions;
CREATE TRIGGER financial_transactions_updated_at BEFORE UPDATE ON public.financial_transactions
FOR EACH ROW EXECUTE FUNCTION public.update_financial_updated_at();

DROP TRIGGER IF EXISTS financial_loans_updated_at ON public.financial_loans;
CREATE TRIGGER financial_loans_updated_at BEFORE UPDATE ON public.financial_loans
FOR EACH ROW EXECUTE FUNCTION public.update_financial_updated_at();

-- Enable RLS on all tables
ALTER TABLE public.financial_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_monthly_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_bank_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_tx_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_loans ENABLE ROW LEVEL SECURITY;

-- RLS policies (same pattern for all: owner full access + member access)
-- financial_sections
CREATE POLICY "Owner access" ON public.financial_sections FOR ALL USING (public.is_project_owner(project_id));
CREATE POLICY "Member select" ON public.financial_sections FOR SELECT USING (public.is_project_member(project_id));
CREATE POLICY "Member insert" ON public.financial_sections FOR INSERT WITH CHECK (public.is_project_member(project_id));
CREATE POLICY "Member update" ON public.financial_sections FOR UPDATE USING (public.is_project_member(project_id));
CREATE POLICY "Member delete" ON public.financial_sections FOR DELETE USING (public.is_project_member(project_id));

-- financial_line_items
CREATE POLICY "Owner access" ON public.financial_line_items FOR ALL USING (public.is_project_owner(project_id));
CREATE POLICY "Member select" ON public.financial_line_items FOR SELECT USING (public.is_project_member(project_id));
CREATE POLICY "Member insert" ON public.financial_line_items FOR INSERT WITH CHECK (public.is_project_member(project_id));
CREATE POLICY "Member update" ON public.financial_line_items FOR UPDATE USING (public.is_project_member(project_id));
CREATE POLICY "Member delete" ON public.financial_line_items FOR DELETE USING (public.is_project_member(project_id));

-- financial_monthly_values
CREATE POLICY "Owner access" ON public.financial_monthly_values FOR ALL USING (public.is_project_owner(project_id));
CREATE POLICY "Member select" ON public.financial_monthly_values FOR SELECT USING (public.is_project_member(project_id));
CREATE POLICY "Member insert" ON public.financial_monthly_values FOR INSERT WITH CHECK (public.is_project_member(project_id));
CREATE POLICY "Member update" ON public.financial_monthly_values FOR UPDATE USING (public.is_project_member(project_id));
CREATE POLICY "Member delete" ON public.financial_monthly_values FOR DELETE USING (public.is_project_member(project_id));

-- financial_bank_types
CREATE POLICY "Owner access" ON public.financial_bank_types FOR ALL USING (public.is_project_owner(project_id));
CREATE POLICY "Member select" ON public.financial_bank_types FOR SELECT USING (public.is_project_member(project_id));
CREATE POLICY "Member insert" ON public.financial_bank_types FOR INSERT WITH CHECK (public.is_project_member(project_id));
CREATE POLICY "Member update" ON public.financial_bank_types FOR UPDATE USING (public.is_project_member(project_id));
CREATE POLICY "Member delete" ON public.financial_bank_types FOR DELETE USING (public.is_project_member(project_id));

-- financial_tx_categories
CREATE POLICY "Owner access" ON public.financial_tx_categories FOR ALL USING (public.is_project_owner(project_id));
CREATE POLICY "Member select" ON public.financial_tx_categories FOR SELECT USING (public.is_project_member(project_id));
CREATE POLICY "Member insert" ON public.financial_tx_categories FOR INSERT WITH CHECK (public.is_project_member(project_id));
CREATE POLICY "Member update" ON public.financial_tx_categories FOR UPDATE USING (public.is_project_member(project_id));
CREATE POLICY "Member delete" ON public.financial_tx_categories FOR DELETE USING (public.is_project_member(project_id));

-- financial_transactions
CREATE POLICY "Owner access" ON public.financial_transactions FOR ALL USING (public.is_project_owner(project_id));
CREATE POLICY "Member select" ON public.financial_transactions FOR SELECT USING (public.is_project_member(project_id));
CREATE POLICY "Member insert" ON public.financial_transactions FOR INSERT WITH CHECK (public.is_project_member(project_id));
CREATE POLICY "Member update" ON public.financial_transactions FOR UPDATE USING (public.is_project_member(project_id));
CREATE POLICY "Member delete" ON public.financial_transactions FOR DELETE USING (public.is_project_member(project_id));

-- financial_loans
CREATE POLICY "Owner access" ON public.financial_loans FOR ALL USING (public.is_project_owner(project_id));
CREATE POLICY "Member select" ON public.financial_loans FOR SELECT USING (public.is_project_member(project_id));
CREATE POLICY "Member insert" ON public.financial_loans FOR INSERT WITH CHECK (public.is_project_member(project_id));
CREATE POLICY "Member update" ON public.financial_loans FOR UPDATE USING (public.is_project_member(project_id));
CREATE POLICY "Member delete" ON public.financial_loans FOR DELETE USING (public.is_project_member(project_id));
