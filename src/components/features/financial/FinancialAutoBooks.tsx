'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { ProjectPermission } from '@/lib/types/project';
import { FinancialBankType, FinancialTxCategory, FinancialTransaction, FinancialUploadSheet } from '@/lib/types/financial';
import {
  createBankType,
  ensureDefaultBankTypes,
  ensureDistinctTxCategories, createTxCategory,
  getTransactions, updateTransaction, deleteTransaction, createTransaction, bulkCreateTransactions,
  getUploadSheets, createUploadSheet, deleteUploadSheet, updateSheetColumnHeaders,
} from '@/lib/db/financial';
import { logUserAction } from '@/lib/db/user-logs';
import { Upload, Plus, Trash2, X, Check, Pencil, Bot, User, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';

/** Normalize a description for fuzzy matching */
function normalizeDesc(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\b(srr?#|sr#|srf#|trn#|rfb#|rb#|ref#|ref|ow\d+|cb\d+)\s*\S*/gi, '') // strip reference numbers
    .replace(/\d{4,}/g, '') // strip long number sequences (account numbers, etc.)
    .replace(/[^a-z\s]/g, '') // strip non-alpha
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match new transactions against existing user-categorized ones by normalized description similarity */
function localPatternMatch(
  newTxs: { id: string; description: string }[],
  existingTxs: { description: string; category_id: string }[],
): Map<string, string> {
  const matched = new Map<string, string>();
  if (existingTxs.length === 0) return matched;

  // Build a map of normalized description → category_id from existing user-categorized transactions
  const descToCat = new Map<string, string>();
  for (const tx of existingTxs) {
    if (!tx.description || !tx.category_id) continue;
    const norm = normalizeDesc(tx.description);
    if (norm.length >= 5) descToCat.set(norm, tx.category_id);
  }

  for (const tx of newTxs) {
    const norm = normalizeDesc(tx.description);
    // Exact normalized match
    const exact = descToCat.get(norm);
    if (exact) { matched.set(tx.id, exact); continue; }
    // Prefix/substring match: if the new description starts with or contains an existing pattern
    for (const [pattern, catId] of descToCat) {
      if (pattern.length >= 10 && (norm.startsWith(pattern) || pattern.startsWith(norm) || norm.includes(pattern) || pattern.includes(norm))) {
        matched.set(tx.id, catId);
        break;
      }
    }
  }
  return matched;
}

/** Call the server-side Gemini API route to auto-categorize transactions. */
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

interface Props {
  selectedProjectId: string;
  userPermission?: ProjectPermission | null;
}

export default function FinancialAutoBooks({ selectedProjectId, userPermission }: Props) {
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
  const [editingHeader, setEditingHeader] = useState<{ sheetId: string; index: number } | null>(null);
  const [headerEditValue, setHeaderEditValue] = useState('');
  const [confirmDeleteSheet, setConfirmDeleteSheet] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickFileInputRef = useRef<HTMLInputElement>(null);
  const displayNameRef = useRef('Unknown');
  const userEmailRef = useRef('');

  // ── Excel preview modal state ─────────────────────────────────
  const TEMPLATE_FIELDS = ['Date', 'Amount', 'Description', 'Category', 'Notes', 'Auto-Grouping'] as const;
  type TemplateField = typeof TEMPLATE_FIELDS[number];
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<unknown[][]>([]);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewWorkbook, setPreviewWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [headerRow, setHeaderRow] = useState(0); // 1-indexed row used as column names (0 = none)
  const [dataStartRow, setDataStartRow] = useState(1); // 1-indexed row where data starts
  const [columnMapping, setColumnMapping] = useState<Record<number, TemplateField | 'skip' | string>>({}); // colIndex -> field or custom name
  const [previewPage, setPreviewPage] = useState(0);
  const PREVIEW_PAGE_SIZE = 20;

  const permLevel = userPermission?.perm_reports ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;

  useEffect(() => {
    if (!user) return;
    userEmailRef.current = user.email || '';
    supabase.from('zhl_accounts').select('display_name').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { displayNameRef.current = data?.display_name || user.email || 'Unknown'; });
  }, [user]);

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

  // Auto-clear notice
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const log = (action: string) => {
    if (!user) return;
    logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action });
  };

  // ── Bank type handlers ─────────────────────────────────────

  const approvedBankTypes = bankTypes.filter((b) => !b.status || b.status === 'approved');

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

  // ── Parsing helpers ──────────────────────────────────────────

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
    const d = new Date(str);
    return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
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

  // ── Upload handler — opens preview modal ────────────────────

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

    // Parse excel and open preview modal
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const xlSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(xlSheet, { defval: '', header: 1 });

    // Convert Date objects to strings for preview
    const cleaned = rawRows.map((row) =>
      (row as unknown[]).map((cell) => {
        if (cell instanceof Date) return isNaN(cell.getTime()) ? '' : cell.toISOString().split('T')[0];
        return cell;
      })
    );

    setPreviewRows(cleaned);
    setPreviewFile(file);
    setPreviewWorkbook(workbook);
    setPreviewPage(0);

    // Auto-detect: find the first row that looks like data (has a date-like or numeric value)
    let detectedStart = 1;
    for (let r = 0; r < cleaned.length; r++) {
      const row = cleaned[r];
      const hasDate = row.some((c) => {
        const s = String(c ?? '').trim();
        return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s);
      });
      const hasNumber = row.some((c) => {
        if (typeof c === 'number' && c !== 0) return true;
        const s = String(c ?? '').replace(/[$,]/g, '').trim();
        return s && !isNaN(Number(s)) && Number(s) !== 0;
      });
      if (hasDate || hasNumber) { detectedStart = r + 1; break; } // 1-indexed
    }
    setDataStartRow(detectedStart);

    // Header row = row just before data start (if available)
    const detectedHeaderRow = detectedStart >= 2 ? detectedStart - 1 : 0;
    setHeaderRow(detectedHeaderRow);

    // Auto-detect column mapping from header row (prevent duplicate assignments)
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
    setColumnMapping(newMapping);
    setPreviewOpen(true);
    e.target.value = '';
  };

  // ── Process excel with user's mapping config ───────────────

  const processExcelWithMapping = async () => {
    if (!previewFile || !selectedBankType || !previewWorkbook) return;
    setPreviewOpen(false);

    const sheetName = previewFile.name.replace(/\.[^/.]+$/, '');
    const startIdx = dataStartRow - 1; // Convert to 0-indexed

    // Build mapped column headers from the mapping
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

    // Find which column index maps to each template field
    const dateColIdx = Object.entries(columnMapping).find(([, v]) => v === 'Date')?.[0];
    const amountColIdx = Object.entries(columnMapping).find(([, v]) => v === 'Amount')?.[0];
    const descColIdx = Object.entries(columnMapping).find(([, v]) => v === 'Description')?.[0];

    const parsed: { date: string; amount: number; description: string; raw_data: Record<string, unknown> }[] = [];

    for (let r = startIdx; r < previewRows.length; r++) {
      const row = previewRows[r];
      if (!row || row.every((c) => c === '' || c == null)) continue;

      // Build raw_data from all columns
      const rawData: Record<string, unknown> = {};
      for (let c = 0; c < row.length; c++) {
        const val = row[c];
        if (val === '' || val == null) continue;
        rawData[columnHeaders[c] || `Col${c + 1}`] = val;
      }
      if (Object.keys(rawData).length === 0) continue;

      // Extract mapped fields
      const dateVal = dateColIdx != null ? row[Number(dateColIdx)] : undefined;
      const amountVal = amountColIdx != null ? row[Number(amountColIdx)] : undefined;
      const descVal = descColIdx != null ? row[Number(descColIdx)] : undefined;

      const dateStr = parseDate(dateVal);
      const amount = amountVal != null ? parseAmount(amountVal) : 0;
      let description = descVal != null ? String(descVal ?? '').trim() : '';

      // Fallback description from non-numeric values
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

      // Auto-categorize: local pattern matching first, then AI for the rest
      let categorizedCount = 0;
      const autoTxs = created.filter((t) => !t.auto_grouping && t.description);
      if (autoTxs.length > 0 && txCategories.length > 0) {
        // Build list of existing user-categorized transactions for training
        const existingCategorized = transactions.filter((t) => t.category_id && t.description && t.bank_type_id === selectedBankType);

        // 1) Local pattern match against user history
        const localMatches = localPatternMatch(
          autoTxs.map((t) => ({ id: t.id, description: t.description! })),
          existingCategorized.map((t) => ({ description: t.description!, category_id: t.category_id! })),
        );

        // Apply local matches immediately
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

        // 2) AI categorize the remaining unmatched transactions
        const unmatchedTxs = autoTxs.filter((t) => !localMatches.has(t.id));
        if (unmatchedTxs.length > 0) {
          // Build examples from user-assigned categories for AI training
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
            const updates = Array.from(catMap.entries());
            await Promise.all(updates.map(([txId, catId]) => {
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
      }

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

  // ── Quick upload (clean files — row 1 = headers, row 2+ = data) ──

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

    // Row 1 = headers, row 2+ = data — use standard sheet_to_json which treats row 1 as headers
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

      // Auto-categorize: local pattern matching first, then AI for the rest
      let categorizedCount = 0;
      const autoTxs = created.filter((t) => !t.auto_grouping && t.description);
      if (autoTxs.length > 0 && txCategories.length > 0) {
        const existingCategorized = transactions.filter((t) => t.category_id && t.description && t.bank_type_id === selectedBankType);

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
      }

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
      // Delete all sheets for this bank type (cascade deletes their transactions)
      const typeSheets = sheets.filter((s) => s.bank_type_id === selectedBankType);
      for (const s of typeSheets) {
        await deleteUploadSheet(s.id);
      }
      // Also delete any orphan transactions (no sheet_id) for this bank type
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
      // No bank type selected — delete ALL transactions and sheets
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
      // Clear review flag in DB when user manually changes category
      const tx = transactions.find((t) => t.id === txId);
      if (tx?.ai_needs_review) {
        await updateTransaction(txId, 'ai_needs_review', false);
      }
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, category_id: categoryId || null, ai_needs_review: false } : t)));

      // Propagate to similar descriptions: find other transactions with similar descriptions
      // that have auto_grouping = Auto (null) and update them to the same category
      if (categoryId && tx?.description) {
        const normDesc = normalizeDesc(tx.description);
        if (normDesc.length >= 5) {
          const similarTxs = transactions.filter((t) =>
            t.id !== txId &&
            t.description &&
            !t.auto_grouping && // Only auto-grouped ones
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

      // If switching to "Auto" and no category assigned yet, trigger categorization
      if (!value) {
        const tx = transactions.find((t) => t.id === txId);
        if (tx && !tx.category_id && tx.description && txCategories.length > 0) {
          // Try local match first
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
            // Fall back to AI with examples
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

  // ── Derived data ─────────────────────────────────────────────

  // Sheets for the selected bank type
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

  // Filter transactions by bank type + sheet
  const filteredTransactions = useMemo(() => {
    let txs = selectedBankType
      ? transactions.filter((t) => t.bank_type_id === selectedBankType)
      : transactions;
    if (effectiveSheetId) txs = txs.filter((t) => t.sheet_id === effectiveSheetId);
    else txs = [];
    return txs;
  }, [transactions, selectedBankType, effectiveSheetId]);

  // Get column headers from the selected sheet, or derive from raw_data
  const activeSheet = effectiveSheetId ? sheets.find((s) => s.id === effectiveSheetId) : null;

  const dynamicColumns = useMemo(() => {
    // If a specific sheet is selected and has column_headers, use those
    if (activeSheet && activeSheet.column_headers.length > 0) {
      return activeSheet.column_headers;
    }
    // Otherwise derive from raw_data across filtered transactions
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

  const formatCellValue = (val: unknown): string => {
    if (val == null || val === '') return '-';
    if (typeof val === 'number') {
      if (Math.abs(val) >= 0.01) {
        return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      return String(val);
    }
    return String(val);
  };

  const isAmountColumn = (colName: string): boolean => {
    return /amount|debit|credit|balance|running bal|summary amt/i.test(colName);
  };

  // Map display headers to raw_data keys (when headers are renamed, raw_data keys stay the same)
  const rawKeyForColumn = (colIndex: number): string => {
    if (!activeSheet) return dynamicColumns[colIndex] ?? '';
    // The sheet's original raw_data keys come from the first upload — derive from any transaction
    const anyTx = filteredTransactions.find((t) => t.raw_data);
    if (anyTx?.raw_data) {
      const rawKeys = Object.keys(anyTx.raw_data);
      return rawKeys[colIndex] ?? dynamicColumns[colIndex] ?? '';
    }
    return dynamicColumns[colIndex] ?? '';
  };

  return (
    <div>
      {/* Notice */}
      {notice && (
        <div className="mb-4 px-3 py-2 bg-accent/10 border border-accent/30 rounded text-xs text-accent font-medium">
          {notice}
        </div>
      )}

      {/* Upload area */}
      {canEdit && (
        <div className="flex gap-4 mb-6 flex-wrap">
          <div
            onClick={() => {
              if (!selectedBankType) { setNotice('Select a bank type first.'); return; }
              quickFileInputRef.current?.click();
            }}
            className="border-2 border-dashed border-border rounded-lg p-6 cursor-pointer hover:border-accent/50 transition-colors text-center w-52"
          >
            <Upload className="h-7 w-7 mx-auto mb-1.5 text-muted-foreground" />
            <p className="font-semibold text-sm">Quick Upload</p>
            <p className="text-xs text-muted-foreground">Clean file — row 1 is headers</p>
            <input
              ref={quickFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleQuickUpload}
              className="hidden"
            />
          </div>
          <div
            onClick={() => {
              if (!selectedBankType) { setNotice('Select a bank type first.'); return; }
              fileInputRef.current?.click();
            }}
            className="border-2 border-dashed border-border rounded-lg p-6 cursor-pointer hover:border-accent/50 transition-colors text-center w-52"
          >
            <Upload className="h-7 w-7 mx-auto mb-1.5 text-muted-foreground" />
            <p className="font-semibold text-sm">Upload with Preview</p>
            <p className="text-xs text-muted-foreground">Configure rows &amp; columns</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelUpload}
              className="hidden"
            />
          </div>
        </div>
      )}

      {/* Bank Type selector */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm font-semibold">Type:</span>
        <select
          value={selectedBankType ?? ''}
          onChange={(e) => { setSelectedBankType(e.target.value || null); setSelectedSheetId(null); }}
          className="px-3 py-1.5 bg-background border border-input rounded text-sm"
        >
          <option value="">Select type...</option>
          {approvedBankTypes.map((bt) => (
            <option key={bt.id} value={bt.id}>{bt.name}</option>
          ))}
        </select>
        {canEdit && (
          showAddType ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRequestBankType(); if (e.key === 'Escape') setShowAddType(false); }}
                placeholder="Bank name..."
                className="px-2 py-1 bg-background border border-input rounded text-xs"
              />
              <button onClick={handleRequestBankType} className="text-xs text-accent font-semibold">
                Request
              </button>
            </div>
          ) : (
            <button onClick={() => setShowAddType(true)} className="flex items-center gap-1 text-xs text-accent font-semibold">
              <Plus className="h-3 w-3" /> Request new type
            </button>
          )
        )}
      </div>

      {/* Delete all data */}
      {canEdit && filteredTransactions.length > 0 && (
        <div className="mb-4">
          {confirmDeleteAll ? (
            <div className="flex items-center gap-2 border border-red-500/30 bg-red-500/10 rounded px-3 py-2">
              <span className="text-xs text-red-500 font-medium">
                Delete all {selectedBankType ? `data for "${bankTypes.find((b) => b.id === selectedBankType)?.name}"` : 'transaction data'}? This cannot be undone.
              </span>
              <button onClick={handleDeleteAllForType} className="px-2 py-0.5 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600">
                Delete
              </button>
              <button onClick={() => setConfirmDeleteAll(false)} className="px-2 py-0.5 bg-muted text-foreground rounded text-xs font-medium hover:bg-muted/80">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDeleteAll(true)}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 font-medium border border-red-500/30 rounded px-3 py-1.5 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete all data
            </button>
          )}
        </div>
      )}

      {/* Sheet tabs */}
      {sheetsForType.length > 0 && (
        <div className="flex items-center gap-1 mb-4 overflow-x-auto border-b border-border">
          {sheetsForType.map((sheet) => (
            <div key={sheet.id} className="flex items-center group">
                <button
                  onClick={() => setSelectedSheetId(sheet.id)}
                  className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  effectiveSheetId === sheet.id ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                >
                {sheet.name}
              </button>
              {canEdit && (
                confirmDeleteSheet === sheet.id ? (
                  <div className="flex items-center gap-1 ml-1">
                    <button onClick={() => handleDeleteSheet(sheet.id)} className="text-red-500 hover:text-red-600" title="Confirm delete">
                      <Check className="h-3 w-3" />
                    </button>
                    <button onClick={() => setConfirmDeleteSheet(null)} className="text-muted-foreground hover:text-foreground" title="Cancel">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteSheet(sheet.id)}
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
                    title="Delete sheet"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bank Data header + Add Row + Add Category */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold">Bank Data</h3>
          {canEdit && selectedBankType && (
            <button
              onClick={handleAddRow}
              className="flex items-center gap-1 text-xs text-accent font-semibold hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add Row
            </button>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">AutoBooks</span>
            {showAddCategory ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') setShowAddCategory(false); }}
                  placeholder="Category name..."
                  className="px-2 py-1 bg-background border border-input rounded text-xs"
                />
                <select
                  value={newCatType}
                  onChange={(e) => setNewCatType(e.target.value as 'expense' | 'income')}
                  className="px-2 py-1 bg-background border border-input rounded text-xs"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Gross Income</option>
                </select>
                <button onClick={handleAddCategory} className="text-xs text-accent font-semibold">Add</button>
              </div>
            ) : (
              <button onClick={() => setShowAddCategory(true)} className="text-xs text-accent font-semibold">Add Category</button>
            )}
          </div>
        )}
      </div>

      {/* Transactions table — dynamic columns */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {hasRawData ? (
                <>
                  {dynamicColumns.map((col, colIndex) => {
                    const isEditing = editingHeader?.sheetId === activeSheet?.id && editingHeader?.index === colIndex;

                    return (
                      <th key={`${col}-${colIndex}`} className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={headerEditValue}
                            onChange={(e) => setHeaderEditValue(e.target.value)}
                            onBlur={() => handleRenameHeader(activeSheet!.id, colIndex, headerEditValue)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameHeader(activeSheet!.id, colIndex, headerEditValue);
                              if (e.key === 'Escape') setEditingHeader(null);
                            }}
                            className="px-1 py-0 bg-background border border-input rounded text-xs font-semibold w-24"
                          />
                        ) : (
                          <span
                            className={activeSheet && canEdit ? 'cursor-pointer hover:text-accent group inline-flex items-center gap-1' : ''}
                            onClick={() => {
                              if (activeSheet && canEdit) {
                                setEditingHeader({ sheetId: activeSheet.id, index: colIndex });
                                setHeaderEditValue(col);
                              }
                            }}
                          >
                            {col}
                            {activeSheet && canEdit && <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-50" />}
                          </span>
                        )}
                      </th>
                    );
                  })}
                  <th className="px-3 py-2 text-left text-xs font-semibold min-w-[150px]">Category</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold min-w-[100px]">Notes</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold min-w-[100px]">Auto-Grouping</th>
                  {canEdit && <th className="px-3 py-2 w-8"></th>}
                </>
              ) : (
                <>
                  <th className="px-3 py-2 text-left text-xs font-semibold min-w-[100px]">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold min-w-[90px]">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold min-w-[200px]">Description</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold min-w-[150px]">Category</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold min-w-[100px]">Notes</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold min-w-[100px]">Auto-Grouping</th>
                  {canEdit && <th className="px-3 py-2 w-8"></th>}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan={hasRawData ? dynamicColumns.length + 3 + (canEdit ? 1 : 0) : (canEdit ? 7 : 6)} className="px-3 py-8 text-center text-muted-foreground text-sm">
                  {transactions.length === 0
                    ? 'No transactions yet. Upload an Excel or CSV file to import.'
                    : 'No transactions for this selection. Select a different type or sheet, or upload data.'}
                </td>
              </tr>
            ) : (
              filteredTransactions.map((tx) => (
                <tr key={tx.id} className="border-b border-border hover:bg-muted/30">
                  {hasRawData ? (
                    <>
                      {dynamicColumns.map((col, colIndex) => {
                        const rawKey = rawKeyForColumn(colIndex);
                        const val = tx.raw_data?.[rawKey] ?? tx.raw_data?.[col];
                        const numVal = typeof val === 'number' ? val : (typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : NaN);
                        const isAmt = isAmountColumn(rawKey || col) && !isNaN(numVal);

                        return (
                          <td
                            key={`${col}-${colIndex}`}
                            className={`px-3 py-2 text-xs whitespace-nowrap ${
                              isAmt && numVal < 0 ? 'text-red-500 font-medium' : isAmt && numVal > 0 ? 'text-green-500 font-medium' : ''
                            }`}
                          >
                            {isAmt ? formatCellValue(numVal) : formatCellValue(val)}
                          </td>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      {/* Date */}
                      <td className="px-3 py-2 text-xs">
                        {editingCell?.id === tx.id && editingCell?.field === 'date' ? (
                          <input
                            autoFocus
                            type="date"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineEdit(tx.id, 'date', editValue)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveInlineEdit(tx.id, 'date', editValue);
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs"
                          />
                        ) : (
                          <span
                            onClick={canEdit ? () => { setEditingCell({ id: tx.id, field: 'date' }); setEditValue(tx.date ?? ''); } : undefined}
                            className={`block min-h-[1.25rem] ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}
                          >
                            {tx.date ?? <span className="text-muted-foreground/40">-</span>}
                          </span>
                        )}
                      </td>
                      {/* Amount */}
                      <td className={`px-3 py-2 text-xs font-medium ${tx.amount != null && tx.amount < 0 ? 'text-red-500' : tx.amount != null && tx.amount > 0 ? 'text-green-500' : ''}`}>
                        {editingCell?.id === tx.id && editingCell?.field === 'amount' ? (
                          <input
                            autoFocus
                            type="number"
                            step="0.01"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineEdit(tx.id, 'amount', editValue)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveInlineEdit(tx.id, 'amount', editValue);
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs"
                          />
                        ) : (
                          <span
                            onClick={canEdit ? () => { setEditingCell({ id: tx.id, field: 'amount' }); setEditValue(tx.amount != null ? String(tx.amount) : ''); } : undefined}
                            className={`block min-h-[1.25rem] ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}
                          >
                            {tx.amount != null
                              ? `${tx.amount < 0 ? '-' : ''}$${Math.abs(Number(tx.amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : <span className="text-muted-foreground/40">-</span>}
                          </span>
                        )}
                      </td>
                      {/* Description */}
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px]">
                        {editingCell?.id === tx.id && editingCell?.field === 'description' ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineEdit(tx.id, 'description', editValue)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveInlineEdit(tx.id, 'description', editValue);
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs"
                          />
                        ) : (
                          <span
                            onClick={canEdit ? () => { setEditingCell({ id: tx.id, field: 'description' }); setEditValue(tx.description ?? ''); } : undefined}
                            className={`block min-h-[1.25rem] ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}
                          >
                            {tx.description || <span className="text-muted-foreground/40">-</span>}
                          </span>
                        )}
                      </td>
                    </>
                  )}
                  {/* Category */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {tx.category_id ? (
                        tx.ai_needs_review ? (
                          <span title="AI suggested — needs human review. The AI was not confident about this category.">
                            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
                          </span>
                        ) : (
                          <span title={tx.auto_grouping === 'Do not group' ? 'Manually categorized' : 'AI categorized'}>
                            {tx.auto_grouping === 'Do not group' ? (
                              <User className="h-3.5 w-3.5 flex-shrink-0 text-orange-400" />
                            ) : (
                              <Bot className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
                            )}
                          </span>
                        )
                      ) : null}
                      <select
                        value={tx.category_id ?? ''}
                        onChange={(e) => handleCategoryChange(tx.id, e.target.value)}
                        disabled={!canEdit}
                        className="w-full px-2 py-1 bg-background border border-input rounded text-xs"
                      >
                        <option value="">--</option>
                        {txCategories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.icon} {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  {/* Notes */}
                  <td className="px-3 py-2">
                    {editingCell?.id === tx.id && editingCell?.field === 'notes' ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => saveInlineEdit(tx.id, 'notes', editValue)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveInlineEdit(tx.id, 'notes', editValue);
                          if (e.key === 'Escape') setEditingCell(null);
                        }}
                        className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs"
                      />
                    ) : (
                      <span
                        onClick={canEdit ? () => { setEditingCell({ id: tx.id, field: 'notes' }); setEditValue(tx.notes ?? ''); } : undefined}
                        className={`text-xs block min-h-[1.25rem] ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}
                      >
                        {tx.notes || <span className="text-muted-foreground/40">-</span>}
                      </span>
                    )}
                  </td>
                  {/* Auto-Grouping */}
                  <td className="px-3 py-2">
                    <select
                      value={tx.auto_grouping ?? ''}
                      onChange={(e) => handleAutoGroupingChange(tx.id, e.target.value)}
                      disabled={!canEdit}
                      className="w-full px-2 py-1 bg-background border border-input rounded text-xs"
                    >
                      <option value="">Auto</option>
                      <option value="Do not group">Do not group</option>
                    </select>
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <button onClick={() => handleDeleteTx(tx.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Excel Preview Modal ──────────────────────────────── */}
      {previewOpen && previewRows.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <h3 className="text-sm font-bold">Preview &amp; Configure Upload</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {previewFile?.name} — {previewRows.length} rows detected
                </p>
              </div>
              <button onClick={() => { setPreviewOpen(false); setPreviewFile(null); setPreviewWorkbook(null); setPreviewRows([]); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Controls */}
            <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold whitespace-nowrap">Header row:</label>
                <input
                  type="number"
                  min={0}
                  max={previewRows.length}
                  value={headerRow}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(previewRows.length, parseInt(e.target.value) || 0));
                    setHeaderRow(v);
                    if (v >= dataStartRow) setDataStartRow(v + 1);
                    setPreviewPage(0);
                  }}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                />
                <span className="text-xs text-muted-foreground">(0 = none)</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold whitespace-nowrap">Data starts at row:</label>
                <input
                  type="number"
                  min={1}
                  max={previewRows.length}
                  value={dataStartRow}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(previewRows.length, parseInt(e.target.value) || 1));
                    setDataStartRow(v);
                    // Auto-set header row to the row just before data
                    if (v >= 2) setHeaderRow(v - 1);
                    setPreviewPage(0);
                  }}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                />
                <span className="text-xs text-muted-foreground">
                  ({previewRows.length - dataStartRow + 1} data rows)
                </span>
              </div>
            </div>

            {/* Column mapping row — shows header names from the selected header row */}
            <div className="px-5 py-2 border-b border-border overflow-x-auto">
              <div className="flex items-center gap-1 min-w-max">
                <div className="w-12 flex-shrink-0 text-xs font-semibold text-muted-foreground text-center">Row</div>
                {Array.from({ length: Math.max(...previewRows.map((r) => r.length), 0) }, (_, colIdx) => {
                  const hdrVal = headerRow >= 1 ? String(previewRows[headerRow - 1]?.[colIdx] ?? '').trim() : '';
                  const currentVal = columnMapping[colIdx] ?? 'skip';
                  const isCustom = currentVal !== 'skip' && !(TEMPLATE_FIELDS as readonly string[]).includes(currentVal);
                  return (
                    <div key={colIdx} className="w-32 flex-shrink-0">
                      {hdrVal && (
                        <div className="text-xs text-blue-400 font-medium truncate mb-0.5 px-1" title={hdrVal}>
                          {hdrVal}
                        </div>
                      )}
                      {isCustom ? (
                        <div className="flex gap-0.5">
                          <input
                            value={currentVal}
                            onChange={(e) => {
                              const val = e.target.value;
                              setColumnMapping((prev) => ({ ...prev, [colIdx]: val || 'skip' }));
                            }}
                            className="flex-1 min-w-0 px-1.5 py-1 border border-accent bg-accent/10 text-accent font-semibold rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            placeholder="Column name"
                          />
                          <button
                            onClick={() => setColumnMapping((prev) => ({ ...prev, [colIdx]: 'skip' }))}
                            className="px-1 text-muted-foreground hover:text-destructive flex-shrink-0"
                            title="Clear"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <select
                          value={currentVal}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '__custom__') {
                              // Set to the header value or empty custom name
                              setColumnMapping((prev) => ({ ...prev, [colIdx]: hdrVal || 'Custom' }));
                              return;
                            }
                            setColumnMapping((prev) => {
                              const next = { ...prev };
                              // For template fields, ensure only one column has each field
                              if (val !== 'skip' && (TEMPLATE_FIELDS as readonly string[]).includes(val)) {
                                for (const [k, v] of Object.entries(next)) {
                                  if (v === val) next[Number(k)] = 'skip';
                                }
                              }
                              next[colIdx] = val;
                              return next;
                            });
                          }}
                          className={`w-full px-1.5 py-1 border rounded text-xs ${
                            currentVal !== 'skip'
                              ? 'border-accent bg-accent/10 text-accent font-semibold'
                              : 'border-input bg-background text-muted-foreground'
                          }`}
                        >
                          <option value="skip">— Skip —</option>
                          {TEMPLATE_FIELDS.map((f) => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                          <option value="__custom__">Custom name...</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Data preview table */}
            <div className="flex-1 overflow-auto px-5 py-2">
              <div className="min-w-max">
                {(() => {
                  const pageStart = previewPage * PREVIEW_PAGE_SIZE;
                  const pageEnd = Math.min(pageStart + PREVIEW_PAGE_SIZE, previewRows.length);
                  const visibleRows = previewRows.slice(pageStart, pageEnd);
                  const maxCols = Math.max(...previewRows.map((r) => r.length), 0);

                  return visibleRows.map((row, rIdx) => {
                    const actualRowIdx = pageStart + rIdx;
                    const isHeaderRowIdx = headerRow >= 1 && actualRowIdx === headerRow - 1;
                    const isBeforeStart = actualRowIdx < dataStartRow - 1;
                    const isStartRow = actualRowIdx === dataStartRow - 1;

                    return (
                      <div
                        key={actualRowIdx}
                        className={`flex items-center gap-1 ${
                          isHeaderRowIdx
                            ? 'bg-blue-500/10 font-semibold'
                            : isBeforeStart
                            ? 'opacity-40 bg-amber-500/5'
                            : isStartRow
                            ? 'bg-accent/10 border-l-2 border-accent'
                            : 'hover:bg-muted/30'
                        }`}
                      >
                        <div
                          className={`w-12 flex-shrink-0 text-xs text-center py-1 cursor-pointer hover:text-accent font-mono ${
                            isHeaderRowIdx ? 'text-blue-500 font-bold' : isStartRow ? 'text-accent font-bold' : 'text-muted-foreground'
                          }`}
                          onClick={() => { setDataStartRow(actualRowIdx + 1); if (actualRowIdx >= 1) setHeaderRow(actualRowIdx); setPreviewPage(0); }}
                          title={`Click to set data start at row ${actualRowIdx + 1}`}
                        >
                          {actualRowIdx + 1}
                        </div>
                        {Array.from({ length: maxCols }, (_, cIdx) => {
                          const val = row[cIdx];
                          const mapped = columnMapping[cIdx];
                          const isMapped = mapped && mapped !== 'skip';
                          return (
                            <div
                              key={cIdx}
                              className={`w-32 flex-shrink-0 px-1.5 py-1 text-xs truncate border-r border-border/30 ${
                                isMapped && !isBeforeStart ? 'font-medium' : ''
                              }`}
                              title={String(val ?? '')}
                            >
                              {val != null && val !== '' ? String(val) : <span className="text-muted-foreground/30">-</span>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Pagination + Actions */}
            <div className="px-5 py-3 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  disabled={previewPage === 0}
                  onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
                  className="p-1 rounded border border-input text-xs disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs text-muted-foreground">
                  Rows {previewPage * PREVIEW_PAGE_SIZE + 1}–{Math.min((previewPage + 1) * PREVIEW_PAGE_SIZE, previewRows.length)} of {previewRows.length}
                </span>
                <button
                  disabled={(previewPage + 1) * PREVIEW_PAGE_SIZE >= previewRows.length}
                  onClick={() => setPreviewPage((p) => p + 1)}
                  className="p-1 rounded border border-input text-xs disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Mapped: {Object.values(columnMapping).filter((v) => v !== 'skip').length}/{Math.max(...previewRows.map((r) => r.length), 0)} fields
                </span>
                <button
                  onClick={() => { setPreviewOpen(false); setPreviewFile(null); setPreviewWorkbook(null); setPreviewRows([]); }}
                  className="px-3 py-1.5 text-xs border border-input rounded hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={processExcelWithMapping}
                  disabled={!Object.values(columnMapping).some((v) => v !== 'skip')}
                  className="px-4 py-1.5 text-xs bg-accent text-white rounded font-semibold hover:bg-accent/90 disabled:opacity-50"
                >
                  Upload {previewRows.length - dataStartRow + 1} rows
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
