'use client';

import { Plus, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader2, Trash2, X, Link, Upload, Download, FileSpreadsheet, Pencil, ExternalLink, GripVertical } from 'lucide-react';
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { safeHref } from '@/lib/security';
import { ProjectPermission } from '@/lib/types/project';
import { AddCategoryModal } from './AddCategoryModal';
import { AddFieldModal } from './AddFieldModal';
import { UploadPreviewModal } from './UploadPreviewModal';
import { ImportToCategoryModal } from './ImportToCategoryModal';
import { FilePreviewModal } from './FilePreviewModal';
import { useUnitData } from './useUnitData';

interface UnitDataPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null;
  isAdmin?: boolean;
}

/** Sortable wrapper for a sidebar field item */
function SortableFieldItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1.5 w-full group/field py-0.5 hover:bg-accent/5 rounded px-1 transition-colors">
      <button
        {...attributes}
        {...listeners}
        className="p-0.5 text-muted-foreground/40 hover:text-primary cursor-grab active:cursor-grabbing shrink-0 touch-none flex items-center justify-center transition-colors"
        title="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}

export default function UnitDataPage({ selectedProjectId, userPermission, isAdmin }: UnitDataPageProps) {
  const {
    // Auth/permissions
    canEdit, isOwner, loading,
    // Data
    categories, setCategories, rows, valueMap, setValueMap,
    // View system
    selectedView, assignedView, viewNotice, hasUnsavedChanges,
    allowUserCustomization,
    // UI state
    sidebarOpen, setSidebarOpen,
    collapsedCategories,
    editingCategoryId, setEditingCategoryId, editingCategoryName, setEditingCategoryName,
    editingFieldId, setEditingFieldId, editingFieldName, setEditingFieldName,
    editingCell, setEditingCell, editValue, setEditValue,
    showAddCategory, setShowAddCategory, showAddField, setShowAddField,
    showDeleted, setShowDeleted,
    uploading,
    // Preview modals
    udPreviewOpen, setUdPreviewOpen, udPreviewFile, setUdPreviewFile,
    udPreviewRows, setUdPreviewRows, setUdPreviewWorkbook, udPreviewInitialConfig,
    importOpen, setImportOpen, importFile, setImportFile, importRows, setImportRows,
    filePreview, setFilePreview,
    // Refs
    fileInputRef, quickFileInputRef, importFileInputRef,
    // Column resize
    getColWidth, handleResizeMouseDown,
    // DnD
    dndSensors,
    // Deleted items
    deletedItems,
    // Cell selection
    selectedCells, setSelectedCells,
    // Derived
    visibleFields, nonEmptyRows, totalTableWidth,
    canToggleFields, canReorderFields, categoryColors,
    // Handlers
    getOrderedFields,
    handleViewChange, handleSaveView,
    toggleCategory, toggleField, toggleCategoryCollapse,
    handleAddRow, handleDeleteRow,
    handleRenameCategory, handleRenameField, handleDeleteField,
    handleSoftDeleteCategory, handleRestoreItem,
    handleEmptyTrash, handleRequestRecovery,
    saveCell, handleTablePaste,
    handleCellMouseDown, handleCellMouseEnter,
    handleAddCategory, handleAddField,
    handleQuickExcelUpload, handleExcelUploadPreview, processUdExcelWithMapping,
    handleImportToCategory, processImportToCategory,
    closeFilePreview, getRowLabel, handleFieldReorder,
    // DB functions for inline JSX
    updateField, upsertValue,
  } = useUnitData(selectedProjectId, userPermission, isAdmin);

  if (loading) {
    return (
      <main className="bg-background text-foreground min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading unit data...
        </div>
      </main>
    );
  }

  if (!selectedProjectId) {
    return (
      <main className="bg-background text-foreground min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No project selected. Create a project in Settings first.</p>
      </main>
    );
  }

  return (
    <main className="bg-background text-foreground min-h-screen">
      {/* Hidden file inputs for Excel upload */}
      <input ref={quickFileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleQuickExcelUpload} />
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcelUploadPreview} />
      <input ref={importFileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportToCategory} />

      <div className="flex min-h-[calc(100vh-180px)] bg-muted/30">
        {/* ===== SIDEBAR ===== */}
        {sidebarOpen && (
          <div className="w-64 shrink-0 border-r border-border p-4 overflow-y-auto glass-card backdrop-blur-md bg-background/80 relative z-20">
            {/* Header */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-1 text-[10px] font-bold tracking-widest text-muted-foreground mb-6 hover:text-primary transition-all group"
            >
              <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              DATA VIEW
            </button>

            {/* View Notice */}
            {viewNotice && (
              <div className="mb-2 px-2 py-1 bg-accent/10 border border-accent/30 rounded text-xs text-accent font-medium">
                {viewNotice}
              </div>
            )}

            {isOwner ? (
              <div className="mb-4">
                <label className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase block mb-1.5 ml-1">Load View</label>
                <div className="relative">
                  <select
                    value={selectedView}
                    onChange={(e) => handleViewChange(e.target.value as typeof selectedView)}
                    className="w-full border border-input rounded-xl px-3 py-2 bg-background/50 text-foreground text-xs font-medium focus:ring-2 focus:ring-primary/20 transition-all appearance-none pr-8"
                  >
                    <option value="ALL FIELDS">ALL FIELDS</option>
                    <option value="All Project Users">All Project Users</option>
                    <option value="Personal View">Personal View</option>
                    <option value="PM View">PM View</option>
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            ) : (
              <div className="mb-2">
                <div className="p-2 bg-muted/30 rounded border border-border mb-1">
                  <div className="text-xs text-muted-foreground mb-0.5">Current View:</div>
                  <div className="text-sm font-semibold text-accent">{selectedView}</div>
                </div>
                {allowUserCustomization && selectedView !== 'Personal View' && (
                  <button
                    onClick={() => handleViewChange('Personal View')}
                    className="w-full text-xs px-2 py-1 rounded border border-accent text-accent hover:bg-accent/10 transition-colors"
                  >
                    Customize My View
                  </button>
                )}
                {allowUserCustomization && selectedView === 'Personal View' && (
                  <button
                    onClick={() => handleViewChange(assignedView)}
                    className="w-full text-xs px-2 py-1 rounded border border-input text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Back to {assignedView}
                  </button>
                )}
              </div>
            )}

            {/* Save View */}
            {(isOwner || selectedView === 'Personal View') && selectedView !== 'ALL FIELDS' && (
              <button
                onClick={handleSaveView}
                disabled={!hasUnsavedChanges}
                className={`text-[10px] font-bold tracking-wider uppercase mb-6 block w-full px-3 py-2 rounded-xl transition-all shadow-sm ${
                  hasUnsavedChanges
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95'
                    : 'bg-muted text-muted-foreground cursor-not-allowed border border-border/50'
                }`}
              >
                {hasUnsavedChanges ? 'Save Changes *' : 'Changes Saved'}
              </button>
            )}

            {/* Add Category / Add Custom Field / Upload Excel */}
            {canEdit && (
              <div className="flex flex-col gap-3 mb-6 px-1">
                <button
                  onClick={() => setShowAddCategory(true)}
                  className="flex items-center gap-3 text-xs font-bold tracking-wide uppercase text-foreground/80 hover:text-primary transition-all group"
                >
                  <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary" /> ADD CATEGORY
                </button>
                <button
                  onClick={() => setShowAddField(true)}
                  className="flex items-center gap-3 text-xs font-bold tracking-wide uppercase text-foreground/80 hover:text-primary transition-all group"
                >
                  <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary" /> ADD CUSTOM FIELD
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-3 text-xs font-bold tracking-wide uppercase text-foreground/80 hover:text-primary transition-all disabled:opacity-50 group"
                >
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                  {uploading ? 'IMPORTING...' : 'UPLOAD EXCEL'}
                </button>
                <button
                  onClick={() => quickFileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-3 text-xs font-bold tracking-wide uppercase text-foreground/80 hover:text-primary transition-all disabled:opacity-50 group"
                >
                  <Upload className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                  QUICK UPLOAD
                </button>
                <button
                  onClick={() => importFileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-3 text-xs font-bold tracking-wide uppercase text-emerald-600 hover:text-emerald-500 transition-all disabled:opacity-50 group"
                >
                  <Download className="h-4 w-4 text-emerald-600/70 group-hover:text-emerald-500" />
                  IMPORT TO CATEGORY
                </button>
              </div>
            )}

            {/* Category + Field Checkboxes */}
            <div className="space-y-3">
              {categories.map((cat, ci) => {
                const allVisible = cat.fields.length > 0 && cat.fields.every((f) => f.visible);
                const someVisible = cat.fields.some((f) => f.visible);
                const color = categoryColors[ci % categoryColors.length];

                return (
                  <div key={cat.id} className={`border-l-2 border-dotted ${color} pl-4 pb-2 relative transition-all`}>
                    {/* Category checkbox + rename + delete */}
                    <div className="flex items-center gap-2 mb-2 group/cat">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={allVisible}
                          ref={(el) => { if (el) el.indeterminate = someVisible && !allVisible; }}
                          onChange={() => toggleCategory(cat.id)}
                          disabled={!canToggleFields}
                          className="h-4 w-4 rounded border-input bg-background checked:bg-purple-600 checked:border-purple-600 transition-all cursor-pointer accent-purple-600 shrink-0"
                        />
                        <button
                          onClick={() => toggleCategoryCollapse(cat.id)}
                          className="flex items-center gap-1 flex-1 min-w-0 text-left hover:text-primary transition-colors"
                        >
                          {editingCategoryId === cat.id ? (
                            <input
                              autoFocus
                              type="text"
                              value={editingCategoryName}
                              onChange={(e) => setEditingCategoryName(e.target.value)}
                              onBlur={() => handleRenameCategory(cat.id, editingCategoryName)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameCategory(cat.id, editingCategoryName);
                                if (e.key === 'Escape') setEditingCategoryId(null);
                              }}
                              onClick={(e) => e.preventDefault()}
                              className="text-xs font-bold text-foreground bg-background border border-primary/20 rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            />
                          ) : (
                            <span className="text-xs font-bold tracking-wide text-foreground uppercase truncate flex items-center gap-1">
                              {cat.name}
                              {collapsedCategories.has(cat.id) ? (
                                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              )}
                            </span>
                          )}
                        </button>
                      </div>
                      {cat.linked_file_name && (
                        <a
                          href={`/files?highlight=${encodeURIComponent(cat.linked_file_path ?? '')}`}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0"
                          title={`Linked: ${cat.linked_file_name} — Click to view in Files`}
                        >
                          <ExternalLink className="h-3 w-3 text-blue-500" />
                        </a>
                      )}
                      {canEdit && editingCategoryId !== cat.id && (
                        <button
                          onClick={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name); }}
                          className="p-0.5 text-muted-foreground hover:text-accent transition-colors shrink-0 opacity-0 group-hover/cat:opacity-100"
                          title={`Rename "${cat.name}"`}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => handleSoftDeleteCategory(cat.id)}
                          className="p-0.5 text-muted-foreground hover:text-destructive transition-colors shrink-0 opacity-0 group-hover/cat:opacity-100"
                          title={`Delete "${cat.name}"`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <div className={`grid transition-all duration-300 ease-in-out ${collapsedCategories.has(cat.id) ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}>
                      <div className="overflow-hidden min-h-0">
                        <div className="mt-1">
                          {canReorderFields ? (
                            <DndContext
                              sensors={dndSensors}
                              collisionDetection={closestCenter}
                              onDragEnd={(event: DragEndEvent) => {
                                const { active, over } = event;
                                if (over && active.id !== over.id) {
                                  handleFieldReorder(cat.id, String(active.id), String(over.id));
                                }
                              }}
                            >
                              <SortableContext items={getOrderedFields(cat).map((f) => f.id)} strategy={verticalListSortingStrategy}>
                                <div className="ml-1 space-y-0.5">
                                  {getOrderedFields(cat).map((field) => (
                                    <SortableFieldItem key={field.id} id={field.id}>
                                      <label className={`flex items-center gap-2 flex-1 min-w-0 ${canToggleFields ? 'cursor-pointer' : 'cursor-default'}`}>
                                        <input
                                          type="checkbox"
                                          checked={field.visible}
                                          onChange={() => toggleField(field.id)}
                                          disabled={!canToggleFields}
                                          className="h-3.5 w-3.5 rounded border-input bg-background checked:bg-purple-600 checked:border-purple-600 transition-all cursor-pointer accent-purple-600 shrink-0"
                                        />
                                        {editingFieldId === field.id ? (
                                          <input
                                            autoFocus
                                            type="text"
                                            value={editingFieldName}
                                            onChange={(e) => setEditingFieldName(e.target.value)}
                                            onBlur={() => handleRenameField(field.id, editingFieldName)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') handleRenameField(field.id, editingFieldName);
                                              if (e.key === 'Escape') setEditingFieldId(null);
                                            }}
                                            onClick={(e) => e.preventDefault()}
                                            className="text-xs bg-background border border-input rounded px-1 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-ring"
                                          />
                                        ) : (
                                          <span className={`text-[12px] flex items-center gap-1.5 ${field.visible ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                            {field.name}
                                            {field.is_file_link && (
                                              <span title="File link field" className="shrink-0">
                                                <Upload className="h-3 w-3 text-muted-foreground" />
                                              </span>
                                            )}
                                            {field.linked_file_name && (
                                              <a
                                                href={`/files?highlight=${encodeURIComponent(field.linked_file_path ?? '')}`}
                                                onClick={(e) => e.stopPropagation()}
                                                className="shrink-0"
                                                title={`Linked: ${field.linked_file_name} — Click to view in Files`}
                                              >
                                                <ExternalLink className="h-3 w-3 text-blue-500" />
                                              </a>
                                            )}
                                            {field.is_hyperlink && (
                                              <span title="Shows to indicate a linked file column" className="shrink-0">
                                                <Link className="h-3 w-3 text-muted-foreground" />
                                              </span>
                                            )}
                                          </span>
                                        )}
                                      </label>
                                      {canEdit && editingFieldId !== field.id && (
                                        <>
                                          <button
                                            onClick={async () => {
                                              const newVal = !field.is_auto_id;
                                              const ok = await updateField(field.id, { is_auto_id: newVal });
                                              if (ok) {
                                                setCategories((prev) => prev.map((c) => c.id === cat.id
                                                  ? { ...c, fields: c.fields.map((f) => f.id === field.id ? { ...f, is_auto_id: newVal } : f) }
                                                  : c
                                                ));
                                              }
                                            }}
                                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 transition-all ${
                                              field.is_auto_id
                                                ? 'bg-blue-100 text-blue-600 border border-blue-200 shadow-sm'
                                                : 'text-muted-foreground/30 hover:text-blue-500 opacity-0 group-hover/field:opacity-100 border border-transparent'
                                            }`}
                                            title={field.is_auto_id ? 'Disable auto ID' : 'Set as auto ID column'}
                                          >
                                            ID
                                          </button>
                                          <button
                                            onClick={() => { setEditingFieldId(field.id); setEditingFieldName(field.name); }}
                                            className="p-0.5 text-muted-foreground hover:text-accent transition-colors shrink-0 opacity-0 group-hover/field:opacity-100"
                                            title={`Rename "${field.name}"`}
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteField(field.id)}
                                            className="p-0.5 text-muted-foreground hover:text-destructive transition-colors shrink-0 opacity-0 group-hover/field:opacity-100"
                                            title={`Delete "${field.name}"`}
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </>
                                      )}
                                    </SortableFieldItem>
                                  ))}
                                </div>
                              </SortableContext>
                            </DndContext>
                          ) : (
                            <div className="ml-1 space-y-0.5">
                              {getOrderedFields(cat).map((field) => (
                                <div key={field.id} className="flex items-center gap-1.5 w-full group/field py-0.5 hover:bg-accent/5 rounded px-1 transition-colors">
                                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                                  <label className={`flex items-center gap-2 flex-1 min-w-0 ${canToggleFields ? 'cursor-pointer' : 'cursor-default'}`}>
                                    <input
                                      type="checkbox"
                                      checked={field.visible}
                                      onChange={() => toggleField(field.id)}
                                      disabled={!canToggleFields}
                                      className="h-3.5 w-3.5 rounded border-input bg-background checked:bg-purple-600 checked:border-purple-600 transition-all cursor-pointer accent-purple-600 shrink-0"
                                    />
                                    <span className={`text-[12px] flex items-center gap-1.5 ${field.visible ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                      {field.name}
                                      {field.is_file_link && (
                                        <span title="File link field" className="shrink-0">
                                          <Upload className="h-3 w-3 text-muted-foreground" />
                                        </span>
                                      )}
                                      {field.linked_file_name && (
                                        <a
                                          href={`/files?highlight=${encodeURIComponent(field.linked_file_path ?? '')}`}
                                          onClick={(e) => e.stopPropagation()}
                                          className="shrink-0"
                                          title={`Linked: ${field.linked_file_name} — Click to view in Files`}
                                        >
                                          <ExternalLink className="h-3 w-3 text-blue-500" />
                                        </a>
                                      )}
                                      {field.is_hyperlink && (
                                        <span title="Shows to indicate a linked file column" className="shrink-0">
                                          <Link className="h-3 w-3 text-muted-foreground" />
                                        </span>
                                      )}
                                      {field.is_auto_id && (
                                        <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/40 shrink-0">ID</span>
                                      )}
                                    </span>
                                  </label>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Deleted Items */}
            {deletedItems.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border">
                <button
                  onClick={() => setShowDeleted(!showDeleted)}
                  className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground mb-2 w-full"
                >
                  <Trash2 className="h-3 w-3" />
                  Deleted Items ({deletedItems.length})
                  {showDeleted ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
                </button>
                {showDeleted && (
                  <div className="space-y-1">
                    {isOwner && (
                      <button
                        onClick={handleEmptyTrash}
                        className="text-[10px] text-red-500 hover:text-red-400 font-semibold mb-1"
                      >
                        Empty All
                      </button>
                    )}
                    {deletedItems.map((item) => (
                      <div key={item.id} className="flex items-center gap-1 py-0.5">
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-muted-foreground truncate block">
                            {item.name}
                            <span className="text-[10px] ml-1 opacity-60">
                              ({item.type}{item.parent_name ? ` · ${item.parent_name}` : ''})
                            </span>
                          </span>
                        </div>
                        {isOwner ? (
                          <button
                            onClick={() => handleRestoreItem(item)}
                            className="text-[10px] text-accent hover:underline shrink-0 px-1"
                            title="Restore"
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRequestRecovery(item)}
                            className="text-[10px] text-muted-foreground hover:text-accent shrink-0 px-1"
                            title="Request recovery from admin"
                          >
                            Request
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sidebar toggle when closed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="shrink-0 w-8 border-r border-border flex items-start justify-center pt-4 hover:bg-muted transition-colors"
            title="Open DATA VIEW"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* ===== DATA TABLE ===== */}
        <div className="flex-1 overflow-x-auto p-4 lg:p-6">
          {visibleFields.length === 0 ? (
            <div className="text-center py-20 glass-card backdrop-blur-md bg-background/50 border rounded-2xl">
              <p className="text-sm font-bold tracking-widest text-muted-foreground uppercase mb-2">No active columns</p>
              <p className="text-xs text-muted-foreground/60">Use the sidebar to enable fields for this view.</p>
            </div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm relative">
              <div className="overflow-x-auto">
                <table className="text-xs sm:text-sm" style={{ tableLayout: 'fixed', width: totalTableWidth, minWidth: '100%' }} onPaste={handleTablePaste}>
                {/* Colgroup drives column widths for table-layout:fixed */}
                <colgroup>
                  {categories.map((cat) => {
                    const catVisibleFields = getOrderedFields(cat).filter((f) => f.visible);
                    if (catVisibleFields.length === 0) return null;
                    if (collapsedCategories.has(cat.id)) {
                      return <col key={cat.id} style={{ width: 60 }} />;
                    }
                    return catVisibleFields.map((field) => (
                      <col key={field.id} style={{ width: getColWidth(field.id) }} />
                    ));
                  })}
                  <col style={{ width: 40 }} />
                </colgroup>
                {/* Category header row */}
                <thead>
                  {categories.some((cat) => getOrderedFields(cat).filter((f) => f.visible).length > 0) && (
                  <tr className="bg-muted/30 border-b border-border/50">
                    {categories.map((cat) => {
                      const catVisibleFields = getOrderedFields(cat).filter((f) => f.visible);
                      if (catVisibleFields.length === 0) return null;
                      const isCollapsed = collapsedCategories.has(cat.id);

                      return (
                        <th
                          key={cat.id}
                          colSpan={isCollapsed ? 1 : catVisibleFields.length}
                          className={`${isCollapsed ? 'px-1' : 'px-4'} py-4 text-left bg-muted/30 border-r border-border/50 last:border-r-0 transition-all`}
                        >
                          <div className={`flex items-center ${isCollapsed ? 'justify-center gap-1' : 'gap-2'}`}>
                            <span className="text-amber-500 drop-shadow-sm shrink-0">&#128193;</span>
                            {!isCollapsed && (
                              <span className="font-bold text-[10px] tracking-widest uppercase text-primary drop-shadow-sm truncate">{cat.name}</span>
                            )}
                            <button
                              onClick={() => toggleCategoryCollapse(cat.id)}
                              className={`${isCollapsed ? '' : 'ml-auto'} p-1 text-muted-foreground hover:text-primary transition-all rounded-lg hover:bg-primary/5 shrink-0`}
                              title={isCollapsed ? 'Expand' : 'Collapse'}
                            >
                              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </th>
                      );
                    })}
                    <th className="w-8"></th>
                  </tr>
                  )}

                  {/* Field header row */}
                  <tr className="bg-muted/30 border-b border-border/50">
                    {categories.map((cat) => {
                      const catVisibleFields = getOrderedFields(cat).filter((f) => f.visible);
                      if (catVisibleFields.length === 0) return null;
                      const isCollapsed = collapsedCategories.has(cat.id);

                      if (isCollapsed) {
                        return (
                          <th key={cat.id} className="px-3 py-2 text-xs text-muted-foreground border-r border-input">
                            ...
                          </th>
                        );
                      }

                      return catVisibleFields.map((field) => (
                        <th
                          key={field.id}
                          className="relative px-4 py-4 text-left font-bold text-[10px] tracking-widest uppercase text-muted-foreground whitespace-nowrap border-r border-border/50 last:border-r-0 select-none overflow-hidden group/th"
                          title={field.tooltip ?? undefined}
                        >
                          <div className="flex items-center gap-2 group-hover/th:text-primary transition-colors">
                            {field.name}
                            {field.is_file_link && <Upload className="h-3.5 w-3.5 opacity-60" />}
                            {field.is_hyperlink && <Link className="h-3.5 w-3.5 opacity-60" />}
                          </div>
                          {/* Resize handle */}
                          <div
                            onMouseDown={(e) => handleResizeMouseDown(field.id, e)}
                            className="absolute top-0 right-0 h-full w-2 cursor-col-resize group/resize z-10"
                          >
                            <div className="absolute right-0 top-0 h-full w-px bg-transparent group-hover/resize:bg-primary transition-colors" />
                          </div>
                        </th>
                      ));
                    })}
                    <th className="w-8"></th>
                  </tr>
                </thead>

                <tbody>
                  {/* Summary row */}
                  {nonEmptyRows.length > 0 && (
                    <tr className="border-b-2 border-accent/40 bg-muted/50">
                      {categories.map((cat) => {
                        const catVisibleFields = getOrderedFields(cat).filter((f) => f.visible);
                        if (catVisibleFields.length === 0) return null;
                        const isCollapsed = collapsedCategories.has(cat.id);
                        if (isCollapsed) {
                          return <td key={cat.id} className="px-3 py-4 text-xs border-r border-input" />;
                        }
                        return catVisibleFields.map((field) => {
                          if (!field.show_sum) {
                            return (
                              <td
                                key={field.id}
                                className="px-3 py-4 border-r border-input last:border-r-0 cursor-pointer hover:bg-accent/10 transition-colors group"
                                title="Click to enable sum for this column"
                                onClick={canEdit ? async () => {
                                  const ok = await updateField(field.id, { show_sum: true });
                                  if (ok) {
                                    setCategories((prev) => prev.map((c) => c.id === cat.id
                                      ? { ...c, fields: c.fields.map((f) => f.id === field.id ? { ...f, show_sum: true } : f) }
                                      : c
                                    ));
                                  }
                                } : undefined}
                              >
                                <span className="text-[10px] text-muted-foreground/50 group-hover:text-accent/70 italic">+ sum</span>
                              </td>
                            );
                          }

                          let sum = 0;
                          let hasNumeric = false;
                          for (const row of nonEmptyRows) {
                            const val = valueMap.get(`${row.id}-${field.id}`);
                            if (val?.value != null) {
                              const num = parseFloat(val.value);
                              if (!isNaN(num)) {
                                sum += num;
                                hasNumeric = true;
                              }
                            }
                          }

                          return (
                            <td
                              key={field.id}
                              className="px-3 py-4 border-r border-input last:border-r-0 cursor-pointer hover:bg-accent/10 transition-colors"
                              title="Click to disable sum"
                              onClick={canEdit ? async () => {
                                const ok = await updateField(field.id, { show_sum: false });
                                if (ok) {
                                  setCategories((prev) => prev.map((c) => c.id === cat.id
                                    ? { ...c, fields: c.fields.map((f) => f.id === field.id ? { ...f, show_sum: false } : f) }
                                    : c
                                  ));
                                }
                              } : undefined}
                            >
                              <span className="text-xs font-bold text-accent">{hasNumeric ? sum.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : ''}</span>
                            </td>
                          );
                        });
                      })}
                      <td className="w-8" />
                    </tr>
                  )}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={visibleFields.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                        No data yet. Click &quot;+ Add Row&quot; to start adding data.
                      </td>
                    </tr>
                  ) : (
                    nonEmptyRows.map((row, rowIndex) => (
                      <tr key={row.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                        {categories.map((cat) => {
                          const catVisibleFields = getOrderedFields(cat).filter((f) => f.visible);
                          if (catVisibleFields.length === 0) return null;
                          const isCollapsed = collapsedCategories.has(cat.id);

                          if (isCollapsed) {
                            return (
                              <td key={cat.id} className="px-3 py-2 text-xs text-muted-foreground border-r border-input">
                                ...
                              </td>
                            );
                          }

                          return catVisibleFields.map((field) => {
                            const key = `${row.id}-${field.id}`;
                            const val = valueMap.get(key);
                            const cellValue = val?.value ?? '';
                            const isEditing = editingCell?.rowId === row.id && editingCell?.fieldId === field.id;

                            // Auto-ID fields show sequential numbers
                            if (field.is_auto_id) {
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-4 whitespace-nowrap border-r border-border/50 last:border-r-0 overflow-hidden"
                                >
                                  <span className="text-xs text-blue-400 font-semibold">{rowIndex + 1}</span>
                                </td>
                              );
                            }

                            const isCellSelected = selectedCells.has(key);
                            return (
                              <td
                                key={field.id}
                                data-field-id={field.id}
                                data-row-id={row.id}
                                tabIndex={0}
                                onMouseDown={(e) => handleCellMouseDown(row.id, field.id, e)}
                                onMouseEnter={() => handleCellMouseEnter(row.id, field.id)}
                                className={`px-4 py-4 whitespace-nowrap border-r border-border/50 last:border-r-0 overflow-hidden group/td focus:outline-none focus:ring-1 focus:ring-primary/30 ${isCellSelected ? 'bg-primary/15 ring-1 ring-primary/40' : ''}`}
                              >
                                {isEditing ? (
                                  <input
                                    autoFocus
                                    type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={() => saveCell(row.id, field.id, editValue)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveCell(row.id, field.id, editValue);
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-full px-2 py-1 bg-background/50 border border-primary/20 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
                                  />
                                ) : (
                                  <div
                                    onDoubleClick={canEdit ? () => {
                                      setSelectedCells(new Set());
                                      setEditingCell({ rowId: row.id, fieldId: field.id });
                                      setEditValue(cellValue);
                                    } : undefined}
                                    className={`${canEdit ? 'cursor-pointer hover:bg-primary/5' : ''} px-2 py-1 rounded-lg min-w-12 min-h-5 text-xs flex items-center gap-2 transition-all font-medium`}
                                    title={canEdit ? 'Double-click to edit' : undefined}
                                  >
                                    {field.is_hyperlink && cellValue ? (
                                      <a
                                        href={safeHref(cellValue)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-500 hover:text-blue-400 underline decoration-blue-500/30 underline-offset-4"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {cellValue}
                                      </a>
                                    ) : (
                                      <span className={cellValue ? 'text-foreground/90' : 'text-muted-foreground/30'}>
                                        {cellValue || '-'}
                                      </span>
                                    )}
                                    {val?.file_url && (
                                      <span className="inline-flex items-center gap-0.5 shrink-0">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const driveId = val.file_url!;
                                            setFilePreview({
                                              url: `https://drive.google.com/file/d/${driveId}/preview`,
                                              name: cellValue || 'File',
                                              downloadUrl: `https://drive.google.com/uc?export=download&id=${driveId}`,
                                            });
                                          }}
                                          className="shrink-0 p-1 text-blue-500 hover:text-blue-400 transition-colors bg-blue-500/5 rounded-md"
                                          title={`Linked to: ${getRowLabel(row.id)} — Click to preview`}
                                        >
                                          <Link className="h-3 w-3" />
                                        </button>
                                        {canEdit && (
                                          <button
                                            onClick={async (e) => {
                                              e.stopPropagation();
                                              const ok = await upsertValue(row.id, field.id, null, null);
                                              if (ok) {
                                                setValueMap((prev) => {
                                                  const next = new Map(prev);
                                                  next.delete(`${row.id}-${field.id}`);
                                                  return next;
                                                });
                                              }
                                            }}
                                            className="shrink-0 p-1 text-red-500/60 hover:text-red-400 transition-colors rounded-md"
                                            title="Remove linked file"
                                          >
                                            <X className="h-2.5 w-2.5" />
                                          </button>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          });
                        })}
                        <td className="px-2 py-4 whitespace-nowrap">
                          {canEdit && (
                            <button
                              onClick={() => handleDeleteRow(row.id)}
                              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                              title="Delete row"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Add Row Button */}
          {canEdit && (
            <button
              onClick={handleAddRow}
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-95 group mb-4 ml-1"
            >
              <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
              ADD NEW ROW
            </button>
          )}
        </div>
      </div>

      <AddCategoryModal
        isOpen={showAddCategory}
        onClose={() => setShowAddCategory(false)}
        onSubmit={handleAddCategory}
      />
      <AddFieldModal
        isOpen={showAddField}
        onClose={() => setShowAddField(false)}
        categories={categories}
        onSubmit={handleAddField}
      />
      <UploadPreviewModal
        isOpen={udPreviewOpen}
        fileName={udPreviewFile?.name ?? ''}
        previewRows={udPreviewRows}
        uploading={uploading}
        initialConfig={udPreviewInitialConfig}
        onClose={() => { setUdPreviewOpen(false); setUdPreviewFile(null); setUdPreviewWorkbook(null); setUdPreviewRows([]); }}
        onUpload={processUdExcelWithMapping}
      />
      <ImportToCategoryModal
        isOpen={importOpen}
        fileName={importFile?.name ?? ''}
        importRows={importRows}
        categories={categories}
        uploading={uploading}
        onClose={() => { setImportOpen(false); setImportFile(null); setImportRows([]); }}
        onImport={processImportToCategory}
      />
      <FilePreviewModal preview={filePreview} onClose={closeFilePreview} />
    </main>
  );
}
