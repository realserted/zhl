import { supabase } from '../supabase';
import {
  FinancialSection,
  FinancialLineItem,
  FinancialMonthlyValue,
  FinancialBankType,
  FinancialTxCategory,
  FinancialTransaction,
  FinancialLoan,
  SectionWithItems,
} from '../types/financial';

// ── Overview helpers ──────────────────────────────────────────

export async function getSections(projectId: string): Promise<SectionWithItems[]> {
  const { data: sections, error } = await supabase
    .from('financial_sections')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order');
  if (error || !sections) return [];

  const { data: items } = await supabase
    .from('financial_line_items')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order');

  return sections.map((s) => ({
    ...s,
    line_items: (items ?? []).filter((i) => i.section_id === s.id),
  }));
}

export async function getMonthlyValues(projectId: string, year: number): Promise<FinancialMonthlyValue[]> {
  const { data, error } = await supabase
    .from('financial_monthly_values')
    .select('*')
    .eq('project_id', projectId)
    .eq('year', year);
  if (error) return [];
  return data ?? [];
}

export async function createSection(projectId: string, name: string, sortOrder: number): Promise<FinancialSection | null> {
  const { data, error } = await supabase
    .from('financial_sections')
    .insert([{ project_id: projectId, name, sort_order: sortOrder }])
    .select()
    .single();
  if (error) { console.error('Error creating section:', error.message); return null; }
  return data;
}

export async function deleteSection(sectionId: string): Promise<boolean> {
  const { error } = await supabase.from('financial_sections').delete().eq('id', sectionId);
  return !error;
}

export async function createLineItem(sectionId: string, projectId: string, name: string, sortOrder: number = 0): Promise<FinancialLineItem | null> {
  const { data, error } = await supabase
    .from('financial_line_items')
    .insert([{ section_id: sectionId, project_id: projectId, name, sort_order: sortOrder }])
    .select()
    .single();
  if (error) { console.error('Error creating line item:', error.message); return null; }
  return data;
}

export async function deleteLineItem(id: string): Promise<boolean> {
  const { error } = await supabase.from('financial_line_items').delete().eq('id', id);
  return !error;
}

export async function upsertMonthlyValue(
  lineItemId: string,
  projectId: string,
  year: number,
  month: number,
  value: number
): Promise<boolean> {
  const { error } = await supabase
    .from('financial_monthly_values')
    .upsert(
      { line_item_id: lineItemId, project_id: projectId, year, month, value },
      { onConflict: 'line_item_id,year,month' }
    );
  if (error) { console.error('Error upserting value:', error.message); return false; }
  return true;
}

// ── AutoBooks helpers ─────────────────────────────────────────

export async function getBankTypes(projectId: string): Promise<FinancialBankType[]> {
  const { data } = await supabase.from('financial_bank_types').select('*').eq('project_id', projectId).order('created_at');
  return data ?? [];
}

export async function createBankType(projectId: string, name: string): Promise<FinancialBankType | null> {
  const { data, error } = await supabase.from('financial_bank_types').insert([{ project_id: projectId, name }]).select().single();
  if (error) return null;
  return data;
}

export async function getTxCategories(projectId: string): Promise<FinancialTxCategory[]> {
  const { data } = await supabase.from('financial_tx_categories').select('*').eq('project_id', projectId).order('sort_order');
  return data ?? [];
}

export async function createTxCategory(projectId: string, name: string, icon: string, color: string): Promise<FinancialTxCategory | null> {
  const { data, error } = await supabase
    .from('financial_tx_categories')
    .insert([{ project_id: projectId, name, icon, color }])
    .select()
    .single();
  if (error) return null;
  return data;
}

export async function getTransactions(projectId: string): Promise<FinancialTransaction[]> {
  const { data } = await supabase.from('financial_transactions').select('*').eq('project_id', projectId).order('date', { ascending: false });
  return data ?? [];
}

export async function updateTransaction(id: string, field: string, value: string | number | null): Promise<boolean> {
  const { error } = await supabase.from('financial_transactions').update({ [field]: value }).eq('id', id);
  return !error;
}

export async function deleteTransaction(id: string): Promise<boolean> {
  const { error } = await supabase.from('financial_transactions').delete().eq('id', id);
  return !error;
}

