'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ProjectPermission } from '@/lib/types/project';
import { usePermission } from '@/lib/hooks/usePermission';
import { useUserLogger } from '@/lib/hooks/useUserLogger';
import { useColumnResize } from '@/lib/hooks/useColumnResize';
import { FinancialBankType, FinancialTxCategory, FinancialTransaction, FinancialUploadSheet } from '@/lib/types/financial';
import {
  createBankType,
  ensureDefaultBankTypes,
  ensureDistinctTxCategories, createTxCategory, updateTxCategoryType,
  getTransactions, updateTransaction, deleteTransaction, createTransaction, bulkCreateTransactions,
  getUploadSheets, createUploadSheet, deleteUploadSheet, updateSheetColumnHeaders,
} from '@/lib/db/financial';
import { AutoBooksPreviewConfig, TemplateField } from './AutoBooksPreviewModal';
import * as XLSX from 'xlsx';

// ── Pure helpers ──────────────────────────────────────────────

function normalizeDesc(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\b(srr?#|sr#|srf#|trn#|rfb#|rb#|ref#|ref|ow\d+|cb\d+)\s*\S*/gi, '')
    .replace(/\d{4,}/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function localPatternMatch(
  newTxs: { id: string; description: string }[],
  existingTxs: { description: string; category_id: string }[],
): Map<string, string> {
  const matched = new Map<string, string>();
  if (existingTxs.length === 0) return matched;

  const descToCat = new Map<string, string>();
  for (const tx of existingTxs) {
    if (!tx.description || !tx.category_id) continue;
    const norm = normalizeDesc(tx.description);
    if (norm.length >= 5) descToCat.set(norm, tx.category_id);
  }

  for (const tx of newTxs) {
    const norm = normalizeDesc(tx.description);
    const exact = descToCat.get(norm);
    if (exact) { matched.set(tx.id, exact); continue; }
    for (const [pattern, catId] of descToCat) {
      if (pattern.length >= 10 && (norm.startsWith(pattern) || pattern.startsWith(norm) || norm.includes(pattern) || pattern.includes(norm))) {
        matched.set(tx.id, catId);
        break;
      }
    }
  }
  return matched;
}

async function aiCategorize(
  txs: { id: string; description: string }[],
  categories: { id: string; name: string }[],
  customPrompt?: string,
  examples?: { description: string; categoryName: string }[],
): Promise<{ catMap: Map<string, string>; lowConfidenceIds: Set<string> }> {
  const catMap = new Map<string, string>();
  const lowConfidenceIds = new Set<string>();
  if (txs.length === 0 || categories.length === 0) return { catMap, lowConfidenceIds };

  try {
    const res = await fetch('/api/ai/categorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: txs,
        categories,
        customPrompt: customPrompt || undefined,
        examples: examples?.length ? examples : undefined,
      }),
    });
    if (!res.ok) {
      console.error('AI categorize API error:', res.status, await res.text().catch(() => ''));
      return { catMap, lowConfidenceIds };
    }
    const data = await res.json();
    if (data.error) {
      console.error('AI categorize error:', data.error);
      return { catMap, lowConfidenceIds };
    }
    if (Array.isArray(data.results)) {
      for (const r of data.results) {
        if (r.txId && r.categoryId) {
          catMap.set(r.txId, r.categoryId);
          if (r.confidence === 'low') lowConfidenceIds.add(r.txId);
        }
      }
    }
  } catch (err) {
    console.error('AI categorize failed:', err);
  }
  return { catMap, lowConfidenceIds };
}

const parseAmount = (val: unknown): number => {
  if (typeof val === 'number') return val;
  const str = String(val ?? '').replace(/,/g, '').replace(/^\$/, '').trim();
  if (!str) return 0;
  const parenMatch = str.match(/^\((.+)\)$/);
  if (parenMatch) return -Math.abs(parseFloat(parenMatch[1]) || 0);
  return parseFloat(str) || 0;
};

