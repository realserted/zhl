'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { supabase } from '../../../lib/supabase';
import { ProjectPermission } from '../../../lib/types/project';
import { FinancialBankType, FinancialTxCategory, FinancialTransaction } from '../../../lib/types/financial';
import {
  getBankTypes, createBankType,
  getTxCategories, createTxCategory,
  getTransactions, updateTransaction, deleteTransaction, bulkCreateTransactions,
} from '../../../lib/db/financial';
import { logUserAction } from '../../../lib/db/user-logs';
import { Upload, Plus, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';

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
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const displayNameRef = useRef('Unknown');
  const userEmailRef = useRef('');

  const permLevel = userPermission?.perm_reports ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;

  useEffect(() => {
    if (!user) return;
    userEmailRef.current = user.email || '';
    supabase.from('accounts').select('display_name').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { displayNameRef.current = data?.display_name || user.email || 'Unknown'; });
  }, [user]);

  useEffect(() => {
    getBankTypes(selectedProjectId).then((bt) => {
      setBankTypes(bt);
      if (bt.length > 0) setSelectedBankType(bt[0].id);
    });
    getTxCategories(selectedProjectId).then(setTxCategories);
    getTransactions(selectedProjectId).then(setTransactions);
  }, [selectedProjectId]);

  const log = (action: string) => {
    if (!user) return;
    logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action });
  };

  const handleAddBankType = async () => {
    if (!newTypeName.trim()) return;
    const bt = await createBankType(selectedProjectId, newTypeName.trim());
    if (bt) {
      setBankTypes((prev) => [...prev, bt]);
      setSelectedBankType(bt.id);
      log(`Added bank type "${newTypeName.trim()}"`);
    }
    setNewTypeName('');
    setShowAddType(false);
  };

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    const cat = await createTxCategory(selectedProjectId, newCatName.trim(), '●', '#8b5cf6');
    if (cat) {
      setTxCategories((prev) => [...prev, cat]);
      log(`Added transaction category "${newCatName.trim()}"`);
    }
    setNewCatName('');
    setShowAddCategory(false);
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    const parsed = rows.map((row) => {
      // Try common column name variations
      const dateVal = row['Date'] || row['date'] || row['DATE'] || '';
      const amountVal = row['Amount'] || row['amount'] || row['AMOUNT'] || row['Debit'] || row['Credit'] || 0;
      const descVal = row['Description'] || row['description'] || row['DESCRIPTION'] || row['Memo'] || '';

      let dateStr = '';
      if (dateVal instanceof Date) {
        dateStr = dateVal.toISOString().split('T')[0];
      } else if (typeof dateVal === 'string' && dateVal) {
        const d = new Date(dateVal);
        dateStr = isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
      }

      return {
        date: dateStr,
        amount: typeof amountVal === 'number' ? amountVal : parseFloat(String(amountVal)) || 0,
        description: String(descVal),
      };
    }).filter((r) => r.date || r.amount || r.description);

    if (parsed.length > 0) {
      const created = await bulkCreateTransactions(selectedProjectId, selectedBankType, parsed);
      setTransactions((prev) => [...created, ...prev]);
      log(`Uploaded ${created.length} transactions from "${file.name}"`);
    }
    e.target.value = '';
  };

  const handleCategoryChange = async (txId: string, categoryId: string) => {
    const ok = await updateTransaction(txId, 'category_id', categoryId || null);
    if (ok) {
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, category_id: categoryId || null } : t)));
    }
  };

  const handleAutoGroupingChange = async (txId: string, value: string) => {
    const ok = await updateTransaction(txId, 'auto_grouping', value || null);
    if (ok) {
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, auto_grouping: value || null } : t)));
    }
  };

  const saveInlineEdit = async (txId: string, field: string, value: string) => {
    setEditingCell(null);
    const ok = await updateTransaction(txId, field, value || null);
    if (ok) {
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, [field]: value || null } : t)));
    }
  };

  const handleDeleteTx = async (txId: string) => {
    if (await deleteTransaction(txId)) {
      setTransactions((prev) => prev.filter((t) => t.id !== txId));
    }
  };

  // Filter transactions by selected bank type
  const filteredTransactions = selectedBankType
    ? transactions.filter((t) => t.bank_type_id === selectedBankType)
    : transactions;

  return (
    <div>
      {/* Upload area */}
      {canEdit && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-lg p-8 mb-6 cursor-pointer hover:border-accent/50 transition-colors text-center max-w-xs"
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="font-semibold text-sm">Upload Financials</p>
          <p className="text-xs text-muted-foreground">(xlsx only for now)</p>
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
      <div className="flex items-center gap-3 mb-6">
        <span className="text-sm font-semibold">Type:</span>
        <select
          value={selectedBankType ?? ''}
          onChange={(e) => setSelectedBankType(e.target.value || null)}
          className="px-3 py-1.5 bg-background border border-input rounded text-sm"
        >
          <option value="">Select type...</option>
          {bankTypes.map((bt) => (
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
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddBankType(); if (e.key === 'Escape') setShowAddType(false); }}
                placeholder="Bank name..."
                className="px-2 py-1 bg-background border border-input rounded text-xs"
              />
              <button onClick={handleAddBankType} className="text-xs text-accent font-semibold">Add</button>
            </div>
          ) : (
            <button onClick={() => setShowAddType(true)} className="flex items-center gap-1 text-xs text-accent font-semibold">
              <Plus className="h-3 w-3" /> Request new type
            </button>
          )
        )}
      </div>

      {/* Bank Data header + Add Category */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold">Bank Data</h3>
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
                <button onClick={handleAddCategory} className="text-xs text-accent font-semibold">Add</button>
              </div>
            ) : (
              <button onClick={() => setShowAddCategory(true)} className="text-xs text-accent font-semibold">Add Category</button>
            )}
          </div>
        )}
      </div>

      {/* Transactions table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold min-w-[100px]">Date</th>
              <th className="px-3 py-2 text-left text-xs font-semibold min-w-[90px]">Amount</th>
              <th className="px-3 py-2 text-left text-xs font-semibold min-w-[180px]">Category</th>
              <th className="px-3 py-2 text-left text-xs font-semibold min-w-[120px]">Notes</th>
              <th className="px-3 py-2 text-left text-xs font-semibold min-w-[200px]">Description</th>
              <th className="px-3 py-2 text-left text-xs font-semibold min-w-[120px]">Auto-Grouping</th>
              {canEdit && <th className="px-3 py-2 w-8"></th>}
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="px-3 py-8 text-center text-muted-foreground text-sm">
                  {transactions.length === 0
                    ? 'No transactions yet. Upload an Excel file to import.'
                    : 'No transactions for this bank type. Select a different type or upload data.'}
                </td>
              </tr>
            ) : (
              filteredTransactions.map((tx) => (
                <tr key={tx.id} className="border-b border-border hover:bg-muted/30">
                  <td className="px-3 py-2 text-xs">{tx.date ?? '-'}</td>
                  <td className="px-3 py-2 text-xs font-medium">
                    {tx.amount != null ? `$${Number(tx.amount).toFixed(2)}` : '-'}
                  </td>
                  <td className="px-3 py-2">
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
                  </td>
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
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px]">
                    {tx.description || '-'}
                  </td>
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
    </div>
  );
}
