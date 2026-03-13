'use client';

import { Pencil, Trash2, AlertTriangle, Bot, User } from 'lucide-react';
import { FinancialTransaction, FinancialTxCategory, FinancialUploadSheet } from '@/lib/types/financial';

const formatCellValue = (val: unknown): string => {
  if (val == null || val === '') return '-';
  if (typeof val === 'number') {
    if (Math.abs(val) >= 0.01) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return String(val);
  }
  return String(val);
};

const isAmountColumn = (colName: string): boolean =>
  /amount|debit|credit|balance|running bal|summary amt/i.test(colName);

interface TransactionTableProps {
  filteredTransactions: FinancialTransaction[];
  dynamicColumns: string[];
  hasRawData: boolean;
  txCategories: FinancialTxCategory[];
  canEdit: boolean;
  editingCell: { id: string; field: string } | null;
  editValue: string;
  setEditingCell: (v: { id: string; field: string } | null) => void;
  setEditValue: (v: string) => void;
  colWidths: Record<string, number>;
  handleResizeStart: (col: string, e: React.MouseEvent) => void;
  editingHeader: { sheetId: string; index: number } | null;
  headerEditValue: string;
  setEditingHeader: (v: { sheetId: string; index: number } | null) => void;
  setHeaderEditValue: (v: string) => void;
  activeSheet: FinancialUploadSheet | null | undefined;
  saveInlineEdit: (txId: string, field: string, value: string) => void;
  handleCategoryChange: (txId: string, catId: string) => void;
  handleAutoGroupingChange: (txId: string, value: string) => void;
  handleDeleteTx: (txId: string) => void;
  handleRenameHeader: (sheetId: string, colIndex: number, value: string) => void;
  transactions: FinancialTransaction[];
}