const parseDate = (val: unknown): string => {
  if (!val) return '';
  if (val instanceof Date) return isNaN(val.getTime()) ? '' : val.toISOString().split('T')[0];
  const str = String(val).trim().replace(/^["']|["']$/g, '');
  if (!str) return '';
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const dd = new Date(str);
  return isNaN(dd.getTime()) ? '' : dd.toISOString().split('T')[0];
};

const txSignature = (date: string, amount: number, description: string): string => {
  const normalizedDesc = description.trim().replace(/\s+/g, ' ').toLowerCase();
  const normalizedAmount = Math.round(amount * 100) / 100;
  return `${date || ''}|${normalizedAmount}|${normalizedDesc}`;
};

const findCol = (row: Record<string, unknown>, names: string[]): unknown => {
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lower || key.toLowerCase().includes(lower)) {
        if (row[key] !== '' && row[key] != null) return row[key];
      }
    }
  }
  return undefined;
};

// ── Shared auto-categorize after upload ──────────────────────

async function autoCategorizeNewTxs(
  created: FinancialTransaction[],
  allTransactions: FinancialTransaction[],
  txCategories: FinancialTxCategory[],
  bankTypes: FinancialBankType[],
  selectedBankType: string,
  setTransactions: React.Dispatch<React.SetStateAction<FinancialTransaction[]>>,
): Promise<number> {
  let categorizedCount = 0;
  const autoTxs = created.filter((t) => !t.auto_grouping && t.description);
  if (autoTxs.length === 0 || txCategories.length === 0) return 0;

  const existingCategorized = allTransactions.filter((t) => t.category_id && t.description && t.bank_type_id === selectedBankType);

  // 1) Local pattern match
  const localMatches = localPatternMatch(
    autoTxs.map((t) => ({ id: t.id, description: t.description! })),
    existingCategorized.map((t) => ({ description: t.description!, category_id: t.category_id! })),
  );
  if (localMatches.size > 0) {
    categorizedCount += localMatches.size;
    await Promise.all(Array.from(localMatches.entries()).map(([txId, catId]) =>
      updateTransaction(txId, 'category_id', catId)
    ));
    setTransactions((prev) =>
      prev.map((t) => {
        const catId = localMatches.get(t.id);
        return catId ? { ...t, category_id: catId } : t;
      }),
    );
  }

  // 2) AI categorize remaining
  const unmatchedTxs = autoTxs.filter((t) => !localMatches.has(t.id));
  if (unmatchedTxs.length > 0) {
    const catIdToName = new Map(txCategories.map((c) => [c.id, c.name]));
    const examples = existingCategorized
      .filter((t) => catIdToName.has(t.category_id!))
      .map((t) => ({ description: t.description!, categoryName: catIdToName.get(t.category_id!)! }));

    const bankTypePrompt = bankTypes.find((b) => b.id === selectedBankType)?.ai_prompt;
    const { catMap, lowConfidenceIds } = await aiCategorize(
      unmatchedTxs.map((t) => ({ id: t.id, description: t.description! })),
      txCategories.map((c) => ({ id: c.id, name: c.name })),
      bankTypePrompt,
      examples,
    );
    if (catMap.size > 0) {
      categorizedCount += catMap.size;
      await Promise.all(Array.from(catMap.entries()).map(([txId, catId]) => {
        const needsReview = lowConfidenceIds.has(txId);
        return Promise.all([
          updateTransaction(txId, 'category_id', catId),
          needsReview ? updateTransaction(txId, 'ai_needs_review', true) : Promise.resolve(true),
        ]);
      }));
      setTransactions((prev) =>
        prev.map((t) => {
          const catId = catMap.get(t.id);
          return catId ? { ...t, category_id: catId, ai_needs_review: lowConfidenceIds.has(t.id) } : t;
        }),
      );
    }
  }

  return categorizedCount;
}

// ── Hook ─────────────────────────────────────────────────────

