import { supabase } from '@/lib/supabase/client';
import {
  FinancialSection,
  FinancialLineItem,
  FinancialMonthlyValue,
  FinancialBankType,
  FinancialTxCategory,
  FinancialTransaction,
  FinancialLoan,
  FinancialUploadSheet,
  SectionWithItems,
} from '@/lib/types/financial';

// ── Overview helpers ──────────────────────────────────────────

export async function getSections(projectId: string): Promise<SectionWithItems[]> {
  const { data: sections, error } = await supabase
    .from('zhl_financial_sections')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order');
  if (error || !sections) return [];

  const { data: items } = await supabase
    .from('zhl_financial_line_items')
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
    .from('zhl_financial_monthly_values')
    .select('*')
    .eq('project_id', projectId)
    .eq('year', year);
  if (error) return [];
  return data ?? [];
}

export async function createSection(projectId: string, name: string, sortOrder: number): Promise<FinancialSection | null> {
  const { data, error } = await supabase
    .from('zhl_financial_sections')
    .insert([{ project_id: projectId, name, sort_order: sortOrder }])
    .select()
    .single();
  if (error) { console.error('Error creating section:', error.message); return null; }
  return data;
}

export async function deleteSection(sectionId: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_sections').delete().eq('id', sectionId);
  return !error;
}

export async function createLineItem(sectionId: string, projectId: string, name: string, sortOrder: number = 0): Promise<FinancialLineItem | null> {
  const { data, error } = await supabase
    .from('zhl_financial_line_items')
    .insert([{ section_id: sectionId, project_id: projectId, name, sort_order: sortOrder }])
    .select()
    .single();
  if (error) { console.error('Error creating line item:', error.message); return null; }
  return data;
}

export async function deleteLineItem(id: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_line_items').delete().eq('id', id);
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
    .from('zhl_financial_monthly_values')
    .upsert(
      { line_item_id: lineItemId, project_id: projectId, year, month, value },
      { onConflict: 'line_item_id,year,month' }
    );
  if (error) { console.error('Error upserting value:', error.message); return false; }
  return true;
}

// ── AutoBooks helpers ─────────────────────────────────────────

export async function getBankTypes(projectId: string): Promise<FinancialBankType[]> {
  const { data, error } = await supabase.from('zhl_financial_bank_types').select('*').eq('project_id', projectId).order('created_at');
  if (error) { console.error('Error fetching bank types:', error.message); return []; }
  return (data ?? []).map((b) => ({ ...b, status: b.status ?? 'approved', ai_prompt: b.ai_prompt ?? '' }));
}

export const DEFAULT_BANK_TYPES = [
  'Wells Fargo Checking (pdf)',
  'Wells Fargo Checking (xlsx)',
  'Bank of America Checking',
  'Rent Vine Report',
  'Buildium Report',
  'Yardi Breeze Report',
  'Appfolio Report',
];

function normalizeBankTypeName(name: string): string {
  return name.trim().toLowerCase();
}

export async function dedupeBankTypes(projectId: string): Promise<void> {
  const existing = await getBankTypes(projectId);
  if (existing.length <= 1) return;

  const keepByName = new Map<string, FinancialBankType>();
  const duplicateIds: string[] = [];

  for (const type of existing) {
    const key = normalizeBankTypeName(type.name);
    const current = keepByName.get(key);
    if (!current) {
      keepByName.set(key, type);
      continue;
    }

    // Prefer approved entries; otherwise keep the earlier created record.
    const currentApproved = !current.status || current.status === 'approved';
    const nextApproved = !type.status || type.status === 'approved';

    if (!currentApproved && nextApproved) {
      duplicateIds.push(current.id);
      keepByName.set(key, type);
      continue;
    }

    if (currentApproved && !nextApproved) {
      duplicateIds.push(type.id);
      continue;
    }

    if (new Date(type.created_at).getTime() < new Date(current.created_at).getTime()) {
      duplicateIds.push(current.id);
      keepByName.set(key, type);
    } else {
      duplicateIds.push(type.id);
    }
  }

  if (duplicateIds.length === 0) return;

  const { error } = await supabase
    .from('zhl_financial_bank_types')
    .delete()
    .in('id', duplicateIds);

  if (error) {
    console.error('Error deduping bank types:', error.message);
  }
}

export async function ensureDefaultBankTypes(projectId: string): Promise<FinancialBankType[]> {
  await dedupeBankTypes(projectId);
  const existing = await getBankTypes(projectId);
  const existingNames = new Set(existing.map((b) => normalizeBankTypeName(b.name)));
  const missing = DEFAULT_BANK_TYPES.filter((name) => !existingNames.has(name.trim().toLowerCase()));

  if (missing.length === 0) {
    return existing;
  }

  for (const name of missing) {
    await createBankType(projectId, name, 'approved');
  }

  return getBankTypes(projectId);
}

