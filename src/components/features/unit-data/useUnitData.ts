'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { CategoryWithFields, UnitDataField, UnitDataRow, UnitDataValue, ViewName } from '@/lib/types/unit-data';
import {
  getCategories,
  getRows,
  getValues,
  createCategory,
  createField,
  updateCategory,
  updateField,
  createRow,
  deleteRow,
  softDeleteField,
  softDeleteCategory,
  restoreField,
  restoreCategory,
  getDeletedItems,
  DeletedItem,
  upsertValue,
  getCurrentFieldVisibility,
  permanentDeleteField,
  permanentDeleteCategory,
  cleanupAndResortRows,
} from '@/lib/db/unit-data';
import { createRecoveryRequest } from '@/lib/db/unit-data-recovery';

import { getView, getProjectViews, saveView, saveFieldOrder } from '@/lib/db/unit-data-views';
import { getProjectSettings } from '@/lib/db/project-settings';
import { ProjectPermission } from '@/lib/types/project';
import { usePermission } from '@/lib/hooks/usePermission';
import { useUserLogger } from '@/lib/hooks/useUserLogger';
import { useColumnResize } from '@/lib/hooks/useColumnResize';
import * as XLSX from 'xlsx';
import { UploadPreviewConfig } from './UploadPreviewModal';
import { ImportConfig } from './ImportToCategoryModal';
import { FilePreviewData } from './FilePreviewModal';

type ViewMode = ViewName;

interface UndoEntry {
  changes: { rowId: string; fieldId: string; oldValue: string | null }[];
  createdRowIds?: string[];
}