export function TransactionTable({
  filteredTransactions, dynamicColumns, hasRawData, txCategories, canEdit,
  editingCell, editValue, setEditingCell, setEditValue,
  colWidths, handleResizeStart,
  editingHeader, headerEditValue, setEditingHeader, setHeaderEditValue,
  activeSheet, saveInlineEdit,
  handleCategoryChange, handleAutoGroupingChange, handleDeleteTx, handleRenameHeader,
  transactions,
}: TransactionTableProps) {
  const rawKeyForColumn = (colIndex: number): string => dynamicColumns[colIndex] ?? '';

  return (
    <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
      <table className="text-xs sm:text-sm" style={{ tableLayout: 'fixed', minWidth: '100%' }}>
        <thead>
          <tr className="bg-muted/30 border-b border-border/50">
            {hasRawData ? (
              <>
                {dynamicColumns.map((col, colIndex) => {
                  const isEditing = editingHeader?.sheetId === activeSheet?.id && editingHeader?.index === colIndex;
                  const colKey = `dyn-${colIndex}`;
                  return (
                    <th key={`${col}-${colIndex}`} className="relative px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap" style={{ width: colWidths[colKey] ?? 150, minWidth: 60 }}>
                      {isEditing ? (
                        <input
                          autoFocus value={headerEditValue}
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
                          onClick={() => { if (activeSheet && canEdit) { setEditingHeader({ sheetId: activeSheet.id, index: colIndex }); setHeaderEditValue(col); } }}
                        >
                          {col}
                          {activeSheet && canEdit && <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />}
                        </span>
                      )}
                      <div onMouseDown={(e) => handleResizeStart(colKey, e)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 transition-colors" />
                    </th>
                  );
                })}
                <th className="relative px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap" style={{ width: colWidths['category'] ?? 150, minWidth: 60 }}>Category<div onMouseDown={(e) => handleResizeStart('category', e)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 transition-colors" /></th>
                <th className="relative px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap" style={{ width: colWidths['notes'] ?? 100, minWidth: 60 }}>Notes<div onMouseDown={(e) => handleResizeStart('notes', e)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 transition-colors" /></th>
                <th className="relative px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap" style={{ width: colWidths['auto-grouping'] ?? 100, minWidth: 60 }}>Auto-Grouping<div onMouseDown={(e) => handleResizeStart('auto-grouping', e)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 transition-colors" /></th>
                {canEdit && <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap" style={{ width: 40 }}></th>}
              </>
            ) : (
              <>
                {['date', 'amount', 'description', 'category', 'notes', 'auto-grouping'].map((col) => {
                  const defaults: Record<string, number> = { date: 100, amount: 90, description: 200, category: 150, notes: 100, 'auto-grouping': 100 };
                  const labels: Record<string, string> = { date: 'Date', amount: 'Amount', description: 'Description', category: 'Category', notes: 'Notes', 'auto-grouping': 'Auto-Grouping' };
                  return (
                    <th key={col} className="relative px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap" style={{ width: colWidths[col] ?? defaults[col], minWidth: 60 }}>
                      {labels[col]}
                      <div onMouseDown={(e) => handleResizeStart(col, e)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 transition-colors" />
                    </th>
                  );
                })}
                {canEdit && <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap" style={{ width: 40 }}></th>}
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
                        <td key={`${col}-${colIndex}`} className={`px-4 py-4 text-xs whitespace-nowrap overflow-hidden text-ellipsis ${isAmt && numVal < 0 ? 'text-red-500 font-medium' : isAmt && numVal > 0 ? 'text-green-500 font-medium' : ''}`}>
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
                        <input autoFocus type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => saveInlineEdit(tx.id, 'date', editValue)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveInlineEdit(tx.id, 'date', editValue); if (e.key === 'Escape') setEditingCell(null); }}
                          className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs" />
                      ) : (
                        <span onClick={canEdit ? () => { setEditingCell({ id: tx.id, field: 'date' }); setEditValue(tx.date ?? ''); } : undefined}
                          className={`block min-h-5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}>
                          {tx.date ?? <span className="text-muted-foreground/40">-</span>}
                        </span>
                      )}
                    </td>
                    {/* Amount */}
                    <td className={`px-4 py-4 text-xs font-medium whitespace-nowrap ${tx.amount != null && tx.amount < 0 ? 'text-red-500' : tx.amount != null && tx.amount > 0 ? 'text-green-500' : ''}`}>
                      {editingCell?.id === tx.id && editingCell?.field === 'amount' ? (
                        <input autoFocus type="number" step="0.01" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => saveInlineEdit(tx.id, 'amount', editValue)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveInlineEdit(tx.id, 'amount', editValue); if (e.key === 'Escape') setEditingCell(null); }}
                          className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs" />
                      ) : (
                        <span onClick={canEdit ? () => { setEditingCell({ id: tx.id, field: 'amount' }); setEditValue(tx.amount != null ? String(tx.amount) : ''); } : undefined}
                          className={`block min-h-5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}>
                          {tx.amount != null
                            ? `${tx.amount < 0 ? '-' : ''}$${Math.abs(Number(tx.amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : <span className="text-muted-foreground/40">-</span>}
                        </span>
                      )}
                    </td>
                    {/* Description */}
                    <td className="px-4 py-4 text-xs text-muted-foreground max-w-[200px] whitespace-nowrap">
                      {editingCell?.id === tx.id && editingCell?.field === 'description' ? (
                        <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => saveInlineEdit(tx.id, 'description', editValue)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveInlineEdit(tx.id, 'description', editValue); if (e.key === 'Escape') setEditingCell(null); }}
                          className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs" />
                      ) : (
                        <span onClick={canEdit ? () => { setEditingCell({ id: tx.id, field: 'description' }); setEditValue(tx.description ?? ''); } : undefined}
                          className={`block min-h-5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}>
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
                        <span title="AI suggested — needs human review."><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" /></span>
                      ) : (
                        <span title={tx.auto_grouping === 'Do not group' ? 'Manually categorized' : 'AI categorized'}>
                          {tx.auto_grouping === 'Do not group' ? <User className="h-3.5 w-3.5 shrink-0 text-orange-400" /> : <Bot className="h-3.5 w-3.5 shrink-0 text-blue-400" />}
                        </span>
                      )
                    ) : null}
                    <select value={tx.category_id ?? ''} onChange={(e) => handleCategoryChange(tx.id, e.target.value)} disabled={!canEdit} className="w-full px-2 py-1 bg-background border border-input rounded text-xs">
                      <option value="">--</option>
                      {txCategories.some((c) => c.category_type === 'income') && (
                        <optgroup label="Income">
                          {txCategories.filter((c) => c.category_type === 'income').map((cat) => <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>)}
                        </optgroup>
                      )}
                      <optgroup label="Expense">
                        {txCategories.filter((c) => !c.category_type || c.category_type === 'expense').map((cat) => <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>)}
                      </optgroup>
                    </select>
                  </div>
                </td>
                {/* Notes */}
                <td className="px-4 py-4 whitespace-nowrap">
                  {editingCell?.id === tx.id && editingCell?.field === 'notes' ? (
                    <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveInlineEdit(tx.id, 'notes', editValue)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveInlineEdit(tx.id, 'notes', editValue); if (e.key === 'Escape') setEditingCell(null); }}
                      className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs" />
                  ) : (
                    <span onClick={canEdit ? () => { setEditingCell({ id: tx.id, field: 'notes' }); setEditValue(tx.notes ?? ''); } : undefined}
                      className={`text-xs block min-h-5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded' : ''}`}>
                      {tx.notes || <span className="text-muted-foreground/40">-</span>}
                    </span>
                  )}
                </td>
                {/* Auto-Grouping */}
                <td className="px-4 py-4 whitespace-nowrap">
                  <select value={tx.auto_grouping ?? ''} onChange={(e) => handleAutoGroupingChange(tx.id, e.target.value)} disabled={!canEdit} className="w-full px-2 py-1 bg-background border border-input rounded text-xs">
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
  );
}