export async function createBankType(projectId: string, name: string, status: string = 'approved'): Promise<FinancialBankType | null> {
  // Try with status column first, fallback without if column doesn't exist yet
  const { data, error } = await supabase.from('zhl_financial_bank_types').insert([{ project_id: projectId, name, status }]).select().single();
  if (error) {
    // Fallback: insert without status (migration not run yet)
    const { data: d2, error: e2 } = await supabase.from('zhl_financial_bank_types').insert([{ project_id: projectId, name }]).select().single();
    if (e2) { console.error('Error creating bank type:', e2.message); return null; }
    return { ...d2, status: 'approved' };
  }
  return data;
}

export async function approveBankType(id: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_bank_types').update({ status: 'approved' }).eq('id', id);
  return !error;
}

export async function rejectBankType(id: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_bank_types').delete().eq('id', id);
  return !error;
}

export async function updateBankTypePrompt(id: string, aiPrompt: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_bank_types').update({ ai_prompt: aiPrompt }).eq('id', id);
  if (error) { console.error('Error updating bank type prompt:', error.message); return false; }
  return true;
}

export async function getTxCategories(projectId: string): Promise<FinancialTxCategory[]> {
  const { data } = await supabase.from('zhl_financial_tx_categories').select('*').eq('project_id', projectId).order('sort_order');
  return data ?? [];
}

function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function dedupeTxCategories(projectId: string): Promise<void> {
  const categories = await getTxCategories(projectId);
  if (categories.length <= 1) return;

  const keepByName = new Map<string, FinancialTxCategory>();
  const dupToKeep = new Map<string, string>();

  for (const cat of categories) {
    const key = normalizeCategoryName(cat.name);
    const existing = keepByName.get(key);
    if (!existing) {
      keepByName.set(key, cat);
      continue;
    }

    // Keep the category with the lower sort order; tie-break by earlier created_at.
    const existingSort = Number.isFinite(existing.sort_order) ? existing.sort_order : Number.MAX_SAFE_INTEGER;
    const catSort = Number.isFinite(cat.sort_order) ? cat.sort_order : Number.MAX_SAFE_INTEGER;
    const keepCurrent =
      catSort < existingSort ||
      (catSort === existingSort && new Date(cat.created_at).getTime() < new Date(existing.created_at).getTime());

    if (keepCurrent) {
      dupToKeep.set(existing.id, cat.id);
      keepByName.set(key, cat);
    } else {
      dupToKeep.set(cat.id, existing.id);
    }
  }

  if (dupToKeep.size === 0) return;

  for (const [dupId, keepId] of dupToKeep.entries()) {
    const { error: txErr } = await supabase
      .from('zhl_financial_transactions')
      .update({ category_id: keepId })
      .eq('project_id', projectId)
      .eq('category_id', dupId);
    if (txErr) {
      console.error('Error remapping duplicate transaction categories:', txErr.message);
      return;
    }
  }

  const { error: deleteErr } = await supabase
    .from('zhl_financial_tx_categories')
    .delete()
    .in('id', Array.from(dupToKeep.keys()));

  if (deleteErr) {
    console.error('Error deleting duplicate categories:', deleteErr.message);
  }
}

export async function ensureDistinctTxCategories(projectId: string): Promise<FinancialTxCategory[]> {
  await dedupeTxCategories(projectId);
  return getTxCategories(projectId);
}

export async function createTxCategory(projectId: string, name: string, icon: string, color: string, categoryType: 'expense' | 'income' = 'expense'): Promise<FinancialTxCategory | null> {
  const { data, error } = await supabase
    .from('zhl_financial_tx_categories')
    .insert([{ project_id: projectId, name, icon, color, category_type: categoryType }])
    .select()
    .single();
  if (error) return null;
  return data;
}

export async function getTransactions(projectId: string): Promise<FinancialTransaction[]> {
  const { data } = await supabase.from('zhl_financial_transactions').select('*').eq('project_id', projectId).order('date', { ascending: false });
  return data ?? [];
}

export async function updateTransaction(id: string, field: string, value: string | number | boolean | null): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_transactions').update({ [field]: value }).eq('id', id);
  return !error;
}

export async function deleteTransaction(id: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_transactions').delete().eq('id', id);
  return !error;
}

export async function createTransaction(
  projectId: string,
  bankTypeId: string | null,
  fields: { date?: string; amount?: number; description?: string },
): Promise<FinancialTransaction | null> {
  const { data, error } = await supabase
    .from('zhl_financial_transactions')
    .insert({
      project_id: projectId,
      bank_type_id: bankTypeId,
      date: fields.date || null,
      amount: fields.amount ?? null,
      description: fields.description || null,
    })
    .select()
    .single();
  if (error) {
    console.error('Error creating transaction:', error.message);
    return null;
  }
  return data;
}

