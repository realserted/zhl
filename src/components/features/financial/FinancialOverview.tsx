'use client';

import { useState, useEffect, useMemo } from 'react';
import { ProjectPermission } from '@/lib/types/project';
import { usePermission } from '@/lib/hooks/usePermission';
import { useUserLogger } from '@/lib/hooks/useUserLogger';
import {
  FinancialTransaction,
  FinancialTxCategory,
  FinancialLoan,
  FinancialBankType,
  SectionWithItems,
  FinancialMonthlyValue,
} from '@/lib/types/financial';
import {
  getTransactions,
  getTxCategories,
  getLoans,
  getBankTypes,
  getSections,
  getMonthlyValues,
  createLineItem,
  deleteLineItem,
  upsertMonthlyValue,
  seedDefaultFinancials,
} from '@/lib/db/financial';
import { Plus, Trash2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { computeMonthlyPayment, isLoanActiveInMonth } from '@/lib/financial-utils';

interface Props {
  selectedProjectId: string;
  userPermission?: ProjectPermission | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function FinancialOverview({ selectedProjectId, userPermission }: Props) {
  const { canEdit } = usePermission(userPermission, 'perm_reports');
  const { log } = useUserLogger(selectedProjectId);

  // Auto-computed data (from AutoBooks + Debt Schedule)
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [categories, setCategories] = useState<FinancialTxCategory[]>([]);
  const [loans, setLoans] = useState<FinancialLoan[]>([]);
  const [bankTypes, setBankTypes] = useState<FinancialBankType[]>([]);
  const [selectedBankTypeId, setSelectedBankTypeId] = useState<string>('all');

  // Manual sections/line items (from financial_sections/line_items/monthly_values)
  const [sections, setSections] = useState<SectionWithItems[]>([]);
  const [manualValues, setManualValues] = useState<FinancialMonthlyValue[]>([]);

  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState<{ itemId: string; month: number } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addingItem, setAddingItem] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');

  const loadData = async () => {
    setLoading(true);
    const [txs, cats, lns, bts] = await Promise.all([
      getTransactions(selectedProjectId),
      getTxCategories(selectedProjectId),
      getLoans(selectedProjectId),
      getBankTypes(selectedProjectId),
    ]);
    setTransactions(txs);
    setCategories(cats);
    setLoans(lns);
    setBankTypes(bts.filter((b) => b.status === 'approved'));

    // Load manual sections for GROSS INCOME and CASHFLOW line items
    let secs = await getSections(selectedProjectId);
    if (secs.length === 0) {
      await seedDefaultFinancials(selectedProjectId);
      secs = await getSections(selectedProjectId);
    }
    setSections(secs);
    const vals = await getMonthlyValues(selectedProjectId, year);
    setManualValues(vals);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [selectedProjectId, year]);

  // ── Manual values lookup ──────────────────────────────────────────────
  const manualValueMap = useMemo(() => {
    const m = new Map<string, number>();
    manualValues.forEach((v) => m.set(`${v.line_item_id}-${v.month}`, Number(v.value)));
    return m;
  }, [manualValues]);

  const getManualCellValue = (itemId: string, month: number) => manualValueMap.get(`${itemId}-${month}`) ?? 0;

  // Find manual sections by name
  const incomeSection = sections.find((s) => s.name === 'GROSS INCOME');
  const cashflowSection = sections.find((s) => s.name === 'CASHFLOW');

  const getManualSectionTotal = (section: SectionWithItems | undefined, month: number) =>
    section ? section.line_items.reduce((sum, item) => sum + getManualCellValue(item.id, month), 0) : 0;

  // ── Auto-computed data ────────────────────────────────────────────────
  const categoryMap = useMemo(() => {
    const m = new Map<string, FinancialTxCategory>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  const yearTxs = useMemo(
    () =>
      transactions.filter((tx) => {
        if (!tx.date || tx.amount == null) return false;
        if (new Date(tx.date).getFullYear() !== year) return false;
        if (selectedBankTypeId !== 'all' && tx.bank_type_id !== selectedBankTypeId) return false;
        return true;
      }),
    [transactions, year, selectedBankTypeId],
  );

  const txByCatMonth = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    for (const tx of yearTxs) {
      const catId = tx.category_id || '__uncategorized__';
      if (!m.has(catId)) m.set(catId, new Map());
      const month = new Date(tx.date!).getMonth() + 1;
      const mm = m.get(catId)!;
      mm.set(month, (mm.get(month) ?? 0) + (tx.amount ?? 0));
    }
    return m;
  }, [yearTxs]);

  const { incomeItems, expenseItems } = useMemo(() => {
    const income: { id: string; name: string }[] = [];
    const expense: { id: string; name: string }[] = [];
    const seen = new Set<string>();

    // Include ALL categories from AutoBooks (synced), not just those with transactions
    for (const cat of categories) {
      seen.add(cat.id);
      if (cat.category_type === 'income') income.push({ id: cat.id, name: cat.name });
      else expense.push({ id: cat.id, name: cat.name });
    }

    // Also include any transaction-only entries (e.g., uncategorized)
    for (const [catId] of txByCatMonth) {
      if (seen.has(catId)) continue;
      const name = catId === '__uncategorized__' ? 'Uncategorized' : 'Unknown';
      expense.push({ id: catId, name });
    }

    income.sort((a, b) => a.name.localeCompare(b.name));
    expense.sort((a, b) => a.name.localeCompare(b.name));
    return { incomeItems: income, expenseItems: expense };
  }, [categories, txByCatMonth]);

  const getCatVal = (catId: string, month: number) =>
    txByCatMonth.get(catId)?.get(month) ?? 0;

  // ── Section totals ────────────────────────────────────────────────────
  const getIncomeAutoTotal = (month: number) =>
    incomeItems.reduce((s, c) => s + getCatVal(c.id, month), 0);

  const getIncomeTotal = (month: number) =>
    getIncomeAutoTotal(month) + getManualSectionTotal(incomeSection, month);

  const getExpenseTotal = (month: number) =>
    expenseItems.reduce((s, c) => s + Math.abs(getCatVal(c.id, month)), 0);

  const getLoanTotal = (month: number) =>
    loans.reduce((s, ln) => {
      if (!isLoanActiveInMonth(ln, year, month)) return s;
      return s + computeMonthlyPayment(ln);
    }, 0);

  const getCashflowAutoTotal = (month: number) =>
    getIncomeTotal(month) - getExpenseTotal(month) - getLoanTotal(month);

  const getCashflowTotal = (month: number) =>
    getCashflowAutoTotal(month) + getManualSectionTotal(cashflowSection, month);

  // ── Cell editing ──────────────────────────────────────────────────────
  const saveCell = async (itemId: string, month: number, raw: string) => {
    setEditingCell(null);
    const num = parseFloat(raw) || 0;
    const old = getManualCellValue(itemId, month);
    if (num === old) return;
    const ok = await upsertMonthlyValue(itemId, selectedProjectId, year, month, num);
    if (ok) {
      setManualValues((prev) => {
        const existing = prev.find((v) => v.line_item_id === itemId && v.month === month && v.year === year);
        if (existing) return prev.map((v) => (v.id === existing.id ? { ...v, value: num } : v));
        return [...prev, { id: `${itemId}-${year}-${month}`, line_item_id: itemId, project_id: selectedProjectId, year, month, value: num, created_at: '', updated_at: '' }];
      });
      log(`Updated financial value for month ${MONTHS[month - 1]} ${year}`);
    }
  };

  const handleAddItem = async (sectionId: string) => {
    if (!newItemName.trim()) return;
    const section = sections.find((s) => s.id === sectionId);
    const item = await createLineItem(sectionId, selectedProjectId, newItemName.trim(), (section?.line_items.length ?? 0) + 1);
    if (item) {
      setSections((prev) => prev.map((s) => s.id === sectionId ? { ...s, line_items: [...s.line_items, item] } : s));
      log(`Added financial line item "${newItemName.trim()}"`);
    }
    setNewItemName('');
    setAddingItem(null);
  };

  const handleDeleteItem = async (itemId: string, itemName: string) => {
    if (!confirm(`Delete "${itemName}"?`)) return;
    if (await deleteLineItem(itemId)) {
      setSections((prev) => prev.map((s) => ({ ...s, line_items: s.line_items.filter((i) => i.id !== itemId) })));
      log(`Deleted financial line item "${itemName}"`);
    }
  };

  const fmt = (n: number) =>
    n === 0
      ? ''
      : `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const fmtSigned = (n: number) => {
    if (n === 0) return '';
    const sign = n < 0 ? '-' : '';
    return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading overview...</div>;
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto p-1 pb-4">
      {/* Year selector + Bank Type filter */}
      <div className="flex items-center gap-4 mb-4 p-4 pb-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setYear((y) => y - 1)} className="p-1 hover:bg-muted rounded text-foreground/70 hover:text-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-bold tracking-wider">{year}</span>
          <button onClick={() => setYear((y) => y + 1)} className="p-1 hover:bg-muted rounded text-foreground/70 hover:text-foreground transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {bankTypes.length > 0 && (
          <select
            value={selectedBankTypeId}
            onChange={(e) => setSelectedBankTypeId(e.target.value)}
            className="h-8 rounded-lg border border-border/50 bg-background/50 px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="all">All Bank Types</option>
            {bankTypes.map((bt) => (
              <option key={bt.id} value={bt.id}>{bt.name}</option>
            ))}
          </select>
        )}
      </div>

      <table className="w-full text-xs sm:text-sm">
        <thead>
          <tr className="bg-muted/30 border-b border-border/50">
            <th className="text-left px-4 py-4 min-w-[180px] sticky left-0 bg-muted/30 z-10 backdrop-blur-md text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap"></th>
            {MONTHS.map((m, i) => (
              <th key={i} className="text-center px-2 py-4 min-w-[70px] text-[10px] font-bold tracking-widest uppercase text-muted-foreground whitespace-nowrap">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* ── GROSS INCOME ────────────────────────────────────────── */}
          <SectionHeader label="GROSS INCOME" getTotal={getIncomeTotal} fmt={fmt} />
          {/* Auto items from transactions */}
          {incomeItems.map((c) => (
            <ItemRow key={c.id} label={c.name} getVal={(m) => getCatVal(c.id, m)} fmt={fmt} />
          ))}
          {/* Manual line items */}
          {incomeSection?.line_items.map((item) => (
            <EditableItemRow
              key={item.id}
              item={item}
              canEdit={canEdit}
              editingCell={editingCell}
              editValue={editValue}
              setEditingCell={setEditingCell}
              setEditValue={setEditValue}
              saveCell={saveCell}
              getCellValue={getManualCellValue}
              handleDeleteItem={handleDeleteItem}
              fmt={fmt}
            />
          ))}
          {incomeItems.length === 0 && (!incomeSection || incomeSection.line_items.length === 0) && (
            <EmptyRow text="No income transactions" />
          )}
          {/* Add Category */}
          {canEdit && incomeSection && (
            <AddCategoryRow
              sectionId={incomeSection.id}
              addingItem={addingItem}
              setAddingItem={setAddingItem}
              newItemName={newItemName}
              setNewItemName={setNewItemName}
              handleAddItem={handleAddItem}
            />
          )}

          {/* ── EXPENSES ────────────────────────────────────────────── */}
          <SectionHeader label="EXPENSES" getTotal={getExpenseTotal} fmt={fmt} />
          {expenseItems.map((c) => (
            <ItemRow
              key={c.id}
              label={c.name}
              getVal={(m) => Math.abs(getCatVal(c.id, m))}
              fmt={fmt}
            />
          ))}
          {expenseItems.length === 0 && <EmptyRow text="No expense transactions" />}

          {/* ── LOANS ───────────────────────────────────────────────── */}
          <SectionHeader label="LOANS" getTotal={getLoanTotal} fmt={fmt} />
          {loans.map((ln) => (
            <ItemRow
              key={ln.id}
              label={ln.loan_name || 'Unnamed Loan'}
              getVal={(m) => (isLoanActiveInMonth(ln, year, m) ? computeMonthlyPayment(ln) : 0)}
              fmt={fmt}
            />
          ))}
          {loans.length === 0 && <EmptyRow text="No loans in debt schedule" />}

          {/* ── CASHFLOW ────────────────────────────────────────────── */}
          <tr>
            <td colSpan={13} className="h-2" />
          </tr>
          <tr className="bg-muted/30 border-y border-border/50">
            <td className="px-4 py-4 font-bold text-foreground text-[11px] tracking-wider uppercase sticky left-0 bg-muted/30 z-10 backdrop-blur-md">
              CASHFLOW
            </td>
            {MONTHS.map((_, i) => {
              const v = getCashflowTotal(i + 1);
              return (
                <td
                  key={i}
                  className={`text-center px-2 py-1 font-semibold ${v < 0 ? 'text-red-400' : v > 0 ? 'text-green-400' : ''}`}
                >
                  {fmtSigned(v)}
                </td>
              );
            })}
          </tr>
          {/* Manual cashflow line items */}
          {cashflowSection?.line_items.map((item) => (
            <EditableItemRow
              key={item.id}
              item={item}
              canEdit={canEdit}
              editingCell={editingCell}
              editValue={editValue}
              setEditingCell={setEditingCell}
              setEditValue={setEditValue}
              saveCell={saveCell}
              getCellValue={getManualCellValue}
              handleDeleteItem={handleDeleteItem}
              fmt={fmt}
            />
          ))}
          {/* Add Category for CASHFLOW */}
          {canEdit && cashflowSection && (
            <AddCategoryRow
              sectionId={cashflowSection.id}
              addingItem={addingItem}
              setAddingItem={setAddingItem}
              newItemName={newItemName}
              setNewItemName={setNewItemName}
              handleAddItem={handleAddItem}
            />
          )}

          {/* ── Bank Balance ────────────────────────────────────────── */}
          <tr>
            <td colSpan={13} className="h-2" />
          </tr>
          <tr className="bg-muted/40 border-t border-border/50">
            <td className="px-4 py-4 font-bold text-[11px] tracking-wider uppercase sticky left-0 bg-muted/40 z-10 text-foreground backdrop-blur-md">
              Bank Balance - Projected
            </td>
            {MONTHS.map((_, i) => (
              <td key={i} className="text-center px-2 py-1 font-bold">
                {fmtSigned(getCashflowTotal(i + 1))}
              </td>
            ))}
          </tr>
          <tr className="bg-green-500/10 border-t border-border/50">
            <td className="px-4 py-4 font-bold text-[11px] tracking-wider uppercase sticky left-0 bg-green-500/10 z-10 text-green-500 dark:text-green-400 backdrop-blur-md">
              Bank Balance - Actual
            </td>
            {MONTHS.map((_, i) => (
              <td key={i} className="text-center px-2 py-1 font-bold text-green-400">
                {fmtSigned(getCashflowTotal(i + 1))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function SectionHeader({
  label,
  getTotal,
  fmt,
}: {
  label: string;
  getTotal: (m: number) => number;
  fmt: (n: number) => string;
}) {
  return (
    <tr className="bg-muted/30 border-y border-border/50">
      <td className="px-4 py-4 font-bold text-foreground/90 text-[11px] tracking-wider uppercase sticky left-0 bg-muted/30 z-10 backdrop-blur-md">
        {label}
      </td>
      {MONTHS.map((_, i) => (
        <td key={i} className="text-center px-2 py-3 font-bold text-[11px] text-foreground/90">
          {fmt(getTotal(i + 1))}
        </td>
      ))}
    </tr>
  );
}

function ItemRow({
  label,
  getVal,
  fmt,
}: {
  label: string;
  getVal: (m: number) => number;
  fmt: (n: number) => string;
}) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
      <td className="px-4 py-4 sticky left-0 bg-background/50 backdrop-blur-md z-10 text-foreground text-[11px] font-medium">{label}</td>
      {MONTHS.map((_, i) => (
        <td key={i} className="text-center px-2 py-2 text-[11px] text-foreground/80">
          {fmt(getVal(i + 1))}
        </td>
      ))}
    </tr>
  );
}

function EditableItemRow({
  item,
  canEdit,
  editingCell,
  editValue,
  setEditingCell,
  setEditValue,
  saveCell,
  getCellValue,
  handleDeleteItem,
  fmt,
}: {
  item: { id: string; name: string; color?: string | null };
  canEdit: boolean;
  editingCell: { itemId: string; month: number } | null;
  editValue: string;
  setEditingCell: (v: { itemId: string; month: number } | null) => void;
  setEditValue: (v: string) => void;
  saveCell: (itemId: string, month: number, value: string) => void;
  getCellValue: (itemId: string, month: number) => number;
  handleDeleteItem: (id: string, name: string) => void;
  fmt: (n: number) => string;
}) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
      <td className="px-4 py-4 sticky left-0 bg-background/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-1.5">
          {item.color && <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />}
          <span className="text-foreground text-[11px] font-medium">{item.name}</span>
          {canEdit && (
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => handleDeleteItem(item.id, item.name)} 
              className="ml-auto text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all h-7 w-7"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </td>
      {MONTHS.map((_, mi) => {
        const month = mi + 1;
        const val = getCellValue(item.id, month);
        const isEditing = editingCell?.itemId === item.id && editingCell?.month === month;

        if (isEditing) {
          return (
            <td key={mi} className="px-1 py-0.5 text-center">
              <input
                autoFocus
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => saveCell(item.id, month, editValue)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCell(item.id, month, editValue);
                  if (e.key === 'Escape') setEditingCell(null);
                }}
                className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </td>
          );
        }

        return (
          <td
            key={mi}
            onClick={canEdit ? () => { setEditingCell({ itemId: item.id, month }); setEditValue(String(val || '')); } : undefined}
            className={`px-2 py-1 text-center ${canEdit ? 'cursor-pointer hover:bg-muted/50' : ''}`}
          >
            {fmt(val)}
          </td>
        );
      })}
    </tr>
  );
}

function AddCategoryRow({
  sectionId,
  addingItem,
  setAddingItem,
  newItemName,
  setNewItemName,
  handleAddItem,
}: {
  sectionId: string;
  addingItem: string | null;
  setAddingItem: (v: string | null) => void;
  newItemName: string;
  setNewItemName: (v: string) => void;
  handleAddItem: (sectionId: string) => void;
}) {
  return (
    <tr>
      <td colSpan={13} className="px-2 py-1">
        {addingItem === sectionId ? (
          <div className="flex items-center gap-2 pl-2">
            <input
              autoFocus
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddItem(sectionId);
                if (e.key === 'Escape') { setAddingItem(null); setNewItemName(''); }
              }}
              placeholder="Category name..."
              className="px-2 py-1 bg-background/50 border border-primary/20 rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all font-medium placeholder:text-muted-foreground/50"
            />
            <Button 
              size="sm"
              onClick={() => handleAddItem(sectionId)} 
              className="h-7"
            >
              Add
            </Button>
            <Button 
              variant="ghost"
              size="sm"
              onClick={() => { setAddingItem(null); setNewItemName(''); }} 
              className="h-7"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAddingItem(sectionId)}
            className="text-primary hover:text-primary/80 transition-all pl-2"
            leftIcon={<Plus className="h-3 w-3" />}
          >
            Add Category
          </Button>
        )}
      </td>
    </tr>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <tr>
      <td colSpan={13} className="px-4 py-1 text-muted-foreground italic text-xs">
        {text}
      </td>
    </tr>
  );
}