export function useAutoBooks(selectedProjectId: string, userPermission?: ProjectPermission | null) {
  const { user } = useAuth();
  const [bankTypes, setBankTypes] = useState<FinancialBankType[]>([]);
  const [selectedBankType, setSelectedBankType] = useState<string | null>(null);
  const [txCategories, setTxCategories] = useState<FinancialTxCategory[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [sheets, setSheets] = useState<FinancialUploadSheet[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'expense' | 'income'>('expense');
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const { columnWidths: colWidths, onResizeStart: handleResizeStart } = useColumnResize(150);
  const [editingHeader, setEditingHeader] = useState<{ sheetId: string; index: number } | null>(null);
  const [headerEditValue, setHeaderEditValue] = useState('');
  const [confirmDeleteSheet, setConfirmDeleteSheet] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickFileInputRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<unknown[][]>([]);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewWorkbook, setPreviewWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [previewInitialConfig, setPreviewInitialConfig] = useState<AutoBooksPreviewConfig>({ headerRow: 0, dataStartRow: 1, columnMapping: {} });

  const { canEdit } = usePermission(userPermission, 'perm_reports');
  const { log } = useUserLogger(selectedProjectId);

  useEffect(() => {
    ensureDefaultBankTypes(selectedProjectId).then((bt) => {
      setBankTypes(bt);
      const approved = bt.filter((b) => !b.status || b.status === 'approved');
      if (approved.length > 0) setSelectedBankType(approved[0].id);
    });
    ensureDistinctTxCategories(selectedProjectId).then(setTxCategories);
    getTransactions(selectedProjectId).then(setTransactions);
    getUploadSheets(selectedProjectId).then(setSheets);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Derived data ─────────────────────────────────────────────

  const approvedBankTypes = bankTypes.filter((b) => !b.status || b.status === 'approved');

  const sheetsForType = useMemo(() =>
    sheets.filter((s) => s.bank_type_id === selectedBankType),
    [sheets, selectedBankType]
  );

  const effectiveSheetId = useMemo(() => {
    if (!selectedBankType || sheetsForType.length === 0) return null;
    if (selectedSheetId && sheetsForType.some((s) => s.id === selectedSheetId)) {
      return selectedSheetId;
    }
    return sheetsForType[0].id;
  }, [selectedBankType, sheetsForType, selectedSheetId]);

  const filteredTransactions = useMemo(() => {
    let txs = selectedBankType
      ? transactions.filter((t) => t.bank_type_id === selectedBankType)
      : transactions;
    if (effectiveSheetId) txs = txs.filter((t) => t.sheet_id === effectiveSheetId);
    else txs = [];
    return txs;
  }, [transactions, selectedBankType, effectiveSheetId]);

  const activeSheet = effectiveSheetId ? sheets.find((s) => s.id === effectiveSheetId) : null;

  const dynamicColumns = useMemo(() => {
    if (activeSheet && activeSheet.column_headers.length > 0) {
      return activeSheet.column_headers;
    }
    const colSet = new Map<string, number>();
    for (const tx of filteredTransactions) {
      if (!tx.raw_data) continue;
      Object.keys(tx.raw_data).forEach((k, i) => {
        if (!colSet.has(k)) colSet.set(k, colSet.size + i * 0.001);
      });
    }
    return Array.from(colSet.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name);
  }, [activeSheet, filteredTransactions]);

  const hasRawData = filteredTransactions.some((t) => t.raw_data && Object.keys(t.raw_data).length > 0);

  // ── Handlers ─────────────────────────────────────────────────

  const handleRequestBankType = async () => {
    if (!newTypeName.trim()) return;
    const bt = await createBankType(selectedProjectId, newTypeName.trim(), 'pending');
    if (bt) {
      setBankTypes((prev) => [...prev, bt]);
      setNotice(`Request for "${newTypeName.trim()}" sent to admin for approval.`);
      log(`Requested bank type "${newTypeName.trim()}"`);
    }
    setNewTypeName('');
    setShowAddType(false);
  };

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    const cat = await createTxCategory(selectedProjectId, newCatName.trim(), '●', '#8b5cf6', newCatType);
    if (cat) {
      setTxCategories((prev) => [...prev, cat]);
      log(`Added transaction category "${newCatName.trim()}" (${newCatType})`);
    }
    setNewCatName('');
    setNewCatType('expense');
    setShowAddCategory(false);
  };

  const handleToggleCategoryType = async (catId: string) => {
    const cat = txCategories.find((c) => c.id === catId);
    if (!cat) return;
    const newType = cat.category_type === 'income' ? 'expense' : 'income';
    const ok = await updateTxCategoryType(catId, newType);
    if (ok) {
      setTxCategories((prev) => prev.map((c) => c.id === catId ? { ...c, category_type: newType } : c));
    }
  };

  // ── Upload handlers ──────────────────────────────────────────

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedBankType) return;

    const sheetName = file.name.replace(/\.[^/.]+$/, '');
    const duplicateSheet = sheets.some(
      (s) =>
        s.bank_type_id === selectedBankType &&
        s.name.trim().toLowerCase() === sheetName.trim().toLowerCase()
    );
    if (duplicateSheet) {
      setNotice(`"${sheetName}" already exists for this bank type. Duplicate file upload blocked.`);
      e.target.value = '';
      return;
    }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const xlSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(xlSheet, { defval: '', header: 1 });

    const cleaned = rawRows.map((row) =>
      (row as unknown[]).map((cell) => {
        if (cell instanceof Date) return isNaN(cell.getTime()) ? '' : cell.toISOString().split('T')[0];
        return cell;
      })
    );

    setPreviewRows(cleaned);
    setPreviewFile(file);
    setPreviewWorkbook(workbook);

    let detectedStart = 1;
    for (let r = 0; r < cleaned.length; r++) {
      const row = cleaned[r];
      const hasDateVal = row.some((c) => {
        const s = String(c ?? '').trim();
        return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s);
      });
      const hasNumber = row.some((c) => {
        if (typeof c === 'number' && c !== 0) return true;
        const s = String(c ?? '').replace(/[$,]/g, '').trim();
        return s && !isNaN(Number(s)) && Number(s) !== 0;
      });
      if (hasDateVal || hasNumber) { detectedStart = r + 1; break; }
    }

    const detectedHeaderRow = detectedStart >= 2 ? detectedStart - 1 : 0;
    const maxCols = Math.max(...cleaned.map((r) => r.length), 0);
    const newMapping: Record<number, TemplateField | 'skip' | string> = {};
    const hdrRowData = detectedHeaderRow >= 1 ? cleaned[detectedHeaderRow - 1] : null;
    const usedFields = new Set<string>();

    const tryAssign = (c: number, field: TemplateField): boolean => {
      if (usedFields.has(field)) return false;
      usedFields.add(field);
      newMapping[c] = field;
      return true;
    };

    for (let c = 0; c < maxCols; c++) {
      const headerVal = hdrRowData ? String(hdrRowData[c] ?? '').trim() : '';
      const headerLower = headerVal.toLowerCase();
      if (/^date$|posting|trans.*date|posted/i.test(headerLower) && tryAssign(c, 'Date')) continue;
      if (/^amount$|transaction.*amount|instructed.*amount/i.test(headerLower) && tryAssign(c, 'Amount')) continue;
      if (/^description$|^memo$|^narrative$|^payee$|^details$/i.test(headerLower) && tryAssign(c, 'Description')) continue;
      if (/^category$/i.test(headerLower) && tryAssign(c, 'Category')) continue;
      if (/^notes?$/i.test(headerLower) && tryAssign(c, 'Notes')) continue;
      if (/group|auto/i.test(headerLower) && tryAssign(c, 'Auto-Grouping')) continue;
      newMapping[c] = 'skip';
    }
    setPreviewInitialConfig({ headerRow: detectedHeaderRow, dataStartRow: detectedStart, columnMapping: newMapping });
    setPreviewOpen(true);
    e.target.value = '';
  };

  const processExcelWithMapping = async (config: AutoBooksPreviewConfig) => {
    if (!previewFile || !selectedBankType || !previewWorkbook) return;
    setPreviewOpen(false);

    const { headerRow, dataStartRow, columnMapping } = config;
    const sheetName = previewFile.name.replace(/\.[^/.]+$/, '');
    const startIdx = dataStartRow - 1;

    const maxCols = Math.max(...previewRows.map((r) => r.length), 0);
    const hdrRowData = headerRow >= 1 ? previewRows[headerRow - 1] : null;
    const columnHeaders: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      const mapping = columnMapping[c];
      if (mapping && mapping !== 'skip') {
        columnHeaders.push(mapping);
      } else {
        columnHeaders.push(hdrRowData ? String(hdrRowData[c] ?? `Col${c + 1}`) : `Col${c + 1}`);
      }
    }

    const dateColIdx = Object.entries(columnMapping).find(([, v]) => v === 'Date')?.[0];
    const amountColIdx = Object.entries(columnMapping).find(([, v]) => v === 'Amount')?.[0];
    const descColIdx = Object.entries(columnMapping).find(([, v]) => v === 'Description')?.[0];

    const parsed: { date: string; amount: number; description: string; raw_data: Record<string, unknown> }[] = [];

    for (let r = startIdx; r < previewRows.length; r++) {
      const row = previewRows[r];
      if (!row || row.every((c) => c === '' || c == null)) continue;

      const rawData: Record<string, unknown> = {};
      for (let c = 0; c < row.length; c++) {
        const val = row[c];
        if (val === '' || val == null) continue;
        rawData[columnHeaders[c] || `Col${c + 1}`] = val;
      }
      if (Object.keys(rawData).length === 0) continue;

      const dateVal = dateColIdx != null ? row[Number(dateColIdx)] : undefined;
      const amountVal = amountColIdx != null ? row[Number(amountColIdx)] : undefined;
      const descVal = descColIdx != null ? row[Number(descColIdx)] : undefined;

      const dateStr = parseDate(dateVal);
      const amount = amountVal != null ? parseAmount(amountVal) : 0;
      let description = descVal != null ? String(descVal ?? '').trim() : '';

      if (!description) {
        for (let i = row.length - 1; i >= 0; i--) {
          const v = String(row[i] ?? '').trim();
          if (v && v !== '*' && isNaN(Number(v.replace(/,/g, ''))) && !parseDate(v)) {
            description = v;
            break;
          }
        }
      }

      if (!dateStr && !amount && !description) continue;
      if (!dateStr && description && /^(beginning balance|total credits|total debits|ending balance)/i.test(description)) continue;

      parsed.push({ date: dateStr, amount, description, raw_data: rawData });
    }

    if (parsed.length > 0) {
      const existingSigs = new Set(
        transactions
          .filter((t) => t.bank_type_id === selectedBankType)
          .map((t) => txSignature(t.date ?? '', Number(t.amount ?? 0), t.description ?? ''))
      );
      const uploadSigs = new Set<string>();
      const uniqueParsed = parsed.filter((row) => {
        const sig = txSignature(row.date, Number(row.amount ?? 0), row.description ?? '');
        if (uploadSigs.has(sig)) return false;
        uploadSigs.add(sig);
        if (existingSigs.has(sig)) return false;
        return true;
      });

      if (uniqueParsed.length === 0) {
        setNotice(`"${sheetName}" contains no new entries. Duplicate file upload blocked.`);
        return;
      }

      const sheet = await createUploadSheet(selectedProjectId, selectedBankType, sheetName, columnHeaders, user?.id ?? null);
      const sheetId = sheet?.id ?? null;
      const created = await bulkCreateTransactions(selectedProjectId, selectedBankType, sheetId, uniqueParsed);
      setTransactions((prev) => [...created, ...prev]);
      if (sheet) {
        setSheets((prev) => [...prev, sheet]);
        setSelectedSheetId(sheet.id);
      }
      log(`Uploaded ${created.length} transactions from "${previewFile.name}"`);

      const categorizedCount = await autoCategorizeNewTxs(created, transactions, txCategories, bankTypes, selectedBankType, setTransactions);

      const duplicateCount = Math.max(0, parsed.length - uniqueParsed.length);
      const catMsg = categorizedCount > 0 ? ` Auto-categorized ${categorizedCount} transaction(s).` : '';
      setNotice(
        duplicateCount > 0
          ? `Uploaded "${sheetName}" with ${created.length} new rows (${duplicateCount} duplicate entries skipped).${catMsg}`
          : `Uploaded "${sheetName}" with ${created.length} rows.${catMsg}`
      );
    }

    setPreviewFile(null);
    setPreviewWorkbook(null);
    setPreviewRows([]);
  };

  const handleQuickUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedBankType) return;

    const sheetName = file.name.replace(/\.[^/.]+$/, '');
    const duplicateSheet = sheets.some(
      (s) =>
        s.bank_type_id === selectedBankType &&
        s.name.trim().toLowerCase() === sheetName.trim().toLowerCase()
    );
    if (duplicateSheet) {
      setNotice(`"${sheetName}" already exists for this bank type. Duplicate file upload blocked.`);
      e.target.value = '';
      return;
    }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const xlSheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(xlSheet, { defval: '' });

    const columnHeaders: string[] = [];
    const parsed: { date: string; amount: number; description: string; raw_data: Record<string, unknown> }[] = [];

    for (const row of rows) {
      const rawData: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(row)) {
        if (val === '' || val == null) continue;
        if (val instanceof Date) {
          rawData[key] = isNaN(val.getTime()) ? '' : val.toISOString().split('T')[0];
        } else {
          rawData[key] = val;
        }
      }
      if (Object.keys(rawData).length === 0) continue;

      if (columnHeaders.length === 0) {
        Object.keys(rawData).forEach((k) => columnHeaders.push(k));
      }

      const dateVal = findCol(row, ['Date', 'Posting Date', 'Transaction Date', 'Trans Date', 'Posted Date']);
      const descVal = findCol(row, ['Description', 'Memo', 'Narrative', 'Payee', 'Details', 'Transaction Description']);

      let amount = 0;
      const creditDebitIndicator = String(findCol(row, ['Credit Debit Indicator', 'Debit/Credit']) ?? '').toLowerCase();
      const amountVal = findCol(row, ['Amount', 'Transaction Amount', 'Instructed Amount']);

      if (amountVal !== undefined) {
        amount = parseAmount(amountVal);
        if (creditDebitIndicator === 'debit' && amount > 0) amount = -amount;
        if (creditDebitIndicator === 'credit' && amount < 0) amount = -amount;
      } else {
        const debitVal = findCol(row, ['Debit', 'Debit Amount', 'Withdrawal']);
        const creditVal = findCol(row, ['Credit', 'Credit Amount', 'Deposit']);
        if (debitVal !== undefined) amount -= Math.abs(parseAmount(debitVal));
        if (creditVal !== undefined) amount += Math.abs(parseAmount(creditVal));
      }

      const dateStr = parseDate(dateVal);
      const desc = String(descVal ?? '').trim();

      let description = desc;
      if (!description) {
        const vals = Object.values(rawData);
        for (let i = vals.length - 1; i >= 0; i--) {
          const v = String(vals[i] ?? '').trim();
          if (v && v !== '*' && isNaN(Number(v.replace(/,/g, ''))) && !parseDate(v)) {
            description = v;
            break;
          }
        }
      }

      if (!dateStr && !amount && !description) continue;
      if (!dateStr && description && /^(beginning balance|total credits|total debits|ending balance)/i.test(description)) continue;

      parsed.push({ date: dateStr, amount, description, raw_data: rawData });
    }

    if (parsed.length > 0) {
      const existingSigs = new Set(
        transactions
          .filter((t) => t.bank_type_id === selectedBankType)
          .map((t) => txSignature(t.date ?? '', Number(t.amount ?? 0), t.description ?? ''))
      );
      const uploadSigs = new Set<string>();
      const uniqueParsed = parsed.filter((row) => {
        const sig = txSignature(row.date, Number(row.amount ?? 0), row.description ?? '');
        if (uploadSigs.has(sig)) return false;
        uploadSigs.add(sig);
        if (existingSigs.has(sig)) return false;
        return true;
      });

      if (uniqueParsed.length === 0) {
        setNotice(`"${sheetName}" contains no new entries. Duplicate file upload blocked.`);
        e.target.value = '';
        return;
      }

      const sheet = await createUploadSheet(selectedProjectId, selectedBankType, sheetName, columnHeaders, user?.id ?? null);
      const sheetId = sheet?.id ?? null;
      const created = await bulkCreateTransactions(selectedProjectId, selectedBankType, sheetId, uniqueParsed);
      setTransactions((prev) => [...created, ...prev]);
      if (sheet) {
        setSheets((prev) => [...prev, sheet]);
        setSelectedSheetId(sheet.id);
      }
      log(`Uploaded ${created.length} transactions from "${file.name}"`);

      const categorizedCount = await autoCategorizeNewTxs(created, transactions, txCategories, bankTypes, selectedBankType, setTransactions);

      const catMsg = categorizedCount > 0 ? ` Auto-categorized ${categorizedCount} transaction(s).` : '';
      const duplicateCount = Math.max(0, parsed.length - uniqueParsed.length);
      setNotice(
        duplicateCount > 0
          ? `Uploaded "${sheetName}" with ${created.length} new rows (${duplicateCount} duplicate entries skipped).${catMsg}`
          : `Uploaded "${sheetName}" with ${created.length} rows.${catMsg}`
      );
    }
    e.target.value = '';
  };

  // ── Sheet handlers ───────────────────────────────────────────

  const handleDeleteSheet = async (sheetId: string) => {
    if (await deleteUploadSheet(sheetId)) {
      setSheets((prev) => prev.filter((s) => s.id !== sheetId));
      setTransactions((prev) => prev.filter((t) => t.sheet_id !== sheetId));
      if (selectedSheetId === sheetId) setSelectedSheetId(null);
      const sheet = sheets.find((s) => s.id === sheetId);
      log(`Deleted sheet "${sheet?.name}"`);
      setNotice(`Deleted "${sheet?.name}".`);
    }
    setConfirmDeleteSheet(null);
  };

  const handleDeleteAllForType = async () => {
    if (selectedBankType) {
      const typeSheets = sheets.filter((s) => s.bank_type_id === selectedBankType);
      for (const s of typeSheets) {
        await deleteUploadSheet(s.id);
      }
      const orphanTxs = transactions.filter((t) => t.bank_type_id === selectedBankType && !t.sheet_id);
      for (const tx of orphanTxs) {
        await deleteTransaction(tx.id);
      }
      setSheets((prev) => prev.filter((s) => s.bank_type_id !== selectedBankType));
      setTransactions((prev) => prev.filter((t) => t.bank_type_id !== selectedBankType));
      setSelectedSheetId(null);
      const typeName = bankTypes.find((b) => b.id === selectedBankType)?.name ?? '';
      log(`Deleted all data for "${typeName}"`);
      setNotice(`All data for "${typeName}" deleted.`);
    } else {
      for (const s of sheets) {
        await deleteUploadSheet(s.id);
      }
      for (const tx of transactions.filter((t) => !t.sheet_id)) {
        await deleteTransaction(tx.id);
      }
      setSheets([]);
      setTransactions([]);
      setSelectedSheetId(null);
      log('Deleted all transaction data');
      setNotice('All transaction data deleted.');
    }
    setConfirmDeleteAll(false);
  };

  const handleRenameHeader = async (sheetId: string, index: number, newName: string) => {
    setEditingHeader(null);
    const sheet = sheets.find((s) => s.id === sheetId);
    if (!sheet || !newName.trim()) return;
    const updated = [...sheet.column_headers];
    updated[index] = newName.trim();
    if (await updateSheetColumnHeaders(sheetId, updated)) {
      setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, column_headers: updated } : s)));
    }
  };

  // ── Inline edit helpers ──────────────────────────────────────

  const handleCategoryChange = async (txId: string, categoryId: string) => {
    const ok = await updateTransaction(txId, 'category_id', categoryId || null);
    if (ok) {
      const tx = transactions.find((t) => t.id === txId);
      if (tx?.ai_needs_review) {
        await updateTransaction(txId, 'ai_needs_review', false);
      }
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, category_id: categoryId || null, ai_needs_review: false } : t)));

      if (categoryId && tx?.description) {
        const normDesc = normalizeDesc(tx.description);
        if (normDesc.length >= 5) {
          const similarTxs = transactions.filter((t) =>
            t.id !== txId &&
            t.description &&
            !t.auto_grouping &&
            t.bank_type_id === tx.bank_type_id &&
            (() => {
              const norm = normalizeDesc(t.description!);
              return norm === normDesc ||
                (norm.length >= 10 && normDesc.length >= 10 && (norm.startsWith(normDesc) || normDesc.startsWith(norm) || norm.includes(normDesc) || normDesc.includes(norm)));
            })()
          );

          if (similarTxs.length > 0) {
            await Promise.all(similarTxs.map((t) =>
              Promise.all([
                updateTransaction(t.id, 'category_id', categoryId),
                t.ai_needs_review ? updateTransaction(t.id, 'ai_needs_review', false) : Promise.resolve(true),
              ])
            ));
            setTransactions((prev) =>
              prev.map((t) => {
                if (similarTxs.some((s) => s.id === t.id)) {
                  return { ...t, category_id: categoryId, ai_needs_review: false };
                }
                return t;
              }),
            );
          }
        }
      }
    }
  };

  const handleAutoGroupingChange = async (txId: string, value: string) => {
    const ok = await updateTransaction(txId, 'auto_grouping', value || null);
    if (ok) {
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, auto_grouping: value || null } : t)));

      if (!value) {
        const tx = transactions.find((t) => t.id === txId);
        if (tx && !tx.category_id && tx.description && txCategories.length > 0) {
          const existingCategorized = transactions.filter((t) => t.category_id && t.description && t.bank_type_id === tx.bank_type_id && t.id !== txId);
          const localMatches = localPatternMatch(
            [{ id: txId, description: tx.description }],
            existingCategorized.map((t) => ({ description: t.description!, category_id: t.category_id! })),
          );
          const localCatId = localMatches.get(txId);
          if (localCatId) {
            await updateTransaction(txId, 'category_id', localCatId);
            setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, category_id: localCatId } : t)));
          } else {
            const catIdToName = new Map(txCategories.map((c) => [c.id, c.name]));
            const examples = existingCategorized
              .filter((t) => catIdToName.has(t.category_id!))
              .map((t) => ({ description: t.description!, categoryName: catIdToName.get(t.category_id!)! }));
            const bankTypePrompt = bankTypes.find((b) => b.id === tx.bank_type_id)?.ai_prompt;
            const { catMap, lowConfidenceIds } = await aiCategorize(
              [{ id: txId, description: tx.description }],
              txCategories.map((c) => ({ id: c.id, name: c.name })),
              bankTypePrompt,
              examples,
            );
            const catId = catMap.get(txId);
            if (catId) {
              const needsReview = lowConfidenceIds.has(txId);
              await updateTransaction(txId, 'category_id', catId);
              if (needsReview) await updateTransaction(txId, 'ai_needs_review', true);
              setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, category_id: catId, ai_needs_review: needsReview } : t)));
            }
          }
        }
      }
    }
  };

  const saveInlineEdit = async (txId: string, field: string, value: string) => {
    setEditingCell(null);
    const dbValue = field === 'amount' ? (value ? parseFloat(value) : null) : (value || null);
    const ok = await updateTransaction(txId, field, dbValue);
    if (ok) {
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, [field]: dbValue } : t)));
    }
  };

  const handleDeleteTx = async (txId: string) => {
    if (await deleteTransaction(txId)) {
      setTransactions((prev) => prev.filter((t) => t.id !== txId));
    }
  };

  const handleAddRow = async () => {
    if (!selectedBankType) return;
    const tx = await createTransaction(selectedProjectId, selectedBankType, {});
    if (tx) {
      setTransactions((prev) => [tx, ...prev]);
    }
  };

  return {
    // State
    notice, canEdit, selectedBankType, setSelectedBankType, setSelectedSheetId,
    showAddType, setShowAddType, newTypeName, setNewTypeName,
    showAddCategory, setShowAddCategory, newCatName, setNewCatName,
    newCatType, setNewCatType, showCategoryManager, setShowCategoryManager,
    confirmDeleteSheet, setConfirmDeleteSheet, confirmDeleteAll, setConfirmDeleteAll,
    editingCell, setEditingCell, editValue, setEditValue,
    editingHeader, headerEditValue, setEditingHeader, setHeaderEditValue,
    colWidths, handleResizeStart,
    // Refs
    fileInputRef, quickFileInputRef,
    // Derived
    approvedBankTypes, bankTypes, txCategories, transactions, filteredTransactions,
    sheetsForType, effectiveSheetId, activeSheet, dynamicColumns, hasRawData,
    // Preview modal
    previewOpen, setPreviewOpen, previewFile, setPreviewFile,
    previewRows, setPreviewRows, previewWorkbook, setPreviewWorkbook, previewInitialConfig,
    // Handlers
    handleRequestBankType, handleAddCategory, handleToggleCategoryType,
    handleExcelUpload, handleQuickUpload, processExcelWithMapping,
    handleDeleteSheet, handleDeleteAllForType, handleRenameHeader,
    handleCategoryChange, handleAutoGroupingChange, saveInlineEdit,
    handleDeleteTx, handleAddRow,
  };
}