export async function bulkCreateTransactions(
  projectId: string,
  bankTypeId: string | null,
  rows: { date: string; amount: number; description: string }[]
): Promise<FinancialTransaction[]> {
  const inserts = rows.map((r) => ({
    project_id: projectId,
    bank_type_id: bankTypeId,
    date: r.date,
    amount: r.amount,
    description: r.description,
  }));
  const { data, error } = await supabase.from('financial_transactions').insert(inserts).select();
  if (error) { console.error('Error bulk creating transactions:', error.message); return []; }
  return data ?? [];
}

// ── Debt Schedule helpers ─────────────────────────────────────

export async function getLoans(projectId: string): Promise<FinancialLoan[]> {
  const { data } = await supabase.from('financial_loans').select('*').eq('project_id', projectId).order('created_at');
  return data ?? [];
}

export async function createLoan(projectId: string): Promise<FinancialLoan | null> {
  const { data, error } = await supabase.from('financial_loans').insert([{ project_id: projectId }]).select().single();
  if (error) return null;
  return data;
}

export async function updateLoan(id: string, field: string, value: string | number | boolean | null): Promise<boolean> {
  const { error } = await supabase.from('financial_loans').update({ [field]: value }).eq('id', id);
  return !error;
}

export async function deleteLoan(id: string): Promise<boolean> {
  const { error } = await supabase.from('financial_loans').delete().eq('id', id);
  return !error;
}

// ── Seed defaults ─────────────────────────────────────────────

const DEFAULT_SECTIONS = [
  { name: 'GROSS INCOME', sort_order: 1, items: ['RENT'] },
  {
    name: 'EXPENSES',
    sort_order: 2,
    items: [
      'Management', 'Property Taxes', 'Trailer Taxes', 'Insurance - Personal Property',
      'Insurance - General Liability', 'Water', 'Electric', 'Misc Electric',
      'Yard Care', 'Trash', 'Gas', 'Sewage', 'Septic', 'Est Maintenance',
    ],
  },
  { name: 'LOANS', sort_order: 3, items: ['Loan 1', 'Loan 2'] },
  { name: 'CASHFLOW', sort_order: 4, items: [] },
  { name: 'DISBURSEMENTS', sort_order: 5, items: ['User 1', 'User 2', 'User 3', 'User 4'] },
];

const DEFAULT_BANK_TYPES = [
  'Wells Fargo Checking (pdf)',
  'Wells Fargo Checking (xlsx)',
  'Bank of America Checking',
  'Rent Vine Report',
  'Buildium Report',
  'Yardi Breeze Report',
  'Appfolio Report',
];

const DEFAULT_TX_CATEGORIES = [
  { name: 'Bank Fees', icon: '●', color: '#000000' },
  { name: 'Office Expenses', icon: '●', color: '#3b82f6' },
  { name: 'Professional Services', icon: '●', color: '#8b5cf6' },
  { name: 'Misc (describe)', icon: '?', color: '#ef4444' },
  { name: 'Partner Contribution', icon: '👤', color: '#ef4444' },
  { name: 'Electric', icon: '⚡', color: '#3b82f6' },
  { name: 'Net Rent from Manager', icon: '➕', color: '#22c55e' },
  { name: 'Insurance', icon: '✳', color: '#ec4899' },
  { name: 'Loan Payment', icon: '💰', color: '#eab308' },
  { name: 'One-Time fee (describe)', icon: '■', color: '#3b82f6' },
];

export async function seedDefaultFinancials(projectId: string): Promise<void> {
  // Seed sections + line items
  for (const sec of DEFAULT_SECTIONS) {
    const section = await createSection(projectId, sec.name, sec.sort_order);
    if (section) {
      for (let i = 0; i < sec.items.length; i++) {
        await createLineItem(section.id, projectId, sec.items[i], i + 1);
      }
    }
  }
  // Seed bank types
  for (const name of DEFAULT_BANK_TYPES) {
    await supabase.from('financial_bank_types').insert([{ project_id: projectId, name }]);
  }
  // Seed tx categories
  for (let i = 0; i < DEFAULT_TX_CATEGORIES.length; i++) {
    const cat = DEFAULT_TX_CATEGORIES[i];
    await supabase.from('financial_tx_categories').insert([{
      project_id: projectId,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      sort_order: i + 1,
    }]);
  }
}
