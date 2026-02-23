'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { ProjectPermission } from '@/lib/types/project';
import { SectionWithItems, FinancialMonthlyValue } from '@/lib/types/financial';
import {
  getSections,
  getMonthlyValues,
  createLineItem,
  deleteLineItem,
  upsertMonthlyValue,
  seedDefaultFinancials,
} from '@/lib/db/financial';
import { logUserAction } from '@/lib/db/user-logs';
import { Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  selectedProjectId: string;
  userPermission?: ProjectPermission | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function FinancialOverview({ selectedProjectId, userPermission }: Props) {
  const { user } = useAuth();
  const [sections, setSections] = useState<SectionWithItems[]>([]);
  const [values, setValues] = useState<FinancialMonthlyValue[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [editingCell, setEditingCell] = useState<{ itemId: string; month: number } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addingItem, setAddingItem] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const displayNameRef = useRef('Unknown');
  const userEmailRef = useRef('');

  const permLevel = userPermission?.perm_reports ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;

  useEffect(() => {
    if (!user) return;
    userEmailRef.current = user.email || '';
    supabase
      .from('accounts')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => { displayNameRef.current = data?.display_name || user.email || 'Unknown'; });
  }, [user]);

  const loadData = async () => {
    let secs = await getSections(selectedProjectId);
    if (secs.length === 0) {
      await seedDefaultFinancials(selectedProjectId);
      secs = await getSections(selectedProjectId);
    }
    setSections(secs);
    const vals = await getMonthlyValues(selectedProjectId, year);
    setValues(vals);
  };

  useEffect(() => { loadData(); }, [selectedProjectId, year]);

  const log = (action: string) => {
    if (!user) return;
    logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action });
  };

  // Value lookup map
  const valueMap = useMemo(() => {
    const m = new Map<string, number>();
    values.forEach((v) => m.set(`${v.line_item_id}-${v.month}`, Number(v.value)));
    return m;
  }, [values]);

  const getCellValue = (itemId: string, month: number) => valueMap.get(`${itemId}-${month}`) ?? 0;

  const getSectionTotal = (section: SectionWithItems, month: number) =>
    section.line_items.reduce((sum, item) => sum + getCellValue(item.id, month), 0);

  const saveCell = async (itemId: string, month: number, raw: string) => {
    setEditingCell(null);
    const num = parseFloat(raw) || 0;
    const old = getCellValue(itemId, month);
    if (num === old) return;
    const ok = await upsertMonthlyValue(itemId, selectedProjectId, year, month, num);
    if (ok) {
      setValues((prev) => {
        const key = `${itemId}-${year}-${month}`;
        const existing = prev.find((v) => v.line_item_id === itemId && v.month === month && v.year === year);
        if (existing) return prev.map((v) => (v.id === existing.id ? { ...v, value: num } : v));
        return [...prev, { id: key, line_item_id: itemId, project_id: selectedProjectId, year, month, value: num, created_at: '', updated_at: '' }];
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

  const fmt = (n: number) => n === 0 ? '' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div className="overflow-x-auto">
      {/* Year selector */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setYear((y) => y - 1)} className="p-1 hover:bg-muted rounded"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-bold">{year}</span>
        <button onClick={() => setYear((y) => y + 1)} className="p-1 hover:bg-muted rounded"><ChevronRight className="h-4 w-4" /></button>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-2 py-1 min-w-[180px] sticky left-0 bg-background z-10"></th>
            {MONTHS.map((m, i) => (
              <th key={i} className="text-center px-2 py-1 min-w-[70px] font-semibold text-foreground">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              canEdit={canEdit}
              editingCell={editingCell}
              editValue={editValue}
              setEditingCell={setEditingCell}
              setEditValue={setEditValue}
              saveCell={saveCell}
              getCellValue={getCellValue}
              getSectionTotal={getSectionTotal}
              handleDeleteItem={handleDeleteItem}
              addingItem={addingItem}
              setAddingItem={setAddingItem}
              newItemName={newItemName}
              setNewItemName={setNewItemName}
              handleAddItem={handleAddItem}
              fmt={fmt}
            />
          ))}

          {/* Bank Balance rows */}
          <tr><td colSpan={13} className="h-2" /></tr>
          <BankBalanceRow label="Bank Balance - Projected" sections={sections} getCellValue={getCellValue} getSectionTotal={getSectionTotal} fmt={fmt} highlight={false} />
          <BankBalanceRow label="Bank Balance - Actual" sections={sections} getCellValue={getCellValue} getSectionTotal={getSectionTotal} fmt={fmt} highlight={true} />
        </tbody>
      </table>
    </div>
  );
}

// Section block with header + line items
function SectionBlock({
  section, canEdit, editingCell, editValue, setEditingCell, setEditValue,
  saveCell, getCellValue, getSectionTotal, handleDeleteItem,
  addingItem, setAddingItem, newItemName, setNewItemName, handleAddItem, fmt,
}: {
  section: SectionWithItems;
  canEdit: boolean;
  editingCell: { itemId: string; month: number } | null;
  editValue: string;
  setEditingCell: (v: { itemId: string; month: number } | null) => void;
  setEditValue: (v: string) => void;
  saveCell: (itemId: string, month: number, value: string) => void;
  getCellValue: (itemId: string, month: number) => number;
  getSectionTotal: (section: SectionWithItems, month: number) => number;
  handleDeleteItem: (id: string, name: string) => void;
  addingItem: string | null;
  setAddingItem: (v: string | null) => void;
  newItemName: string;
  setNewItemName: (v: string) => void;
  handleAddItem: (sectionId: string) => void;
  fmt: (n: number) => string;
}) {
  return (
    <>
      {/* Section header */}
      <tr className="bg-muted/30">
        <td className="px-2 py-1 font-bold text-foreground text-xs sticky left-0 bg-muted/30 z-10">{section.name}</td>
        {MONTHS.map((_, i) => {
          const total = getSectionTotal(section, i + 1);
          return <td key={i} className="text-center px-2 py-1 font-semibold text-foreground">{fmt(total)}</td>;
        })}
      </tr>

      {/* Line items */}
      {section.line_items.map((item) => (
        <tr key={item.id} className="border-b border-border/30 hover:bg-muted/20">
          <td className="px-2 py-1 sticky left-0 bg-background z-10">
            <div className="flex items-center gap-1">
              {item.color && <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />}
              <span className="text-foreground">{item.name}</span>
              {canEdit && (
                <button onClick={() => handleDeleteItem(item.id, item.name)} className="ml-auto text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100">
                  <Trash2 className="h-3 w-3" />
                </button>
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
      ))}

      {/* Add Category (line item) */}
      {canEdit && (
        <tr>
          <td colSpan={13} className="px-2 py-1">
            {addingItem === section.id ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddItem(section.id);
                    if (e.key === 'Escape') { setAddingItem(null); setNewItemName(''); }
                  }}
                  placeholder="Item name..."
                  className="px-2 py-0.5 bg-background border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button onClick={() => handleAddItem(section.id)} className="text-xs text-accent font-semibold">Add</button>
                <button onClick={() => { setAddingItem(null); setNewItemName(''); }} className="text-xs text-muted-foreground">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setAddingItem(section.id)}
                className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-semibold"
              >
                <Plus className="h-3 w-3" /> Add Category
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Bank Balance row (computed from sections)
function BankBalanceRow({
  label, sections, getCellValue, getSectionTotal, fmt, highlight,
}: {
  label: string;
  sections: SectionWithItems[];
  getCellValue: (itemId: string, month: number) => number;
  getSectionTotal: (section: SectionWithItems, month: number) => number;
  fmt: (n: number) => string;
  highlight: boolean;
}) {
  const income = sections.find((s) => s.name === 'GROSS INCOME');
  const expenses = sections.find((s) => s.name === 'EXPENSES');
  const loans = sections.find((s) => s.name === 'LOANS');

  return (
    <tr className={highlight ? 'bg-green-600/20' : 'bg-muted/30'}>
      <td className={`px-2 py-1 font-bold text-xs sticky left-0 z-10 ${highlight ? 'bg-green-600/20 text-green-400' : 'bg-muted/30 text-foreground'}`}>
        {label}
      </td>
      {MONTHS.map((_, i) => {
        const m = i + 1;
        const inc = income ? getSectionTotal(income, m) : 0;
        const exp = expenses ? getSectionTotal(expenses, m) : 0;
        const ln = loans ? getSectionTotal(loans, m) : 0;
        const balance = inc - exp - ln;
        return (
          <td key={i} className={`text-center px-2 py-1 font-bold ${highlight ? 'text-green-400' : ''}`}>
            {fmt(balance)}
          </td>
        );
      })}
    </tr>
  );
}
