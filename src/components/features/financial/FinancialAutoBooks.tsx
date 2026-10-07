'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { ProjectPermission } from '@/lib/types/project';
import { FinancialBankType, FinancialTxCategory, FinancialTransaction, FinancialUploadSheet } from '@/lib/types/financial';
import {
  createBankType, approveBankType, rejectBankType,
  ensureDefaultBankTypes,
  ensureDistinctTxCategories, createTxCategory,
  getTransactions, updateTransaction, deleteTransaction, createTransaction, bulkCreateTransactions,
  getUploadSheets, createUploadSheet, deleteUploadSheet, updateSheetColumnHeaders,
} from '@/lib/db/financial';
import { logUserAction } from '@/lib/db/user-logs';
import { Upload, Plus, Trash2, X, Check, Pencil, Bot, User, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';

/** Call the server-side Gemini API route to auto-categorize transactions. */
async function aiCategorize(
  txs: { id: string; description: string }[],
  categories: { id: string; name: string }[],
  customPrompt?: string,
): Promise<{ catMap: Map<string, string>; lowConfidenceIds: Set<string> }> {
  const catMap = new Map<string, string>();
  const lowConfidenceIds = new Set<string>();
  if (txs.length === 0 || categories.length === 0) return { catMap, lowConfidenceIds };

  try {
    const res = await fetch('/api/ai/categorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: txs, categories, customPrompt: customPrompt || undefined }),
    });
    if (!res.ok) return { catMap, lowConfidenceIds };
    const data = await res.json();
    if (Array.isArray(data.results)) {
      for (const r of data.results) {
        if (r.txId && r.categoryId) {
          catMap.set(r.txId, r.categoryId);
          if (r.confidence === 'low') lowConfidenceIds.add(r.txId);
        }
      }
    }
  } catch {
    console.error('AI categorize failed');
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
  const displayNameRef = useRef('Unknown');
  const userEmailRef = useRef('');

  const permLevel = userPermission?.perm_reports ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;
  const isAdmin = !userPermission; // no permission row = project owner/admin

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
  const pendingBankTypes = bankTypes.filter((b) => b.status === 'pending');

  const handleRequestBankType = async () => {
    if (!newTypeName.trim()) return;
    const status = isAdmin ? 'approved' : 'pending';
    const bt = await createBankType(selectedProjectId, newTypeName.trim(), status);
    if (bt) {
      setBankTypes((prev) => [...prev, bt]);
      if (status === 'approved') {
        setSelectedBankType(bt.id);
        log(`Added bank type "${newTypeName.trim()}"`);
      } else {
        setNotice(`Request for "${newTypeName.trim()}" sent to admin.`);
        log(`Requested bank type "${newTypeName.trim()}"`);
      }
    }
    setNewTypeName('');
    setShowAddType(false);
  };

  const handleApproveBankType = async (id: string) => {
    if (await approveBankType(id)) {
      setBankTypes((prev) => prev.map((b) => (b.id === id ? { ...b, status: 'approved' } : b)));
      const bt = bankTypes.find((b) => b.id === id);
      log(`Approved bank type "${bt?.name}"`);
    }
  };

  const handleRejectBankType = async (id: string) => {
    const bt = bankTypes.find((b) => b.id === id);
    if (await rejectBankType(id)) {
      setBankTypes((prev) => prev.filter((b) => b.id !== id));
      log(`Rejected bank type "${bt?.name}"`);
    }
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

  // ── Upload handler ───────────────────────────────────────────

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedBankType) return;

    const sheetName = file.name.replace(/\.[^/.]+$/, ''); // filename without extension
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

    let rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(xlSheet, { defval: '' });

    const firstRow = rows[0];
    const keys = firstRow ? Object.keys(firstRow) : [];
    const hasRecognizableHeaders = keys.some((k) => /date|amount|description|posting|transaction|memo|debit|credit/i.test(k));

    if (!hasRecognizableHeaders) {
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(xlSheet, { defval: '', header: 1 });
      rows = rawRows.map((arr) => {
        const obj: Record<string, unknown> = {};
        if (Array.isArray(arr)) {
          arr.forEach((val, i) => { obj[`Col${i + 1}`] = val; });
        }
        return obj;
      });
    }

    // Collect column headers from the first valid row
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

      // Collect headers from first data row
      if (columnHeaders.length === 0) {
        Object.keys(rawData).forEach((k) => columnHeaders.push(k));
      }

      const dateVal = findCol(row, ['Date', 'Posting Date', 'Transaction Date', 'Trans Date', 'Posted Date', 'Col1']);
      const descVal = findCol(row, ['Description', 'Memo', 'Narrative', 'Payee', 'Details', 'Transaction Description']);

      let amount = 0;
      const creditDebitIndicator = String(findCol(row, ['Credit Debit Indicator', 'Debit/Credit']) ?? '').toLowerCase();
      const amountVal = findCol(row, ['Amount', 'Transaction Amount', 'Instructed Amount', 'Col2']);

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
      // Pre-filter duplicates against existing local rows and this upload itself.
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

      // Create a sheet only when there are net-new rows to persist.
      const sheet = await createUploadSheet(selectedProjectId, selectedBankType, sheetName, columnHeaders, user?.id ?? null);
      const sheetId = sheet?.id ?? null;
      const created = await bulkCreateTransactions(selectedProjectId, selectedBankType, sheetId, uniqueParsed);
      setTransactions((prev) => [...created, ...prev]);
      if (sheet) {
        setSheets((prev) => [...prev, sheet]);
        setSelectedSheetId(sheet.id);
      }
      log(`Uploaded ${created.length} transactions from "${file.name}"`);

      // AI auto-categorize new transactions that are set to "Auto" (default)
      const autoTxs = created.filter((t) => !t.auto_grouping && t.description);
      if (autoTxs.length > 0 && txCategories.length > 0) {
        const bankTypePrompt = bankTypes.find((b) => b.id === selectedBankType)?.ai_prompt;
        const { catMap, lowConfidenceIds } = await aiCategorize(
          autoTxs.map((t) => ({ id: t.id, description: t.description! })),
          txCategories.map((c) => ({ id: c.id, name: c.name })),
          bankTypePrompt,
        );
        if (catMap.size > 0) {
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

      const duplicateCount = Math.max(0, parsed.length - uniqueParsed.length);
      setNotice(
        duplicateCount > 0
          ? `Uploaded "${sheetName}" with ${created.length} new rows (${duplicateCount} duplicate entries skipped).`
          : `Uploaded "${sheetName}" with ${created.length} rows.`
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
    }
  };

  const handleAutoGroupingChange = async (txId: string, value: string) => {
    const ok = await updateTransaction(txId, 'auto_grouping', value || null);
    if (ok) {
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, auto_grouping: value || null } : t)));

      // If switching to "Auto" and no category assigned yet, trigger AI categorization
      if (!value) {
        const tx = transactions.find((t) => t.id === txId);
        if (tx && !tx.category_id && tx.description && txCategories.length > 0) {
          const bankTypePrompt = bankTypes.find((b) => b.id === tx.bank_type_id)?.ai_prompt;
          const { catMap, lowConfidenceIds } = await aiCategorize(
            [{ id: txId, description: tx.description }],
            txCategories.map((c) => ({ id: c.id, name: c.name })),
            bankTypePrompt,
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
        <div
          onClick={() => {
            if (!selectedBankType) { setNotice('Select a bank type first.'); return; }
            fileInputRef.current?.click();
          }}
          className="border-2 border-dashed border-primary/30 bg-primary/5 rounded-xl p-8 mb-6 cursor-pointer hover:border-primary hover:bg-primary/10 transition-all text-center max-w-xs shadow-sm"
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="font-semibold text-sm">Upload Financials</p>
          <p className="text-xs text-muted-foreground">.xlsx, .xls, .csv</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleExcelUpload}
            className="hidden"
          />
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
              <button onClick={handleRequestBankType} className="text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all">
                {isAdmin ? 'Add' : 'Request'}
              </button>
            </div>
          ) : (
            <button onClick={() => setShowAddType(true)} className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all">
              <Plus className="h-3.5 w-3.5" /> Request new type
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

      {/* Pending type requests (admin only) */}
      {isAdmin && pendingBankTypes.length > 0 && (
        <div className="mb-4 border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-600 mb-2">Pending Type Requests</p>
          {pendingBankTypes.map((bt) => (
            <div key={bt.id} className="flex items-center gap-2 mb-1">
              <span className="text-xs">{bt.name}</span>
              <button onClick={() => handleApproveBankType(bt.id)} className="text-green-600 hover:text-green-700" title="Approve">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => handleRejectBankType(bt.id)} className="text-red-500 hover:text-red-600" title="Reject">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Sheet tabs */}
      {sheetsForType.length > 0 && (
        <div className="flex items-center gap-1 mb-6 overflow-x-auto border-b border-border/50 pb-1">
          {sheetsForType.map((sheet) => (
            <div key={sheet.id} className="flex items-center group">
                <button
                  onClick={() => setSelectedSheetId(sheet.id)}
                  className={`px-4 py-2 text-[11px] font-bold tracking-wider uppercase rounded-t-lg transition-all ${
                  effectiveSheetId === sheet.id ? 'bg-primary/10 text-primary border-b-2 border-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
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
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold tracking-tight">Bank Data</h3>
          {canEdit && selectedBankType && (
            <button
              onClick={handleAddRow}
              className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all"
            >
              <Plus className="h-4 w-4" /> Add Row
            </button>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold tracking-tight">AutoBooks</span>
            {showAddCategory ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') setShowAddCategory(false); }}
                  placeholder="Category name..."
                  className="px-2 py-1 bg-background/50 border border-input rounded text-xs transition-colors focus:ring-1 focus:ring-primary/50"
                />
                <select
                  value={newCatType}
                  onChange={(e) => setNewCatType(e.target.value as 'expense' | 'income')}
                  className="px-2 py-1 bg-background/50 border border-input rounded text-xs transition-colors focus:ring-1 focus:ring-primary/50"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Gross Income</option>
                </select>
                <button onClick={handleAddCategory} className="text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all">Add</button>
              </div>
            ) : (
              <button onClick={() => setShowAddCategory(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase bg-primary/10 text-primary hover:bg-primary/20 transition-all">
                Add Category
              </button>
            )}
          </div>
        )}
      </div>

      {/* Transactions table — dynamic columns */}
      <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50">
              {hasRawData ? (
                <>
                  {dynamicColumns.map((col, colIndex) => {
                    const isEditing = editingHeader?.sheetId === activeSheet?.id && editingHeader?.index === colIndex;

                    return (
                      <th key={`${col}-${colIndex}`} className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
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
                            className={activeSheet && canEdit ? 'cursor-pointer hover:text-primary group inline-flex items-center gap-1 transition-colors' : ''}
                            onClick={() => {
                              if (activeSheet && canEdit) {
                                setEditingHeader({ sheetId: activeSheet.id, index: colIndex });
                                setHeaderEditValue(col);
                              }
                            }}
                          >
                            {col}
                            {activeSheet && canEdit && <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />}
                          </span>
                        )}
                      </th>
                    );
                  })}
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap min-w-[150px]">Category</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap min-w-[100px]">Notes</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap min-w-[100px]">Auto-Grouping</th>
                  {canEdit && <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap w-8"></th>}
                </>
              ) : (
                <>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap min-w-[100px]">Date</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap min-w-[90px]">Amount</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap min-w-[200px]">Description</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap min-w-[150px]">Category</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap min-w-[100px]">Notes</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap min-w-[100px]">Auto-Grouping</th>
                  {canEdit && <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap w-8"></th>}
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
                <tr key={tx.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
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
                            className={`px-4 py-4 text-xs whitespace-nowrap ${
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
                      <td className="px-4 py-4 text-xs whitespace-nowrap">
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
                            className={`block min-h-5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}
                          >
                            {tx.date ?? <span className="text-muted-foreground/40">-</span>}
                          </span>
                        )}
                      </td>
                      {/* Amount */}
                      <td className={`px-4 py-4 text-xs font-medium whitespace-nowrap ${tx.amount != null && tx.amount < 0 ? 'text-red-500' : tx.amount != null && tx.amount > 0 ? 'text-green-500' : ''}`}>
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
                            className={`block min-h-5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}
                          >
                            {tx.amount != null
                              ? `${tx.amount < 0 ? '-' : ''}$${Math.abs(Number(tx.amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : <span className="text-muted-foreground/40">-</span>}
                          </span>
                        )}
                      </td>
                      {/* Description */}
                      <td className="px-4 py-4 text-xs text-muted-foreground max-w-[200px] whitespace-nowrap">
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
                            className={`block min-h-5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}
                          >
                            {tx.description || <span className="text-muted-foreground/40">-</span>}
                          </span>
                        )}
                      </td>
                    </>
                  )}
                  {/* Category */}
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {tx.category_id ? (
                        tx.ai_needs_review ? (
                          <span title="AI suggested — needs human review. The AI was not confident about this category.">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                          </span>
                        ) : (
                          <span title={tx.auto_grouping === 'Do not group' ? 'Manually categorized' : 'AI categorized'}>
                            {tx.auto_grouping === 'Do not group' ? (
                              <User className="h-3.5 w-3.5 shrink-0 text-orange-400" />
                            ) : (
                              <Bot className="h-3.5 w-3.5 shrink-0 text-blue-400" />
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
                  <td className="px-4 py-4 whitespace-nowrap">
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
                        className={`text-xs block min-h-5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}
                      >
                        {tx.notes || <span className="text-muted-foreground/40">-</span>}
                      </span>
                    )}
                  </td>
                  {/* Auto-Grouping */}
                  <td className="px-4 py-4 whitespace-nowrap">
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
                    <td className="px-4 py-4 whitespace-nowrap">
                      <button onClick={() => handleDeleteTx(tx.id)} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