export async function bulkCreateTransactions(
  projectId: string,
  bankTypeId: string | null,
  sheetId: string | null,
  rows: { date: string; amount: number; description: string; raw_data?: Record<string, unknown> }[]
): Promise<FinancialTransaction[]> {
  const normalizeText = (value: string): string =>
    value.trim().replace(/\s+/g, ' ').toLowerCase();

  const normalizedAmount = (value: number): number =>
    Math.round(value * 100) / 100;

  const signature = (date: string, amount: number, description: string): string => {
    return `${date || ''}|${normalizedAmount(amount)}|${normalizeText(description || '')}`;
  };

  // Build signatures of existing entries for the same project + bank type.
  let existingSignatures = new Set<string>();
  {
    let query = supabase
      .from('zhl_financial_transactions')
      .select('date, amount, description')
      .eq('project_id', projectId);

    if (bankTypeId) {
      query = query.eq('bank_type_id', bankTypeId);
    } else {
      query = query.is('bank_type_id', null);
    }

    const { data: existingRows, error: existingError } = await query;
    if (existingError) {
      console.error('Error checking existing transactions for duplicates:', existingError.message);
    } else {
      existingSignatures = new Set(
        (existingRows ?? []).map((r) => signature(r.date ?? '', Number(r.amount ?? 0), r.description ?? ''))
      );
    }
  }

  // De-duplicate rows from the current upload and skip rows already in DB.
  const uploadSignatures = new Set<string>();
  const dedupedRows = rows.filter((r) => {
    const sig = signature(r.date || '', Number(r.amount || 0), r.description || '');
    if (uploadSignatures.has(sig)) return false;
    uploadSignatures.add(sig);
    if (existingSignatures.has(sig)) return false;
    return true;
  });

  if (dedupedRows.length === 0) {
    return [];
  }

  const inserts = dedupedRows.map((r) => ({
    project_id: projectId,
    bank_type_id: bankTypeId,
    sheet_id: sheetId,
    date: r.date || null,
    amount: r.amount,
    description: r.description || null,
    raw_data: r.raw_data ?? null,
  }));
  const { data, error } = await supabase.from('zhl_financial_transactions').insert(inserts).select();
  if (error) { console.error('Error bulk creating transactions:', error.message); return []; }
  return data ?? [];
}

// ── Upload Sheet helpers ──────────────────────────────────────

export async function getUploadSheets(projectId: string): Promise<FinancialUploadSheet[]> {
  const { data } = await supabase.from('zhl_financial_upload_sheets').select('*').eq('project_id', projectId).order('created_at');
  return data ?? [];
}

export async function createUploadSheet(
  projectId: string,
  bankTypeId: string | null,
  name: string,
  columnHeaders: string[],
  userId: string | null
): Promise<FinancialUploadSheet | null> {
  const { data, error } = await supabase
    .from('zhl_financial_upload_sheets')
    .insert([{ project_id: projectId, bank_type_id: bankTypeId, name, column_headers: columnHeaders, created_by: userId }])
    .select()
    .single();
  if (error) { console.error('Error creating upload sheet:', error.message); return null; }
  return data;
}

export async function deleteUploadSheet(sheetId: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_upload_sheets').delete().eq('id', sheetId);
  return !error;
}

export async function updateSheetColumnHeaders(sheetId: string, headers: string[]): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_upload_sheets').update({ column_headers: headers }).eq('id', sheetId);
  return !error;
}

// ── Debt Schedule helpers ─────────────────────────────────────

export async function getLoans(projectId: string): Promise<FinancialLoan[]> {
  const { data } = await supabase.from('zhl_financial_loans').select('*').eq('project_id', projectId).order('created_at');
  return data ?? [];
}

export async function createLoan(projectId: string): Promise<FinancialLoan | null> {
  const { data, error } = await supabase.from('zhl_financial_loans').insert([{ project_id: projectId }]).select().single();
  if (error) return null;
  return data;
}

export async function updateLoan(id: string, field: string, value: string | number | boolean | null): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_loans').update({ [field]: value }).eq('id', id);
  return !error;
}

export async function deleteLoan(id: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_financial_loans').delete().eq('id', id);
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
  await ensureDefaultBankTypes(projectId);
  // Seed tx categories
  for (let i = 0; i < DEFAULT_TX_CATEGORIES.length; i++) {
    const cat = DEFAULT_TX_CATEGORIES[i];
    await supabase.from('zhl_financial_tx_categories').insert([{
      project_id: projectId,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      sort_order: i + 1,
    }]);
  }
}
