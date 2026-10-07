export interface FinancialSection {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface FinancialLineItem {
  id: string;
  section_id: string;
  project_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
}

export interface FinancialMonthlyValue {
  id: string;
  line_item_id: string;
  project_id: string;
  year: number;
  month: number;
  value: number;
  created_at: string;
  updated_at: string;
}

export interface FinancialBankType {
  id: string;
  project_id: string;
  name: string;
  status: string;
  ai_prompt: string;
  created_at: string;
}

export interface FinancialUploadSheet {
  id: string;
  project_id: string;
  bank_type_id: string | null;
  name: string;
  column_headers: string[];
  created_by: string | null;
  created_at: string;
}

export interface FinancialTxCategory {
  id: string;
  project_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  category_type: 'expense' | 'income';
  sort_order: number;
  created_at: string;
}

export interface FinancialTransaction {
  id: string;
  project_id: string;
  bank_type_id: string | null;
  date: string | null;
  amount: number | null;
  category_id: string | null;
  notes: string | null;
  description: string | null;
  auto_grouping: string | null;
  raw_data: Record<string, unknown> | null;
  sheet_id: string | null;
  ai_needs_review: boolean;
  created_at: string;
  updated_at: string;
}

export interface FinancialLoan {
  id: string;
  project_id: string;
  loan_name: string | null;
  lender: string | null;
  start_date: string | null;       // Loan origination / first payment date (YYYY-MM-DD)
  due_on_the: string | null;
  autopays_on_the: string | null;
  amortization: number | null;
  interest_only: boolean;
  interest_rate: number | null;
  original_amount: number | null;
  payment: number | null;
  balloon_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SectionWithItems extends FinancialSection {
  line_items: FinancialLineItem[];
}