export function useUnitData(selectedProjectId: string | null, userPermission?: ProjectPermission | null, isAdmin?: boolean) {
  const { user } = useAuth();

  // Permission flags — null userPermission means owner (full access); admin also gets full access
  const { canEdit } = usePermission(userPermission, 'perm_unit_data', isAdmin);

  // Data state
  const [categories, setCategories] = useState<CategoryWithFields[]>([]);
  const [rows, setRows] = useState<UnitDataRow[]>([]);
  const [valueMap, setValueMap] = useState<Map<string, UnitDataValue>>(new Map());
  const [loading, setLoading] = useState(true);

  const { log, displayName: displayNameRef } = useUserLogger(selectedProjectId);

  // View system
  const isOwner = !userPermission || !!isAdmin; // null permission = project owner, admin also gets owner access
  const assignedView: ViewMode = (userPermission?.unit_data_view as ViewMode) ?? 'All Project Users';
  const [selectedView, setSelectedView] = useState<ViewMode>('ALL FIELDS');
  const [viewConfigs, setViewConfigs] = useState<Map<ViewMode, Record<string, boolean>>>(new Map());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [viewNotice, setViewNotice] = useState('');
  const [allowUserCustomization, setAllowUserCustomization] = useState(false);
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set());

  // Deleted items (soft-deleted)
  const [deletedItems, setDeletedItems] = useState<DeletedItem[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);

  // Inline rename state (sidebar)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingFieldName, setEditingFieldName] = useState('');

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Column resizing
  const { getWidth: getColWidth, onResizeStart: handleResizeMouseDown } = useColumnResize(120);

  // Inline editing
  const [editingCell, setEditingCell] = useState<{ rowId: string; fieldId: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  // Add category/field modals
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddField, setShowAddField] = useState(false);

  // Field order (drag-and-drop column reordering)
  const [fieldOrder, setFieldOrder] = useState<string[] | null>(null);
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Excel upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickFileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Excel preview modal state
  const [udPreviewOpen, setUdPreviewOpen] = useState(false);
  const [udPreviewRows, setUdPreviewRows] = useState<unknown[][]>([]);
  const [udPreviewFile, setUdPreviewFile] = useState<File | null>(null);
  const [udPreviewWorkbook, setUdPreviewWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [udPreviewInitialConfig, setUdPreviewInitialConfig] = useState<UploadPreviewConfig>({ headerRow: 1, dataStartRow: 2, dataEndRow: 0, startCol: 0, endCol: 0, columnSkip: {} });

  // Import to Category modal state
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<unknown[][]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);

  // Undo stack for cell edits and paste operations
  const undoStack = useRef<UndoEntry[]>([]);

  // File preview modal
  const [filePreview, setFilePreview] = useState<FilePreviewData | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);

  const closeFilePreview = () => {
    if (filePreview?.url?.startsWith('blob:')) URL.revokeObjectURL(filePreview.url);
    setFilePreview(null);
  };

  // Cell selection for bulk operations (click + shift-click range, or click-drag)
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set()); // "rowId-fieldId"
  const [selAnchor, setSelAnchor] = useState<{ rowId: string; fieldId: string } | null>(null);
  const [tableSelecting, setTableSelecting] = useState(false);

  // Auto-clear view notice
  useEffect(() => {
    if (!viewNotice) return;
    const t = setTimeout(() => setViewNotice(''), 3000);
    return () => clearTimeout(t);
  }, [viewNotice]);

  // Load allow_user_customization from project settings
  useEffect(() => {
    if (!selectedProjectId) { setAllowUserCustomization(false); return; }
    getProjectSettings(selectedProjectId).then((s) => setAllowUserCustomization(s.allow_user_customization));
  }, [selectedProjectId]);

  // Load data when project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setCategories([]);
      setRows([]);
      setValueMap(new Map());
      setLoading(false);
      return;
    }
    loadData(selectedProjectId);
  }, [selectedProjectId]);

  // Refresh values when files are updated
  useEffect(() => {
    if (!selectedProjectId) return;
    const refreshValues = async () => {
      const valData = await getValues(selectedProjectId);
      const vMap = new Map<string, UnitDataValue>();
      valData.forEach((v) => vMap.set(`${v.row_id}-${v.field_id}`, v));
      setValueMap(vMap);
    };
    window.addEventListener('files-updated', refreshValues);
    return () => window.removeEventListener('files-updated', refreshValues);
  }, [selectedProjectId]);

  const loadData = async (projectId: string) => {
    setLoading(true);
    setNewRowIds(new Set());

    const cats = await getCategories(projectId);
    const rowData = await getRows(projectId);
    const valData = await getValues(projectId);

    const vMap = new Map<string, UnitDataValue>();
    valData.forEach((v) => vMap.set(`${v.row_id}-${v.field_id}`, v));

    setRows(rowData);
    setValueMap(vMap);

    // Load view configs and apply the correct view
    if (isOwner) {
      // Owner: load all project views, default to ALL FIELDS
      const views = await getProjectViews(projectId);
      const configMap = new Map<ViewMode, Record<string, boolean>>();
      views.forEach((v) => configMap.set(v.view_name as ViewMode, v.field_visibility));
      setViewConfigs(configMap);
      // Start on ALL FIELDS — show everything
      setCategories(cats.map((c) => ({ ...c, fields: c.fields.map((f) => ({ ...f, visible: true })) })));
      setSelectedView('ALL FIELDS');
      // Load personal field order if available
      if (user) {
        const personalView = await getView(projectId, 'Personal View', user.id);
        setFieldOrder(personalView?.field_order ?? null);
      }
    } else {
      // Non-owner: load their assigned view
      const viewName = assignedView;
      setSelectedView(viewName);

      if (viewName === 'ALL FIELDS') {
        setCategories(cats.map((c) => ({ ...c, fields: c.fields.map((f) => ({ ...f, visible: true })) })));
      } else if (viewName === 'Personal View') {
        const view = user ? await getView(projectId, 'Personal View', user.id) : null;
        setCategories(applyViewConfig(cats, view?.field_visibility ?? null));
        setFieldOrder(view?.field_order ?? null);
      } else {
        const view = await getView(projectId, viewName);
        setCategories(applyViewConfig(cats, view?.field_visibility ?? null));
        setFieldOrder(view?.field_order ?? null);
      }
    }

    setHasUnsavedChanges(false);
    setLoading(false);

    // Load soft-deleted items for the trash section
    getDeletedItems(projectId).then(setDeletedItems);
  };

  /** Apply a view config to categories. null config = show all. */
  const applyViewConfig = (cats: CategoryWithFields[], config: Record<string, boolean> | null): CategoryWithFields[] => {
    if (!config || Object.keys(config).length === 0) return cats;
    return cats.map((c) => ({
      ...c,
      fields: c.fields.map((f) => ({ ...f, visible: config[f.id] ?? f.visible })),
    }));
  };

  /** Return a category's fields sorted by fieldOrder (if set), preserving default sort_order otherwise. */
  const getOrderedFields = (cat: CategoryWithFields): UnitDataField[] => {
    if (!fieldOrder) return cat.fields;
    const orderMap = new Map(fieldOrder.map((id, idx) => [id, idx]));
    return [...cat.fields].sort((a, b) => {
      const ai = orderMap.get(a.id);
      const bi = orderMap.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return 0; // keep original relative order
    });
  };

  // Can this user reorder fields? Owners always can; non-owners only when customization is enabled
  const canReorderFields = isOwner || allowUserCustomization;

  /** Handle drag-end in sidebar: recompute full fieldOrder and persist to Personal View. */
  const handleFieldReorder = async (categoryId: string, activeId: string, overId: string) => {
    if (activeId === overId || !canReorderFields) return;

    // Build current full order across all categories
    const currentOrder = categories.flatMap((c) => getOrderedFields(c).map((f) => f.id));

    // Find positions within the full order
    const oldIndex = currentOrder.indexOf(activeId);
    const newIndex = currentOrder.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1) return;

    // Perform the move
    const newOrder = [...currentOrder];
    newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, activeId);

    setFieldOrder(newOrder);

    // Always persist field order to the user's own Personal View
    if (selectedProjectId && user) {
      await saveFieldOrder(selectedProjectId, user.id, newOrder);
    }
  };

  // Get all visible fields in order (respecting fieldOrder)
  const visibleFields = categories.flatMap((c) => getOrderedFields(c).filter((f) => f.visible));

  // Get the unit label for a row (first non-empty cell value in field order)
  const getRowLabel = (rowId: string): string => {
    const allFields = categories.flatMap((c) => getOrderedFields(c));
    // Check for auto-ID field — use sequential row index as ID
    const autoIdField = allFields.find((f) => f.is_auto_id);
    if (autoIdField) {
      const rowIdx = rows.findIndex((r) => r.id === rowId);
      const idNum = rowIdx >= 0 ? rowIdx + 1 : '?';
      // Find a descriptive value from the first non-auto-ID field
      for (const f of allFields) {
        if (f.is_auto_id) continue;
        const v = valueMap.get(`${rowId}-${f.id}`);
        if (v?.value) return `${autoIdField.name} ${idNum} — ${v.value}`;
      }
      return `${autoIdField.name} ${idNum}`;
    }
    for (const f of allFields) {
      const v = valueMap.get(`${rowId}-${f.id}`);
      if (v?.value) return v.value;
    }
    return 'Unknown unit';
  };

  // Compute table width so resizing actually expands columns rather than redistributing
  const totalTableWidth = categories.reduce((sum, cat) => {
    const catVisibleFields = getOrderedFields(cat).filter((f) => f.visible);
    if (catVisibleFields.length === 0) return sum;
    if (collapsedCategories.has(cat.id)) return sum + 60;
    return sum + catVisibleFields.reduce((s, f) => s + (getColWidth(f.id)), 0);
  }, 40); // +40 for delete column

  // Filter out fully blank rows (no values across any visible field), but always show newly added rows
  const nonEmptyRows = rows
    .filter((row) =>
      newRowIds.has(row.id) ||
      visibleFields.some((field) => {
        const val = valueMap.get(`${row.id}-${field.id}`);
        return val?.value != null && val.value.trim() !== '';
      })
    )
    // Sort: rows with more filled cells appear first so data aligns at the top
    .sort((a, b) => {
      // New rows always go to the bottom
      if (newRowIds.has(a.id) && !newRowIds.has(b.id)) return 1;
      if (!newRowIds.has(a.id) && newRowIds.has(b.id)) return -1;
      // Count non-empty visible cells per row
      let countA = 0;
      let countB = 0;
      for (const field of visibleFields) {
        const valA = valueMap.get(`${a.id}-${field.id}`);
        if (valA?.value != null && valA.value.trim() !== '') countA++;
        const valB = valueMap.get(`${b.id}-${field.id}`);
        if (valB?.value != null && valB.value.trim() !== '') countB++;
      }
      // More filled cells → appears first
      if (countB !== countA) return countB - countA;
      // Tiebreaker: preserve original sort_order
      return a.sort_order - b.sort_order;
    });

  // View mode handler — owner switches between views
  const handleViewChange = async (view: ViewMode) => {
    if (hasUnsavedChanges) {
      if (!window.confirm('You have unsaved view changes. Switch anyway?')) return;
    }

    setSelectedView(view);
    setHasUnsavedChanges(false);

    if (view === 'ALL FIELDS') {
      setCategories((prev) =>
        prev.map((c) => ({ ...c, fields: c.fields.map((f) => ({ ...f, visible: true })) }))
      );
      // Keep personal field order even in ALL FIELDS view
      if (user && selectedProjectId) {
        const personalView = await getView(selectedProjectId, 'Personal View', user.id);
        setFieldOrder(personalView?.field_order ?? null);
      }
      return;
    }

    if (view === 'Personal View' && user && selectedProjectId) {
      const saved = await getView(selectedProjectId, 'Personal View', user.id);
      setCategories((prev) => applyViewConfig(prev, saved?.field_visibility ?? null));
      setFieldOrder(saved?.field_order ?? null);
      return;
    }

    // Project views (All Project Users, PM View)
    const config = viewConfigs.get(view);
    if (config && Object.keys(config).length > 0) {
      setCategories((prev) => applyViewConfig(prev, config));
    } else if (selectedProjectId) {
      const saved = await getView(selectedProjectId, view);
      if (saved && Object.keys(saved.field_visibility).length > 0) {
        setViewConfigs((prev) => new Map(prev).set(view, saved.field_visibility));
        setCategories((prev) => applyViewConfig(prev, saved.field_visibility));
      }
      // If no saved config, keep current state (all fields visible)
    }
    // Load field order for this view
    if (selectedProjectId) {
      const viewData = await getView(selectedProjectId, view, view === 'Personal View' && user ? user.id : undefined);
      setFieldOrder(viewData?.field_order ?? null);
    }
  };

  // Save the current view configuration
  const handleSaveView = async () => {
    if (!selectedProjectId || !user) return;
    if (selectedView === 'ALL FIELDS') return; // ALL FIELDS is always all visible

    const currentVis = getCurrentFieldVisibility(categories);
    const userId = selectedView === 'Personal View' ? user.id : undefined;
    const ok = await saveView(selectedProjectId, selectedView, currentVis, userId);

    if (ok) {
      setViewConfigs((prev) => new Map(prev).set(selectedView, currentVis));
      setHasUnsavedChanges(false);
      setViewNotice(`"${selectedView}" saved.`);
      log(`Saved view configuration for "${selectedView}"`);
    }
  };

  // Can this user toggle fields in the sidebar?
  const canToggleFields = isOwner || (selectedView === 'Personal View');

  // Toggle category visibility (all fields in category)
  const toggleCategory = (categoryId: string) => {
    if (!canToggleFields) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;

    const allVisible = cat.fields.every((f) => f.visible);
    const newVisible = !allVisible;

    setCategories((prev) =>
      prev.map((c) =>
        c.id === categoryId
          ? { ...c, fields: c.fields.map((f) => ({ ...f, visible: newVisible })) }
          : c
      )
    );
    setHasUnsavedChanges(true);
  };

  // Toggle individual field visibility
  const toggleField = (fieldId: string) => {
    if (!canToggleFields) return;
    setCategories((prev) =>
      prev.map((c) => ({
        ...c,
        fields: c.fields.map((f) => (f.id === fieldId ? { ...f, visible: !f.visible } : f)),
      }))
    );
    setHasUnsavedChanges(true);
  };

  // Toggle category collapse in table header
  const toggleCategoryCollapse = (categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  // Add row
  const handleAddRow = async () => {
    if (!selectedProjectId || !user) return;
    const row = await createRow(selectedProjectId, rows.length);
    if (row) {
      setRows((prev) => [...prev, row]);
      setNewRowIds((prev) => new Set(prev).add(row.id));
      log('Added a new unit data row');
    }
  };

  // Delete row
  const handleDeleteRow = async (rowId: string) => {
    if (!user || !selectedProjectId) return;
    const ok = await deleteRow(rowId);
    if (ok) {
      setRows((prev) => prev.filter((r) => r.id !== rowId));
      log('Deleted a unit data row');
    }
  };

  // Rename category
  const handleRenameCategory = async (categoryId: string, name: string) => {
    const trimmed = name.trim();
    setEditingCategoryId(null);
    if (!trimmed) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat || cat.name === trimmed) return;
    const ok = await updateCategory(categoryId, trimmed);
    if (ok) {
      setCategories((prev) => prev.map((c) => c.id === categoryId ? { ...c, name: trimmed } : c));
      log(`Renamed category "${cat.name}" to "${trimmed}"`);
    }
  };

  // Rename field
  const handleRenameField = async (fieldId: string, name: string) => {
    const trimmed = name.trim();
    setEditingFieldId(null);
    if (!trimmed) return;
    const field = categories.flatMap((c) => c.fields).find((f) => f.id === fieldId);
    if (!field || field.name === trimmed) return;
    const ok = await updateField(fieldId, { name: trimmed });
    if (ok) {
      setCategories((prev) =>
        prev.map((c) => ({
          ...c,
          fields: c.fields.map((f) => f.id === fieldId ? { ...f, name: trimmed } : f),
        }))
      );
      log(`Renamed field "${field.name}" to "${trimmed}"`);
    }
  };

  // Soft-delete field
  const handleDeleteField = async (fieldId: string) => {
    if (!user) return;
    const field = categories.flatMap((c) => c.fields).find((f) => f.id === fieldId);
    if (!field) return;
    if (!window.confirm(`Delete field "${field.name}"? It will move to Deleted Items and can be recovered.`)) return;
    const ok = await softDeleteField(fieldId, user.id);
    if (ok) {
      setCategories((prev) =>
        prev.map((c) => ({ ...c, fields: c.fields.filter((f) => f.id !== fieldId) }))
      );
      setDeletedItems((prev) => [
        { id: fieldId, name: field.name, type: 'field', deleted_at: new Date().toISOString() },
        ...prev,
      ]);
      log(`Soft-deleted field "${field.name}"`);
    }
  };

  // Soft-delete category
  const handleSoftDeleteCategory = async (categoryId: string) => {
    if (!user) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;
    if (!window.confirm(`Delete category "${cat.name}"? It will move to Deleted Items and can be recovered.`)) return;
    const ok = await softDeleteCategory(categoryId, user.id);
    if (ok) {
      setCategories((prev) => prev.filter((c) => c.id !== categoryId));
      setDeletedItems((prev) => [
        { id: categoryId, name: cat.name, type: 'category', deleted_at: new Date().toISOString() },
        ...prev,
      ]);
      log(`Soft-deleted category "${cat.name}"`);
    }
  };

  // Restore a deleted item (admin/owner only)
  const handleRestoreItem = async (item: DeletedItem) => {
    const ok = item.type === 'category'
      ? await restoreCategory(item.id)
      : await restoreField(item.id);
    if (ok) {
      setDeletedItems((prev) => prev.filter((d) => d.id !== item.id));
      // Reload full data so the restored item appears in the table
      if (selectedProjectId) loadData(selectedProjectId);
      log(`Restored ${item.type} "${item.name}"`);
    }
  };

  const handlePermanentDelete = async (item: DeletedItem) => {
    if (!window.confirm(`Permanently delete "${item.name}"? This cannot be undone.`)) return;
    const ok = item.type === 'category'
      ? await permanentDeleteCategory(item.id)
      : await permanentDeleteField(item.id);
    if (ok) {
      setDeletedItems((prev) => prev.filter((d) => d.id !== item.id));
      log(`Permanently deleted ${item.type} "${item.name}"`);
    }
  };

  const handleEmptyTrash = async () => {
    if (!window.confirm(`Permanently delete all ${deletedItems.length} items? This cannot be undone.`)) return;
    for (const item of deletedItems) {
      if (item.type === 'category') await permanentDeleteCategory(item.id);
      else await permanentDeleteField(item.id);
    }
    setDeletedItems([]);
    log(`Emptied trash (${deletedItems.length} items permanently deleted)`);
  };

  // Request recovery (non-owner users)
  const handleRequestRecovery = async (item: DeletedItem) => {
    if (!user || !selectedProjectId) return;
    const ok = await createRecoveryRequest(
      selectedProjectId,
      user.id,
      displayNameRef.current || user.email || 'Unknown',
      item.type,
      item.id,
      item.name
    );
    if (ok) alert(`Recovery request for "${item.name}" sent to admin.`);
  };

  // Save cell edit
  const saveCell = async (rowId: string, fieldId: string, value: string) => {
    if (!user || !selectedProjectId) return;

    const key = `${rowId}-${fieldId}`;
    const existing = valueMap.get(key);
    if (existing?.value === value) {
      setEditingCell(null);
      return;
    }

    const oldValue = existing?.value ?? null;
    const ok = await upsertValue(rowId, fieldId, value || null);
    if (ok) {
      // Push to undo stack
      undoStack.current.push({ changes: [{ rowId, fieldId, oldValue }] });

      setValueMap((prev) => {
        const next = new Map(prev);
        next.set(key, {
          id: existing?.id ?? '',
          row_id: rowId,
          field_id: fieldId,
          value: value || null,
          file_url: existing?.file_url ?? null,
          created_at: existing?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return next;
      });

      // Row now has data, remove from new rows tracking
      setNewRowIds((prev) => {
        if (!prev.has(rowId)) return prev;
        const next = new Set(prev);
        next.delete(rowId);
        return next;
      });

      const field = categories.flatMap((c) => c.fields).find((f) => f.id === fieldId);
      log(`Updated "${field?.name ?? 'field'}" value`);
    }
    setEditingCell(null);
  };

  // Paste handler — paste CSV/Excel data starting from a clicked cell
  const handleTablePaste = async (e: React.ClipboardEvent<HTMLTableElement>) => {
    if (!canEdit || !selectedProjectId || !user) return;

    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;

    // Parse pasted text: rows split by newlines, columns by tabs (Excel) or commas (CSV)
    const pastedRows = text.trim().split(/\r?\n/).map((line) => {
      // Excel uses tabs; fall back to comma if no tabs found
      if (line.includes('\t')) return line.split('\t');
      return line.split(',');
    });
    if (pastedRows.length === 0) return;

    // Find which cell is active (editing or focused)
    const activeEl = document.activeElement;
    const td = activeEl?.closest?.('td');
    if (!td) return;

    const fieldId = td.getAttribute('data-field-id');
    const rowId = td.getAttribute('data-row-id');
    if (!fieldId || !rowId) return;

    e.preventDefault();

    // Find the starting position in visible (non-auto-id) fields and nonEmptyRows
    const pasteableFields = visibleFields.filter((f) => !f.is_auto_id);
    const startFieldIdx = pasteableFields.findIndex((f) => f.id === fieldId);
    const startRowIdx = nonEmptyRows.findIndex((r) => r.id === rowId);
    if (startFieldIdx === -1 || startRowIdx === -1) return;

    // Expand rows if paste extends beyond existing rows
    let currentRows = [...nonEmptyRows];
    const createdRowIds: string[] = [];
    const neededExtraRows = (startRowIdx + pastedRows.length) - currentRows.length;
    if (neededExtraRows > 0) {
      const newRows: UnitDataRow[] = [];
      for (let i = 0; i < neededExtraRows; i++) {
        const row = await createRow(selectedProjectId, rows.length + i);
        if (row) {
          newRows.push(row);
          createdRowIds.push(row.id);
        }
      }
      if (newRows.length > 0) {
        setRows((prev) => [...prev, ...newRows]);
        currentRows = [...currentRows, ...newRows];
      }
    }

    // Collect old values for undo, then upsert
    const updates: { rowId: string; fieldId: string; value: string }[] = [];
    const undoChanges: { rowId: string; fieldId: string; oldValue: string | null }[] = [];
    for (let r = 0; r < pastedRows.length; r++) {
      const targetRow = currentRows[startRowIdx + r];
      if (!targetRow) break;
      for (let c = 0; c < pastedRows[r].length; c++) {
        const targetField = pasteableFields[startFieldIdx + c];
        if (!targetField) break;
        const val = pastedRows[r][c].trim();
        const key = `${targetRow.id}-${targetField.id}`;
        const oldValue = valueMap.get(key)?.value ?? null;
        undoChanges.push({ rowId: targetRow.id, fieldId: targetField.id, oldValue });
        updates.push({ rowId: targetRow.id, fieldId: targetField.id, value: val });
      }
    }

    // Batch upsert all values
    const promises = updates.map((u) => upsertValue(u.rowId, u.fieldId, u.value || null));
    await Promise.all(promises);

    // Push to undo stack
    undoStack.current.push({ changes: undoChanges, createdRowIds });

    // Update local valueMap
    setValueMap((prev) => {
      const next = new Map(prev);
      for (const u of updates) {
        const key = `${u.rowId}-${u.fieldId}`;
        const existing = prev.get(key);
        next.set(key, {
          id: existing?.id ?? '',
          row_id: u.rowId,
          field_id: u.fieldId,
          value: u.value || null,
          file_url: existing?.file_url ?? null,
          created_at: existing?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return next;
    });

    setEditingCell(null);
    log(`Pasted data into ${updates.length} cell(s). Press Ctrl+Z to undo.`);
  };

  // ── Undo handler (Ctrl+Z) ──────────────────────────────────────
  const handleUndo = useCallback(async () => {
    const entry = undoStack.current.pop();
    if (!entry) return;

    // Delete any rows that were created during a paste
    if (entry.createdRowIds?.length) {
      for (const rowId of entry.createdRowIds) {
        await deleteRow(rowId);
      }
      setRows((prev) => prev.filter((r) => !entry.createdRowIds!.includes(r.id)));
    }

    // Revert changed cells (skip cells on deleted rows)
    const deletedRowSet = new Set(entry.createdRowIds ?? []);
    for (const change of entry.changes) {
      if (deletedRowSet.has(change.rowId)) continue;
      if (change.oldValue === null) {
        // Row existed but had no value — delete the value row instead of upserting null
        await supabase.from('zhl_unit_data_values').delete().eq('row_id', change.rowId).eq('field_id', change.fieldId);
      } else {
        await upsertValue(change.rowId, change.fieldId, change.oldValue);
      }
    }

    setValueMap((prev) => {
      const next = new Map(prev);
      for (const change of entry.changes) {
        const key = `${change.rowId}-${change.fieldId}`;
        const existing = prev.get(key);
        if (existing) {
          next.set(key, { ...existing, value: change.oldValue, updated_at: new Date().toISOString() });
        } else if (change.oldValue !== null) {
          next.set(key, {
            id: '',
            row_id: change.rowId,
            field_id: change.fieldId,
            value: change.oldValue,
            file_url: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        } else {
          next.delete(key);
        }
      }
      return next;
    });
  }, []);

  // Listen for Ctrl+Z globally
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        handleUndo();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleUndo]);

  // ── Cell selection helpers ──────────────────────────────────────
  const getCellsInRange = (anchor: { rowId: string; fieldId: string }, end: { rowId: string; fieldId: string }): Set<string> => {
    const pasteableFields = visibleFields.filter((f) => !f.is_auto_id);
    const r1 = nonEmptyRows.findIndex((r) => r.id === anchor.rowId);
    const r2 = nonEmptyRows.findIndex((r) => r.id === end.rowId);
    const c1 = pasteableFields.findIndex((f) => f.id === anchor.fieldId);
    const c2 = pasteableFields.findIndex((f) => f.id === end.fieldId);
    if (r1 === -1 || r2 === -1 || c1 === -1 || c2 === -1) return new Set();
    const rMin = Math.min(r1, r2), rMax = Math.max(r1, r2);
    const cMin = Math.min(c1, c2), cMax = Math.max(c1, c2);
    const cells = new Set<string>();
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        cells.add(`${nonEmptyRows[r].id}-${pasteableFields[c].id}`);
      }
    }
    return cells;
  };

  const handleCellMouseDown = (rowId: string, fieldId: string, e: React.MouseEvent) => {
    if (!canEdit) return;
    // Don't interfere with editing or right-click
    if (editingCell) return;
    if (e.button !== 0) return;

    if (e.shiftKey && selAnchor) {
      // Shift-click: select range from anchor to this cell
      const range = getCellsInRange(selAnchor, { rowId, fieldId });
      setSelectedCells(range);
      e.preventDefault();
    } else {
      // Start new selection
      setSelAnchor({ rowId, fieldId });
      setSelectedCells(new Set([`${rowId}-${fieldId}`]));
      setTableSelecting(true);
    }
  };

  const handleCellMouseEnter = (rowId: string, fieldId: string) => {
    if (!tableSelecting || !selAnchor) return;
    const range = getCellsInRange(selAnchor, { rowId, fieldId });
    setSelectedCells(range);
  };

  useEffect(() => {
    if (!tableSelecting) return;
    const onMouseUp = () => setTableSelecting(false);
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [tableSelecting]);

  // Delete/Backspace clears selected cells
  useEffect(() => {
    if (selectedCells.size === 0 || !canEdit) return;
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't clear if user is editing an input
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();

        const cellKeys = Array.from(selectedCells);
        const promises = cellKeys.map((key) => {
          // Keys are "rowId-fieldId" but UUIDs contain dashes, so split at the 36th char
          const rowId = key.slice(0, 36);
          const fieldId = key.slice(37);
          return upsertValue(rowId, fieldId, null, null);
        });
        await Promise.all(promises);

        // Update local valueMap
        const updatedValueMap = new Map(valueMap);
        for (const key of cellKeys) {
          updatedValueMap.delete(key);
        }
        setValueMap(updatedValueMap);

        // Find and delete rows that are now completely empty
        const affectedRowIds = new Set(cellKeys.map((k) => k.slice(0, 36)));
        const allFields = categories.flatMap((c) => c.fields);
        const emptyRowIds: string[] = [];
        for (const rowId of affectedRowIds) {
          const hasData = allFields.some((f) => {
            const val = updatedValueMap.get(`${rowId}-${f.id}`);
            return val?.value != null && val.value.trim() !== '';
          });
          if (!hasData) emptyRowIds.push(rowId);
        }
        if (emptyRowIds.length > 0) {
          await Promise.all(emptyRowIds.map((id) => deleteRow(id)));
          setRows((prev) => prev.filter((r) => !emptyRowIds.includes(r.id)));
        }

        log(`Cleared ${cellKeys.length} cell(s)`);
        setSelectedCells(new Set());
      } else if (e.key === 'Escape') {
        setSelectedCells(new Set());
        setSelAnchor(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCells, canEdit]);

  // Clear selection when clicking outside the table
  useEffect(() => {
    if (selectedCells.size === 0) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('table') && !target.closest('[data-cell-actions]')) {
        setSelectedCells(new Set());
        setSelAnchor(null);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [selectedCells]);

  // Add category
  const handleAddCategory = async (name: string, fieldNames: string[]) => {
    if (!selectedProjectId || !user || !name.trim()) return;
    const cat = await createCategory(selectedProjectId, name.trim(), categories.length);
    if (cat) {
      const trimmedFields = fieldNames.map((f) => f.trim()).filter(Boolean);
      const createdFields: UnitDataField[] = [];
      for (let i = 0; i < trimmedFields.length; i++) {
        const field = await createField(cat.id, selectedProjectId, trimmedFields[i], 'text', null, false, false, i);
        if (field) createdFields.push(field);
      }
      setCategories((prev) => [...prev, { ...cat, fields: createdFields }]);
      log(`Added category "${name.trim()}" with ${createdFields.length} field(s)`);
      setShowAddCategory(false);
    }
  };

  const handleAddField = async (categoryId: string, name: string, tooltip: string) => {
    if (!selectedProjectId || !user || !name.trim() || !categoryId) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;

    const field = await createField(
      categoryId,
      selectedProjectId,
      name.trim(),
      'text',
      tooltip.trim() || null,
      false,
      false,
      cat.fields.length
    );

    if (field) {
      setCategories((prev) =>
        prev.map((c) =>
          c.id === categoryId ? { ...c, fields: [...c.fields, field] } : c
        )
      );
      log(`Added field "${name.trim()}" to "${cat.name}"`);
      setShowAddField(false);
    }
  };

  // Quick Excel upload — row 1 = headers, row 2+ = data (clean files)
  const handleQuickExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProjectId || !user) return;

    setUploading(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const fileName = file.name.replace(/\.(xlsx?|csv)$/i, '');

      // Clean up orphaned empty rows before processing
      await cleanupAndResortRows(selectedProjectId);

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
        if (jsonData.length === 0) continue;

        const catName = workbook.SheetNames.length === 1 ? fileName : `${fileName} - ${sheetName}`;
        const cat = await createCategory(selectedProjectId, catName, categories.length);
        if (!cat) continue;

        // Track original column indices for non-empty headers
        const rawHeaders = (jsonData[0] as unknown[]).map((h) => {
          if (h instanceof Date) return h.toISOString().split('T')[0];
          return String(h ?? '').trim();
        });
        const headerEntries: { colIdx: number; name: string }[] = [];
        for (let i = 0; i < rawHeaders.length; i++) {
          if (rawHeaders[i]) headerEntries.push({ colIdx: i, name: rawHeaders[i] });
        }

        const fields: UnitDataField[] = [];
        for (let fi = 0; fi < headerEntries.length; fi++) {
          const field = await createField(cat.id, selectedProjectId, headerEntries[fi].name, 'text', null, false, false, fi);
          if (field) fields.push(field);
        }

        // Get existing rows (sorted by sort_order — oldest rows first after cleanup)
        const existingRows = await getRows(selectedProjectId);

        let rowCount = 0;
        for (let ri = 1; ri < jsonData.length; ri++) {
          const rowData = jsonData[ri] as unknown[];
          if (!rowData || rowData.every((cell) => cell === null || cell === undefined || String(cell).trim() === '')) continue;

          // Reuse existing rows so old + new data share the same row
          // Only create new rows for overflow (when uploaded data has more rows than existing)
          let targetRow: UnitDataRow;
          if (rowCount < existingRows.length) {
            targetRow = existingRows[rowCount];
          } else {
            const newRow = await createRow(selectedProjectId, rowCount);
            if (!newRow) { rowCount++; continue; }
            targetRow = newRow;
          }
          rowCount++;

          for (let fi = 0; fi < fields.length; fi++) {
            const colIdx = headerEntries[fi]?.colIdx;
            if (colIdx === undefined) continue;
            const rawVal = rowData[colIdx];
            let cellVal = '';
            if (rawVal instanceof Date) {
              cellVal = isNaN(rawVal.getTime()) ? '' : rawVal.toISOString().split('T')[0];
            } else {
              cellVal = rawVal !== null && rawVal !== undefined ? String(rawVal).trim() : '';
            }
            if (cellVal) await upsertValue(targetRow.id, fields[fi].id, cellVal);
          }
        }

        log(`Imported Excel "${file.name}" as category "${catName}" (${fields.length} fields, ${rowCount} rows)`);
      }
      // Re-sort so old rows (with data in more categories) appear first
      await cleanupAndResortRows(selectedProjectId);
      // Reload all data from DB to ensure UI is fully up to date
      await loadData(selectedProjectId);
    } catch (err) {
      console.error('Error processing Excel file:', err);
      alert('Failed to process the Excel file. Please check the format and try again.');
    } finally {
      setUploading(false);
      if (quickFileInputRef.current) quickFileInputRef.current.value = '';
    }
  };

  // Excel upload with preview — opens modal for row/column configuration
  const handleExcelUploadPreview = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProjectId || !user) return;

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

    setUdPreviewRows(cleaned);
    setUdPreviewFile(file);
    setUdPreviewWorkbook(workbook);

    // Auto-detect header row: find first row where most cells are non-empty strings (not numbers)
    let detectedHeader = 1;
    for (let r = 0; r < Math.min(cleaned.length, 20); r++) {
      const row = cleaned[r];
      const stringCells = row.filter((c) => {
        const s = String(c ?? '').trim();
        return s && isNaN(Number(s.replace(/[$,]/g, '')));
      });
      if (stringCells.length >= 2) { detectedHeader = r + 1; break; }
    }

    // Data starts right after the header row
    let detectedDataStart = detectedHeader + 1;
    for (let r = detectedHeader; r < cleaned.length; r++) {
      const row = cleaned[r];
      if (row.some((c) => c !== '' && c != null)) { detectedDataStart = r + 1; break; }
    }

    const maxCols = Math.max(...cleaned.map((r) => r.length), 0);
    const skipMap: Record<number, boolean> = {};
    for (let c = 0; c < maxCols; c++) skipMap[c] = false;

    setUdPreviewInitialConfig({
      headerRow: detectedHeader,
      dataStartRow: detectedDataStart,
      dataEndRow: cleaned.length,
      startCol: 0,
      endCol: maxCols - 1,
      columnSkip: skipMap,
    });
    setUdPreviewOpen(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Process excel with user's preview configuration
  const processUdExcelWithMapping = async (config: UploadPreviewConfig) => {
    if (!udPreviewFile || !selectedProjectId || !user || !udPreviewWorkbook) return;
    setUdPreviewOpen(false);
    setUploading(true);

    try {
      const fileName = udPreviewFile.name.replace(/\.(xlsx?|csv)$/i, '');
      const catName = fileName;

      const cat = await createCategory(selectedProjectId, catName, categories.length);
      if (!cat) return;

      // Get headers from the designated header row
      const headerRowIdx = config.headerRow - 1;
      const headerRowData = udPreviewRows[headerRowIdx] ?? [];
      const dataStartIdx = config.dataStartRow - 1;
      const dataEndIdx = (config.dataEndRow || udPreviewRows.length) - 1;

      // Build included columns (within column range and not skipped)
      const includedCols: { colIdx: number; name: string }[] = [];
      for (let c = config.startCol; c <= config.endCol && c < headerRowData.length; c++) {
        if (config.columnSkip[c]) continue;
        const name = String(headerRowData[c] ?? '').trim() || `Column ${c + 1}`;
        includedCols.push({ colIdx: c, name });
      }

      // Create fields
      const fields: UnitDataField[] = [];
      for (let fi = 0; fi < includedCols.length; fi++) {
        const field = await createField(cat.id, selectedProjectId, includedCols[fi].name, 'text', null, false, false, fi);
        if (field) fields.push(field);
      }

      // Clean up orphaned empty rows, then get clean row list
      await cleanupAndResortRows(selectedProjectId);
      const existingRows = await getRows(selectedProjectId);

      let rowCount = 0;
      for (let r = dataStartIdx; r <= dataEndIdx && r < udPreviewRows.length; r++) {
        const rowData = udPreviewRows[r];
        if (!rowData || rowData.every((cell) => cell === '' || cell == null)) continue;

        let targetRow: UnitDataRow;
        if (rowCount < existingRows.length) {
          targetRow = existingRows[rowCount];
        } else {
          const newRow = await createRow(selectedProjectId, rowCount);
          if (!newRow) { rowCount++; continue; }
          targetRow = newRow;
        }
        rowCount++;

        for (let fi = 0; fi < fields.length; fi++) {
          const colIdx = includedCols[fi]?.colIdx;
          if (colIdx === undefined) continue;
          const rawVal = rowData[colIdx];
          const cellVal = rawVal !== null && rawVal !== undefined ? String(rawVal).trim() : '';
          if (cellVal) await upsertValue(targetRow.id, fields[fi].id, cellVal);
        }
      }

      log(`Imported Excel "${udPreviewFile.name}" as category "${catName}" (${fields.length} fields, ${rowCount} rows)`);
      await cleanupAndResortRows(selectedProjectId);
      await loadData(selectedProjectId);
    } catch (err) {
      console.error('Error processing Excel file:', err);
      alert('Failed to process the Excel file. Please check the format and try again.');
    } finally {
      setUploading(false);
      setUdPreviewFile(null);
      setUdPreviewWorkbook(null);
      setUdPreviewRows([]);
    }
  };

  // Import to Category — open file and show range/mapping modal
  const handleImportToCategory = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProjectId || !user) return;

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

    const maxCols = Math.max(...cleaned.map((r) => r.length), 0);
    setImportRows(cleaned);
    setImportFile(file);
    setImportOpen(true);
    if (importFileInputRef.current) importFileInputRef.current.value = '';
  };

  // Process the import: insert data from selected range into existing category fields
  const processImportToCategory = async (config: ImportConfig) => {
    if (!selectedProjectId || !user || !config.targetCat || importRows.length === 0) return;
    const cat = categories.find((c) => c.id === config.targetCat);
    if (!cat) return;

    const mappedEntries = Object.entries(config.colMapping).filter(([, fieldId]) => fieldId !== '');
    const hasNewFields = mappedEntries.some(([, v]) => v === '__new__');
    const newFieldsValid = !hasNewFields || mappedEntries
      .filter(([, v]) => v === '__new__')
      .every(([colIdx]) => (config.newFieldNames[parseInt(colIdx)] ?? '').trim() !== '');
    if (mappedEntries.length === 0) { alert('Please map at least one column to a field.'); return; }
    if (!newFieldsValid) { alert('Please enter a name for all new fields.'); return; }

    setImportOpen(false);
    setUploading(true);

    try {
      const resolvedMappings: [number, string][] = [];
      const existingFieldCount = cat.fields.length;
      let newFieldIdx = 0;
      for (const [colIdxStr, fieldId] of mappedEntries) {
        const colIdx = parseInt(colIdxStr);
        if (fieldId === '__new__') {
          const newName = (config.newFieldNames[colIdx] ?? '').trim() || `Column ${colIdx + 1}`;
          const newField = await createField(cat.id, selectedProjectId, newName, 'text', null, false, false, existingFieldCount + newFieldIdx);
          newFieldIdx++;
          if (newField) resolvedMappings.push([colIdx, newField.id]);
        } else {
          resolvedMappings.push([colIdx, fieldId]);
        }
      }

      await cleanupAndResortRows(selectedProjectId);
      const existingRows = await getRows(selectedProjectId);

      const dataStartIdx = config.dataStartRow - 1;
      const dataEndIdx = (config.dataEndRow || importRows.length) - 1;

      let rowCount = 0;
      for (let r = dataStartIdx; r <= dataEndIdx && r < importRows.length; r++) {
        const rowData = importRows[r];
        if (!rowData || rowData.every((cell) => cell === '' || cell == null)) continue;

        let targetRow: UnitDataRow;
        if (rowCount < existingRows.length) {
          targetRow = existingRows[rowCount];
        } else {
          const newRow = await createRow(selectedProjectId, rowCount);
          if (!newRow) { rowCount++; continue; }
          targetRow = newRow;
        }
        rowCount++;

        for (const [colIdx, fieldId] of resolvedMappings) {
          const rawVal = rowData[colIdx];
          let cellVal = '';
          if (rawVal instanceof Date) {
            cellVal = isNaN(rawVal.getTime()) ? '' : rawVal.toISOString().split('T')[0];
          } else {
            cellVal = rawVal !== null && rawVal !== undefined ? String(rawVal).trim() : '';
          }
          if (cellVal) await upsertValue(targetRow.id, fieldId, cellVal);
        }
      }

      log(`Imported ${rowCount} rows into category "${cat.name}" (${resolvedMappings.length} fields mapped)`);
      await cleanupAndResortRows(selectedProjectId);
      await loadData(selectedProjectId);
    } catch (err) {
      console.error('Error importing to category:', err);
      alert('Failed to import data. Please check the format and try again.');
    } finally {
      setUploading(false);
      setImportFile(null);
      setImportRows([]);
    }
  };

  const inputClass = 'w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  // Category colors for sidebar decoration
  const categoryColors = ['border-yellow-500', 'border-blue-500', 'border-green-500', 'border-purple-500', 'border-orange-500', 'border-pink-500'];

  return {
    // Auth
    user,

    // Permission
    canEdit,

    // Data state
    categories,
    setCategories,
    rows,
    valueMap,
    setValueMap,
    loading,

    // View system
    isOwner,
    assignedView,
    selectedView,
    viewConfigs,
    hasUnsavedChanges,
    viewNotice,
    allowUserCustomization,
    newRowIds,

    // Deleted items
    deletedItems,
    showDeleted,
    setShowDeleted,

    // Inline rename state
    editingCategoryId,
    setEditingCategoryId,
    editingCategoryName,
    setEditingCategoryName,
    editingFieldId,
    setEditingFieldId,
    editingFieldName,
    setEditingFieldName,

    // UI state
    sidebarOpen,
    setSidebarOpen,
    collapsedCategories,

    // Column resizing
    getColWidth,
    handleResizeMouseDown,

    // Inline editing
    editingCell,
    setEditingCell,
    editValue,
    setEditValue,

    // Add category/field modals
    showAddCategory,
    setShowAddCategory,
    showAddField,
    setShowAddField,

    // Field order / DnD
    fieldOrder,
    dndSensors,

    // Excel upload
    fileInputRef,
    quickFileInputRef,
    uploading,

    // Excel preview modal state
    udPreviewOpen,
    setUdPreviewOpen,
    udPreviewRows,
    setUdPreviewRows,
    udPreviewFile,
    setUdPreviewFile,
    udPreviewWorkbook,
    setUdPreviewWorkbook,
    udPreviewInitialConfig,

    // Import to Category modal state
    importFileInputRef,
    importOpen,
    setImportOpen,
    importRows,
    setImportRows,
    importFile,
    setImportFile,

    // File preview
    filePreview,
    setFilePreview,
    filePreviewLoading,

    // Cell selection
    selectedCells,
    setSelectedCells,
    selAnchor,
    setSelAnchor,

    // Derived data
    visibleFields,
    nonEmptyRows,
    totalTableWidth,
    canToggleFields,
    canReorderFields,
    inputClass,
    categoryColors,

    // Handlers
    loadData,
    applyViewConfig,
    getOrderedFields,
    handleViewChange,
    handleSaveView,
    toggleCategory,
    toggleField,
    toggleCategoryCollapse,
    handleAddRow,
    handleDeleteRow,
    handleRenameCategory,
    handleRenameField,
    handleDeleteField,
    handleSoftDeleteCategory,
    handleRestoreItem,
    handlePermanentDelete,
    handleEmptyTrash,
    handleRequestRecovery,
    saveCell,
    handleTablePaste,
    handleUndo,
    getCellsInRange,
    handleCellMouseDown,
    handleCellMouseEnter,
    handleAddCategory,
    handleAddField,
    handleQuickExcelUpload,
    handleExcelUploadPreview,
    processUdExcelWithMapping,
    handleImportToCategory,
    processImportToCategory,
    closeFilePreview,
    getRowLabel,
    handleFieldReorder,

    // DB functions exposed for inline JSX handlers
    updateField,
    upsertValue,
  };
}
