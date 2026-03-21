'use client';

import { ProjectPermission } from '@/lib/types/project';
import { Upload, Plus, Trash2, X, Check, FileSpreadsheet } from 'lucide-react';
import { AutoBooksPreviewModal } from './AutoBooksPreviewModal';
import { TransactionTable } from './TransactionTable';
import { useAutoBooks } from './useAutoBooks';

interface Props {
  selectedProjectId: string;
  userPermission?: ProjectPermission | null;
}

export default function FinancialAutoBooks({ selectedProjectId, userPermission }: Props) {
  const {
    notice, canEdit, selectedBankType, setSelectedBankType, setSelectedSheetId,
    showAddType, setShowAddType, newTypeName, setNewTypeName,
    showAddCategory, setShowAddCategory, newCatName, setNewCatName,
    newCatType, setNewCatType, showCategoryManager, setShowCategoryManager,
    confirmDeleteSheet, setConfirmDeleteSheet, confirmDeleteAll, setConfirmDeleteAll,
    editingCell, setEditingCell, editValue, setEditValue,
    editingHeader, headerEditValue, setEditingHeader, setHeaderEditValue,
    colWidths, handleResizeStart,
    fileInputRef, quickFileInputRef,
    approvedBankTypes, bankTypes, txCategories, transactions, filteredTransactions,
    sheetsForType, effectiveSheetId, activeSheet, dynamicColumns, hasRawData,
    previewOpen, setPreviewOpen, previewFile, setPreviewFile,
    previewRows, setPreviewRows, setPreviewWorkbook, previewInitialConfig,
    handleRequestBankType, handleAddCategory, handleToggleCategoryType,
    handleExcelUpload, handleQuickUpload, processExcelWithMapping,
    handleDeleteSheet, handleDeleteAllForType, handleRenameHeader, handleDeleteColumn,
    handleCategoryChange, handleAutoGroupingChange, saveInlineEdit,
    handleDeleteTx, handleAddRow,
  } = useAutoBooks(selectedProjectId, userPermission);

  return (
    <div>
      {/* Notice */}
      {notice && (
        <div className="mb-4 px-3 py-2 bg-accent/10 border border-accent/30 rounded text-xs text-accent font-medium">
          {notice}
        </div>
      )}

      {/* Upload area — two options */}
      {canEdit && (
        <div className="flex gap-3 mb-6 max-w-md">
          <div
            onClick={() => {
              if (!selectedBankType) { return; }
              quickFileInputRef.current?.click();
            }}
            className="flex-1 border-2 border-dashed border-primary/30 bg-primary/5 rounded-xl p-6 cursor-pointer hover:border-primary hover:bg-primary/10 transition-all text-center shadow-sm"
          >
            <Upload className="h-7 w-7 mx-auto mb-2 text-muted-foreground" />
            <p className="font-semibold text-sm">Quick Upload</p>
            <p className="text-[10px] text-muted-foreground mt-1">Clean file, row 1 = headers</p>
          </div>
          <div
            onClick={() => {
              if (!selectedBankType) { return; }
              fileInputRef.current?.click();
            }}
            className="flex-1 border-2 border-dashed border-primary/30 bg-primary/5 rounded-xl p-6 cursor-pointer hover:border-primary hover:bg-primary/10 transition-all text-center shadow-sm"
          >
            <FileSpreadsheet className="h-7 w-7 mx-auto mb-2 text-muted-foreground" />
            <p className="font-semibold text-sm">Customize</p>
            <p className="text-[10px] text-muted-foreground mt-1">Preview & map columns</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleExcelUpload}
            className="hidden"
          />
          <input
            ref={quickFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleQuickUpload}
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
                Request
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
              <div className="flex items-center gap-2">
                <button onClick={() => setShowAddCategory(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase bg-primary/10 text-primary hover:bg-primary/20 transition-all">
                  Add Category
                </button>
                <button
                  onClick={() => setShowCategoryManager((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase transition-all ${showCategoryManager ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
                >
                  Manage
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Category Manager */}
      {showCategoryManager && canEdit && (
        <div className="mb-4 p-4 glass-card rounded-2xl border border-border/50">
          <h4 className="text-xs font-bold tracking-wider uppercase text-muted-foreground mb-3">Category Types</h4>
          <div className="flex flex-wrap gap-2">
            {txCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleToggleCategoryType(cat.id)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 hover:border-primary/30 transition-all text-xs"
              >
                <span>{cat.icon} {cat.name}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                  cat.category_type === 'income'
                    ? 'bg-green-500/15 text-green-500'
                    : 'bg-red-500/15 text-red-500'
                }`}>
                  {cat.category_type === 'income' ? 'Income' : 'Expense'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Transactions table */}
      <TransactionTable
        filteredTransactions={filteredTransactions}
        dynamicColumns={dynamicColumns}
        hasRawData={hasRawData}
        txCategories={txCategories}
        canEdit={canEdit}
        editingCell={editingCell}
        editValue={editValue}
        setEditingCell={setEditingCell}
        setEditValue={setEditValue}
        colWidths={colWidths}
        handleResizeStart={handleResizeStart}
        editingHeader={editingHeader}
        headerEditValue={headerEditValue}
        setEditingHeader={setEditingHeader}
        setHeaderEditValue={setHeaderEditValue}
        activeSheet={activeSheet}
        saveInlineEdit={saveInlineEdit}
        handleCategoryChange={handleCategoryChange}
        handleAutoGroupingChange={handleAutoGroupingChange}
        handleDeleteTx={handleDeleteTx}
        handleRenameHeader={handleRenameHeader}
        handleDeleteColumn={handleDeleteColumn}
        transactions={transactions}
      />

      {/* Excel Preview Modal */}
      <AutoBooksPreviewModal
        isOpen={previewOpen}
        fileName={previewFile?.name ?? ''}
        rows={previewRows}
        initialConfig={previewInitialConfig}
        onClose={() => { setPreviewOpen(false); setPreviewFile(null); setPreviewWorkbook(null); setPreviewRows([]); }}
        onUpload={(config) => processExcelWithMapping(config)}
      />
    </div>
  );
}
