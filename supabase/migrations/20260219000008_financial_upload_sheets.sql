-- ============================================================
-- Upload sheets: each file upload creates a separate "sheet"
-- ============================================================

-- 1) Upload sheets table
CREATE TABLE IF NOT EXISTS public.financial_upload_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bank_type_id UUID REFERENCES public.financial_bank_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  column_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_financial_upload_sheets_project ON public.financial_upload_sheets(project_id);
CREATE INDEX IF NOT EXISTS idx_financial_upload_sheets_bank_type ON public.financial_upload_sheets(bank_type_id);

ALTER TABLE public.financial_upload_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access" ON public.financial_upload_sheets FOR ALL USING (public.is_project_owner(project_id));
CREATE POLICY "Member select" ON public.financial_upload_sheets FOR SELECT USING (public.is_project_member(project_id));
CREATE POLICY "Member insert" ON public.financial_upload_sheets FOR INSERT WITH CHECK (public.is_project_member(project_id));
CREATE POLICY "Member update" ON public.financial_upload_sheets FOR UPDATE USING (public.is_project_member(project_id));
CREATE POLICY "Member delete" ON public.financial_upload_sheets FOR DELETE USING (public.is_project_member(project_id));

-- 2) Add sheet_id to financial_transactions (CASCADE: deleting a sheet deletes its transactions)
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS sheet_id UUID REFERENCES public.financial_upload_sheets(id) ON DELETE CASCADE;

-- 3) Add status to financial_bank_types for request workflow
ALTER TABLE public.financial_bank_types
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
