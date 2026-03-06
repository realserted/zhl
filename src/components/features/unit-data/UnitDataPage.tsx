'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader2, Trash2, X, Link, Upload, Download, FileSpreadsheet, Pencil, FileText, ExternalLink, GripVertical } from 'lucide-react';
import { DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { CategoryWithFields, UnitDataField, UnitDataRow, UnitDataValue, ViewName } from '@/lib/types/unit-data';
import { safeHref } from '@/lib/security';
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
import { downloadFileUrl } from '@/lib/db/files';
import { getView, getProjectViews, saveView, saveFieldOrder } from '@/lib/db/unit-data-views';
import { getProjectSettings } from '@/lib/db/project-settings';
import { logUserAction } from '@/lib/db/user-logs';
import { ProjectPermission } from '@/lib/types/project';
import * as XLSX from 'xlsx';

interface UnitDataPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null; // null = owner (full access)
  isAdmin?: boolean;
}

type ViewMode = ViewName;

/** Sortable wrapper for a sidebar field item */
function SortableFieldItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1 group/field">
      <button
        {...attributes}
        {...listeners}
        className="p-0.5 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
        title="Drag to reorder"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      {children}
    </div>
  );
}

export default function UnitDataPage({ selectedProjectId, userPermission, isAdmin }: UnitDataPageProps) {
  const { user } = useAuth();

  // Permission flags — null userPermission means owner (full access); admin also gets full access
  const permLevel = isAdmin ? 'Admin' : (userPermission?.perm_unit_data ?? 'Admin');
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission || !!isAdmin;

  // Data state
  const [categories, setCategories] = useState<CategoryWithFields[]>([]);
  const [rows, setRows] = useState<UnitDataRow[]>([]);
  const [valueMap, setValueMap] = useState<Map<string, UnitDataValue>>(new Map());
  const [loading, setLoading] = useState(true);

  // User info for logging — use refs so async callbacks always get latest
  const displayNameRef = useRef('');
  const userEmailRef = useRef('');

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
  const [columnWidths, setColumnWidths] = useState<Map<string, number>>(new Map());
  const resizingRef = useRef<{ fieldId: string; startX: number; startWidth: number } | null>(null);

  const handleResizeMouseDown = (e: React.MouseEvent, fieldId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnWidths.get(fieldId) ?? 120;
    resizingRef.current = { fieldId, startX, startWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(60, startWidth + delta);
      setColumnWidths((prev) => new Map(prev).set(fieldId, newWidth));
    };

    const onMouseUp = () => {
      resizingRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  // Inline editing
  const [editingCell, setEditingCell] = useState<{ rowId: string; fieldId: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  // Add category modal
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryFields, setNewCategoryFields] = useState<string[]>(['']);

  // Add field modal
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldCategory, setNewFieldCategory] = useState('');
  const [newFieldTooltip, setNewFieldTooltip] = useState('');

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
  const [udHeaderRow, setUdHeaderRow] = useState(1); // 1-indexed: which row contains column names
  const [udDataStartRow, setUdDataStartRow] = useState(2); // 1-indexed: where data begins
  const [udDataEndRow, setUdDataEndRow] = useState(0); // 1-indexed: where data ends (0 = last row)
  const [udStartCol, setUdStartCol] = useState(0); // 0-indexed: first column to include
  const [udEndCol, setUdEndCol] = useState(0); // 0-indexed: last column to include (0 = auto from data)
  const [udColumnSkip, setUdColumnSkip] = useState<Record<number, boolean>>({}); // colIdx → skip
  const [udPreviewPage, setUdPreviewPage] = useState(0);
  const UD_PREVIEW_PAGE_SIZE = 20;
  // Cell range selection via click-drag on preview
  const [udSelecting, setUdSelecting] = useState(false);
  const [udSelStart, setUdSelStart] = useState<{ r: number; c: number } | null>(null);
  const [udSelEnd, setUdSelEnd] = useState<{ r: number; c: number } | null>(null);

  // Import to Category modal state
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<unknown[][]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPage, setImportPage] = useState(0);
  const [importTargetCat, setImportTargetCat] = useState<string>(''); // category id
  const [importDataStartRow, setImportDataStartRow] = useState(1); // 1-indexed
  const [importDataEndRow, setImportDataEndRow] = useState(0); // 1-indexed (0 = last)
  const [importStartCol, setImportStartCol] = useState(0); // 0-indexed
  const [importEndCol, setImportEndCol] = useState(0); // 0-indexed
  const [importColMapping, setImportColMapping] = useState<Record<number, string>>({}); // colIdx → fieldId or '__new__'
  const [importNewFieldNames, setImportNewFieldNames] = useState<Record<number, string>>({}); // colIdx → new field name
  const [importSelecting, setImportSelecting] = useState(false);
  const [importSelStart, setImportSelStart] = useState<{ r: number; c: number } | null>(null);
  const [importSelEnd, setImportSelEnd] = useState<{ r: number; c: number } | null>(null);

  // Load user info
  useEffect(() => {
    if (!user) return;
    supabase
      .from('zhl_accounts')
      .select('display_name, email')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        displayNameRef.current = data?.display_name || user.email || 'Unknown';
        userEmailRef.current = data?.email || user.email || '';
      });
  }, [user]);

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

  // Helper to get current user info from refs (avoids stale closures)
  const log = (action: string) => {
    if (!user || !selectedProjectId) return;
    logUserAction({
      projectId: selectedProjectId,
      userId: user.id,
      userName: displayNameRef.current,
      userEmail: userEmailRef.current,
      action,
    });
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
    return sum + catVisibleFields.reduce((s, f) => s + (columnWidths.get(f.id) ?? 120), 0);
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

    const ok = await upsertValue(rowId, fieldId, value || null);
    if (ok) {
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
    const neededExtraRows = (startRowIdx + pastedRows.length) - currentRows.length;
    if (neededExtraRows > 0) {
      const newRows: UnitDataRow[] = [];
      for (let i = 0; i < neededExtraRows; i++) {
        const row = await createRow(selectedProjectId, rows.length + i);
        if (row) newRows.push(row);
      }
      if (newRows.length > 0) {
        setRows((prev) => [...prev, ...newRows]);
        currentRows = [...currentRows, ...newRows];
      }
    }

    // Upsert values for each pasted cell
    const updates: { rowId: string; fieldId: string; value: string }[] = [];
    for (let r = 0; r < pastedRows.length; r++) {
      const targetRow = currentRows[startRowIdx + r];
      if (!targetRow) break;
      for (let c = 0; c < pastedRows[r].length; c++) {
        const targetField = pasteableFields[startFieldIdx + c];
        if (!targetField) break;
        const val = pastedRows[r][c].trim();
        updates.push({ rowId: targetRow.id, fieldId: targetField.id, value: val });
      }
    }

    // Batch upsert all values
    const promises = updates.map((u) => upsertValue(u.rowId, u.fieldId, u.value || null));
    await Promise.all(promises);

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
    log(`Pasted data into ${updates.length} cell(s)`);
  };

  // Add category
  const handleAddCategory = async () => {
    if (!selectedProjectId || !user || !newCategoryName.trim()) return;
    const cat = await createCategory(selectedProjectId, newCategoryName.trim(), categories.length);
    if (cat) {
      const fieldNames = newCategoryFields.map((f) => f.trim()).filter(Boolean);
      const createdFields: UnitDataField[] = [];
      for (let i = 0; i < fieldNames.length; i++) {
        const field = await createField(cat.id, selectedProjectId, fieldNames[i], 'text', null, false, false, i);
        if (field) createdFields.push(field);
      }
      setCategories((prev) => [...prev, { ...cat, fields: createdFields }]);
      log(`Added category "${newCategoryName.trim()}" with ${createdFields.length} field(s)`);
      setNewCategoryName('');
      setNewCategoryFields(['']);
      setShowAddCategory(false);
    }
  };

  // Add field
  const handleAddField = async () => {
    if (!selectedProjectId || !user || !newFieldName.trim() || !newFieldCategory) return;
    const cat = categories.find((c) => c.id === newFieldCategory);
    if (!cat) return;

    const field = await createField(
      newFieldCategory,
      selectedProjectId,
      newFieldName.trim(),
      'text',
      newFieldTooltip.trim() || null,
      false,
      false,
      cat.fields.length
    );

    if (field) {
      setCategories((prev) =>
        prev.map((c) =>
          c.id === newFieldCategory ? { ...c, fields: [...c.fields, field] } : c
        )
      );
      log(`Added field "${newFieldName.trim()}" to "${cat.name}"`);
      setNewFieldName('');
      setNewFieldTooltip('');
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
    setUdPreviewPage(0);

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
    setUdHeaderRow(detectedHeader);

    // Data starts right after the header row
    let detectedDataStart = detectedHeader + 1;
    // But look for first row after header that has actual data
    for (let r = detectedHeader; r < cleaned.length; r++) {
      const row = cleaned[r];
      if (row.some((c) => c !== '' && c != null)) { detectedDataStart = r + 1; break; }
    }
    setUdDataStartRow(detectedDataStart);

    // Reset column skip state and range
    const maxCols = Math.max(...cleaned.map((r) => r.length), 0);
    const skipMap: Record<number, boolean> = {};
    for (let c = 0; c < maxCols; c++) skipMap[c] = false;
    setUdColumnSkip(skipMap);
    setUdStartCol(0);
    setUdEndCol(maxCols - 1);
    setUdDataEndRow(cleaned.length);
    setUdSelecting(false);
    setUdSelStart(null);
    setUdSelEnd(null);

    setUdPreviewOpen(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Process excel with user's preview configuration
  const processUdExcelWithMapping = async () => {
    if (!udPreviewFile || !selectedProjectId || !user || !udPreviewWorkbook) return;
    setUdPreviewOpen(false);
    setUploading(true);

    try {
      const fileName = udPreviewFile.name.replace(/\.(xlsx?|csv)$/i, '');
      const catName = fileName;

      const cat = await createCategory(selectedProjectId, catName, categories.length);
      if (!cat) return;

      // Get headers from the designated header row
      const headerRowIdx = udHeaderRow - 1; // 0-indexed
      const headerRowData = udPreviewRows[headerRowIdx] ?? [];
      const dataStartIdx = udDataStartRow - 1; // 0-indexed
      const dataEndIdx = (udDataEndRow || udPreviewRows.length) - 1; // 0-indexed

      // Build included columns (within column range and not skipped)
      const includedCols: { colIdx: number; name: string }[] = [];
      for (let c = udStartCol; c <= udEndCol && c < headerRowData.length; c++) {
        if (udColumnSkip[c]) continue;
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

        // Reuse existing rows so old + new data share the same row
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
      // Re-sort so old rows (with data in more categories) appear first
      await cleanupAndResortRows(selectedProjectId);
      // Reload all data from DB to ensure UI is fully up to date
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
    setImportPage(0);
    setImportDataStartRow(1);
    setImportDataEndRow(cleaned.length);
    setImportStartCol(0);
    setImportEndCol(maxCols - 1);
    setImportColMapping({}); setImportNewFieldNames({});
    setImportTargetCat('');
    setImportSelecting(false);
    setImportSelStart(null);
    setImportSelEnd(null);
    setImportOpen(true);
    if (importFileInputRef.current) importFileInputRef.current.value = '';
  };

  // Process the import: insert data from selected range into existing category fields
  const processImportToCategory = async () => {
    if (!selectedProjectId || !user || !importTargetCat || importRows.length === 0) return;
    const cat = categories.find((c) => c.id === importTargetCat);
    if (!cat) return;

    // Check at least one column is mapped (existing field or new field)
    const mappedEntries = Object.entries(importColMapping).filter(([, fieldId]) => fieldId !== '');
    const hasNewFields = mappedEntries.some(([, v]) => v === '__new__');
    const newFieldsValid = !hasNewFields || mappedEntries
      .filter(([, v]) => v === '__new__')
      .every(([colIdx]) => (importNewFieldNames[parseInt(colIdx)] ?? '').trim() !== '');
    if (mappedEntries.length === 0) { alert('Please map at least one column to a field.'); return; }
    if (!newFieldsValid) { alert('Please enter a name for all new fields.'); return; }

    setImportOpen(false);
    setUploading(true);

    try {
      // Create any new fields first
      const resolvedMappings: [number, string][] = []; // [colIdx, fieldId]
      const existingFieldCount = cat.fields.length;
      let newFieldIdx = 0;
      for (const [colIdxStr, fieldId] of mappedEntries) {
        const colIdx = parseInt(colIdxStr);
        if (fieldId === '__new__') {
          const newName = (importNewFieldNames[colIdx] ?? '').trim() || `Column ${colIdx + 1}`;
          const newField = await createField(cat.id, selectedProjectId, newName, 'text', null, false, false, existingFieldCount + newFieldIdx);
          newFieldIdx++;
          if (newField) resolvedMappings.push([colIdx, newField.id]);
        } else {
          resolvedMappings.push([colIdx, fieldId]);
        }
      }

      await cleanupAndResortRows(selectedProjectId);
      const existingRows = await getRows(selectedProjectId);

      const dataStartIdx = importDataStartRow - 1;
      const dataEndIdx = (importDataEndRow || importRows.length) - 1;

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

      <div className="flex min-h-[calc(100vh-180px)]">
        {/* ===== SIDEBAR ===== */}
        {sidebarOpen && (
          <div className="w-64 flex-shrink-0 border-r border-border p-4 overflow-y-auto">
            {/* Header */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-1 text-sm font-bold mb-4 hover:text-accent transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              DATA VIEW
            </button>

            {/* View Notice */}
            {viewNotice && (
              <div className="mb-2 px-2 py-1 bg-accent/10 border border-accent/30 rounded text-xs text-accent font-medium">
                {viewNotice}
              </div>
            )}

            {/* Load View Dropdown — owners only */}
            {isOwner ? (
              <div className="mb-2">
                <label className="text-xs text-muted-foreground block mb-1">Load View:</label>
                <select
                  value={selectedView}
                  onChange={(e) => handleViewChange(e.target.value as ViewMode)}
                  className="w-full border border-input rounded px-2 py-1 bg-background text-foreground text-xs"
                >
                  <option value="ALL FIELDS">ALL FIELDS</option>
                  <option value="All Project Users">All Project Users</option>
                  <option value="Personal View">Personal View</option>
                  <option value="PM View">PM View</option>
                </select>
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

            {/* Save View — owners can save any view, non-owners only Personal View */}
            {(isOwner || selectedView === 'Personal View') && selectedView !== 'ALL FIELDS' && (
              <button
                onClick={handleSaveView}
                disabled={!hasUnsavedChanges}
                className={`text-xs mb-4 block px-3 py-1 rounded ${
                  hasUnsavedChanges
                    ? 'bg-accent text-accent-foreground hover:opacity-90 font-semibold'
                    : 'text-muted-foreground cursor-not-allowed'
                }`}
              >
                {hasUnsavedChanges ? 'Save View *' : 'Save View'}
              </button>
            )}

            {/* Add Category / Add Custom Field / Upload Excel — hidden for View-only */}
            {canEdit && (
              <div className="space-y-2 mb-4">
                <button
                  onClick={() => setShowAddCategory(true)}
                  className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent/80"
                >
                  <Plus className="h-3 w-3" /> Add Category
                </button>
                <button
                  onClick={() => {
                    if (categories.length > 0) setNewFieldCategory(categories[0].id);
                    setShowAddField(true);
                  }}
                  className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent/80"
                >
                  <Plus className="h-3 w-3" /> Add Custom Field
                </button>
                {uploading ? (
                  <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Importing...
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => quickFileInputRef.current?.click()}
                      className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent/80"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> Quick Upload
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent/80"
                    >
                      <Upload className="h-3 w-3" /> Upload with Preview
                    </button>
                    <button
                      onClick={() => importFileInputRef.current?.click()}
                      className="flex items-center gap-1 text-xs font-semibold text-green-500 hover:text-green-400"
                    >
                      <Download className="h-3 w-3" /> Import to Category
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Category + Field Checkboxes */}
            <div className="space-y-3">
              {categories.map((cat, ci) => {
                const allVisible = cat.fields.length > 0 && cat.fields.every((f) => f.visible);
                const someVisible = cat.fields.some((f) => f.visible);
                const color = categoryColors[ci % categoryColors.length];

                return (
                  <div key={cat.id} className={`border-l-2 border-dotted ${color} pl-3`}>
                    {/* Category checkbox + rename + delete */}
                    <div className="flex items-center gap-2 mb-1 group/cat">
                      <label className={`flex items-center gap-2 flex-1 min-w-0 ${canToggleFields ? 'cursor-pointer' : 'cursor-default'}`}>
                        <input
                          type="checkbox"
                          checked={allVisible}
                          ref={(el) => { if (el) el.indeterminate = someVisible && !allVisible; }}
                          onChange={() => toggleCategory(cat.id)}
                          disabled={!canToggleFields}
                          className="rounded border-input flex-shrink-0"
                        />
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
                            className="text-xs font-semibold text-accent bg-background border border-input rounded px-1 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        ) : (
                          <span className="text-xs font-semibold text-accent truncate flex items-center gap-1">
                            {cat.name}
                            {cat.linked_file_name && (
                              <a
                                href={`/files?highlight=${encodeURIComponent(cat.linked_file_path ?? '')}`}
                                onClick={(e) => e.stopPropagation()}
                                className="flex-shrink-0"
                                title={`Linked: ${cat.linked_file_name} — Click to view in Files`}
                              >
                                <ExternalLink className="h-3 w-3 text-blue-500" />
                              </a>
                            )}
                          </span>
                        )}
                      </label>
                      {canEdit && editingCategoryId !== cat.id && (
                        <button
                          onClick={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name); }}
                          className="p-0.5 text-muted-foreground hover:text-accent transition-colors flex-shrink-0 opacity-0 group-hover/cat:opacity-100"
                          title={`Rename "${cat.name}"`}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => handleSoftDeleteCategory(cat.id)}
                          className="p-0.5 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 opacity-0 group-hover/cat:opacity-100"
                          title={`Delete "${cat.name}"`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    {/* Field checkboxes with drag-and-drop reordering */}
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
                        <div className="ml-2 space-y-0.5">
                          {getOrderedFields(cat).map((field) => (
                            <SortableFieldItem key={field.id} id={field.id}>
                              <label className={`flex items-center gap-2 flex-1 min-w-0 ${canToggleFields ? 'cursor-pointer' : 'cursor-default'}`}>
                                <input
                                  type="checkbox"
                                  checked={field.visible}
                                  onChange={() => toggleField(field.id)}
                                  disabled={!canToggleFields}
                                  className="rounded border-input flex-shrink-0"
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
                                  <span className={`text-xs flex items-center gap-1 ${field.visible ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                    {field.name}
                                    {field.is_file_link && (
                                      <span title="File link field" className="flex-shrink-0">
                                        <Upload className="h-3 w-3 text-muted-foreground" />
                                      </span>
                                    )}
                                    {field.linked_file_name && (
                                      <a
                                        href={`/files?highlight=${encodeURIComponent(field.linked_file_path ?? '')}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="flex-shrink-0"
                                        title={`Linked: ${field.linked_file_name} — Click to view in Files`}
                                      >
                                        <ExternalLink className="h-3 w-3 text-blue-500" />
                                      </a>
                                    )}
                                    {field.is_hyperlink && (
                                      <span title="Shows to indicate a linked file column" className="flex-shrink-0">
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
                                    className={`px-1 py-0.5 rounded text-[9px] font-bold flex-shrink-0 transition-colors ${
                                      field.is_auto_id
                                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                                        : 'text-muted-foreground/50 hover:text-blue-400 opacity-0 group-hover/field:opacity-100 border border-transparent'
                                    }`}
                                    title={field.is_auto_id ? 'Disable auto ID' : 'Set as auto ID column'}
                                  >
                                    ID
                                  </button>
                                  <button
                                    onClick={() => { setEditingFieldId(field.id); setEditingFieldName(field.name); }}
                                    className="p-0.5 text-muted-foreground hover:text-accent transition-colors flex-shrink-0 opacity-0 group-hover/field:opacity-100"
                                    title={`Rename "${field.name}"`}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteField(field.id)}
                                    className="p-0.5 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 opacity-0 group-hover/field:opacity-100"
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
                    <div className="ml-4 space-y-0.5">
                      {getOrderedFields(cat).map((field) => (
                        <div key={field.id} className="flex items-center gap-1 group/field">
                          <label className={`flex items-center gap-2 flex-1 min-w-0 ${canToggleFields ? 'cursor-pointer' : 'cursor-default'}`}>
                            <input
                              type="checkbox"
                              checked={field.visible}
                              onChange={() => toggleField(field.id)}
                              disabled={!canToggleFields}
                              className="rounded border-input flex-shrink-0"
                            />
                            <span className={`text-xs flex items-center gap-1 ${field.visible ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                              {field.name}
                              {field.is_file_link && (
                                <span title="File link field" className="flex-shrink-0">
                                  <Upload className="h-3 w-3 text-muted-foreground" />
                                </span>
                              )}
                              {field.linked_file_name && (
                                <a
                                  href={`/files?highlight=${encodeURIComponent(field.linked_file_path ?? '')}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex-shrink-0"
                                  title={`Linked: ${field.linked_file_name} — Click to view in Files`}
                                >
                                  <ExternalLink className="h-3 w-3 text-blue-500" />
                                </a>
                              )}
                              {field.is_hyperlink && (
                                <span title="Shows to indicate a linked file column" className="flex-shrink-0">
                                  <Link className="h-3 w-3 text-muted-foreground" />
                                </span>
                              )}
                              {field.is_auto_id && (
                                <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/40 flex-shrink-0">ID</span>
                              )}
                            </span>
                          </label>
                        </div>
                      ))}
                    </div>
                    )}
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
                          <>
                            <button
                              onClick={() => handleRestoreItem(item)}
                              className="text-[10px] text-accent hover:underline flex-shrink-0 px-1"
                              title="Restore"
                            >
                              Restore
                            </button>
                            <button
                              onClick={() => handlePermanentDelete(item)}
                              className="text-muted-foreground hover:text-red-500 flex-shrink-0"
                              title="Permanently delete"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleRequestRecovery(item)}
                            className="text-[10px] text-muted-foreground hover:text-accent flex-shrink-0 px-1"
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
            className="flex-shrink-0 w-8 border-r border-border flex items-start justify-center pt-4 hover:bg-muted transition-colors"
            title="Open DATA VIEW"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* ===== DATA TABLE ===== */}
        <div className="flex-1 overflow-x-auto p-4">
          {visibleFields.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No fields visible. Use the sidebar to enable columns.
            </div>
          ) : (
            <div className="border border-input rounded-lg overflow-x-auto">
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
                      <col key={field.id} style={{ width: columnWidths.get(field.id) ?? 120 }} />
                    ));
                  })}
                  <col style={{ width: 40 }} />
                </colgroup>
                {/* Category header row */}
                <thead>
                  {categories.some((cat) => getOrderedFields(cat).filter((f) => f.visible).length > 0) && (
                  <tr className="border-b border-input">
                    {categories.map((cat) => {
                      const catVisibleFields = getOrderedFields(cat).filter((f) => f.visible);
                      if (catVisibleFields.length === 0) return null;
                      const isCollapsed = collapsedCategories.has(cat.id);

                      if (isCollapsed) {
                        return (
                          <th
                            key={cat.id}
                            className="px-1 py-2 bg-muted/50 border-r border-input cursor-pointer hover:bg-muted/80 transition-colors"
                            onClick={() => toggleCategoryCollapse(cat.id)}
                            title={`Expand "${cat.name}"`}
                          >
                            <div className="flex flex-col items-center gap-0.5">
                              <ChevronRight className="h-3 w-3 text-accent" />
                              <span className="text-amber-500 text-xs">&#128193;</span>
                            </div>
                          </th>
                        );
                      }

                      return (
                        <th
                          key={cat.id}
                          colSpan={catVisibleFields.length}
                          className="px-3 py-2 text-left bg-muted/50 border-r border-input last:border-r-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-amber-500">&#128193;</span>
                            <span className="font-semibold text-xs text-accent">{cat.name}</span>
                            <button
                              onClick={() => toggleCategoryCollapse(cat.id)}
                              className="ml-1 text-muted-foreground hover:text-accent transition-colors"
                              title="Collapse"
                            >
                              <ChevronDown className="h-3 w-3" />
                            </button>
                          </div>
                        </th>
                      );
                    })}
                    <th className="w-8"></th>
                  </tr>
                  )}

                  {/* Field header row */}
                  <tr className="bg-muted border-b border-input">
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
                          className="relative px-3 py-2 text-left font-semibold text-xs whitespace-nowrap border-r border-input last:border-r-0 select-none overflow-hidden"
                          title={field.tooltip ?? undefined}
                        >
                          <div className="flex items-center gap-1">
                            {field.name}
                            {field.is_file_link && <Upload className="h-3 w-3 text-muted-foreground" />}
                            {field.is_hyperlink && <Link className="h-3 w-3 text-muted-foreground" />}
                          </div>
                          {/* Resize handle */}
                          <div
                            onMouseDown={(e) => handleResizeMouseDown(e, field.id)}
                            className="absolute top-0 right-0 h-full w-2 cursor-col-resize group/resize"
                          >
                            <div className="absolute right-0 top-0 h-full w-0.5 bg-transparent group-hover/resize:bg-accent/60 group-active/resize:bg-accent transition-colors" />
                          </div>
                        </th>
                      ));
                    })}
                    <th className="w-8"></th>
                  </tr>
                </thead>

                <tbody>
                  {/* ===== SUMMARY ROW (sums for fields with show_sum enabled) ===== */}
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

                          // Sum all numeric values in this column
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
                      <tr key={row.id} className="border-b border-input hover:bg-muted/30 transition-colors">
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
                                  className="px-3 py-2 border-r border-input last:border-r-0 overflow-hidden"
                                >
                                  <span className="text-xs text-blue-400 font-medium">{rowIndex + 1}</span>
                                </td>
                              );
                            }

                            return (
                              <td
                                key={field.id}
                                data-field-id={field.id}
                                data-row-id={row.id}
                                tabIndex={0}
                                className="px-3 py-2 border-r border-input last:border-r-0 overflow-hidden focus:outline-none focus:ring-1 focus:ring-ring/50"
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
                                    className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                  />
                                ) : (
                                  <span
                                    onClick={canEdit ? () => {
                                      setEditingCell({ rowId: row.id, fieldId: field.id });
                                      setEditValue(cellValue);
                                    } : undefined}
                                    className={`${canEdit ? 'cursor-pointer hover:bg-muted/50' : ''} px-1 py-0.5 rounded min-w-[3rem] min-h-[1.25rem] text-xs flex items-center gap-1`}
                                    title={canEdit ? 'Click to edit' : undefined}
                                  >
                                    {field.is_hyperlink && cellValue ? (
                                      <a
                                        href={safeHref(cellValue)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-500 hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {cellValue}
                                      </a>
                                    ) : (
                                      cellValue || <span className="text-muted-foreground/40">-</span>
                                    )}
                                    {val?.file_url && (
                                      <button
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          const url = await downloadFileUrl(val.file_url!);
                                          if (url) window.open(url, '_blank');
                                        }}
                                        className="flex-shrink-0 p-0.5 text-blue-500 hover:text-blue-400 transition-colors"
                                        title={`Linked to: ${getRowLabel(row.id)} — Click to download`}
                                      >
                                        <Link className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </span>
                                )}
                              </td>
                            );
                          });
                        })}
                        <td className="px-2 py-2">
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
          )}

          {/* Add Row Button — hidden for View-only */}
          {canEdit && (
            <button
              onClick={handleAddRow}
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-accent hover:text-accent/80 transition-colors"
            >
              <Plus className="h-3 w-3" /> Add Row
            </button>
          )}
        </div>
      </div>

      {/* ===== ADD CATEGORY MODAL ===== */}
      {showAddCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Add Category</h2>
              <button onClick={() => { setShowAddCategory(false); setNewCategoryName(''); setNewCategoryFields(['']); }} className="p-1 hover:bg-muted rounded">
                <X className="h-5 w-5" />
              </button>
            </div>
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className={inputClass}
              placeholder="Category name"
            />

            {/* Fields */}
            <div className="mt-4">
              <label className="text-sm font-semibold text-muted-foreground mb-2 block">Fields</label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {newCategoryFields.map((fieldName, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={fieldName}
                      onChange={(e) => {
                        const updated = [...newCategoryFields];
                        updated[idx] = e.target.value;
                        setNewCategoryFields(updated);
                      }}
                      className={inputClass}
                      placeholder={`Field ${idx + 1}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (idx === newCategoryFields.length - 1 && fieldName.trim()) {
                            setNewCategoryFields((prev) => [...prev, '']);
                          }
                        }
                      }}
                    />
                    {newCategoryFields.length > 1 && (
                      <button
                        onClick={() => setNewCategoryFields((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setNewCategoryFields((prev) => [...prev, ''])}
                className="mt-2 text-xs text-accent hover:underline flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> Add field
              </button>
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleAddCategory}
                disabled={!newCategoryName.trim()}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
              <button
                onClick={() => { setShowAddCategory(false); setNewCategoryName(''); setNewCategoryFields(['']); }}
                className="px-4 py-2 border border-input rounded-lg text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ADD CUSTOM FIELD MODAL ===== */}
      {showAddField && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Add Custom Field</h2>
              <button onClick={() => setShowAddField(false)} className="p-1 hover:bg-muted rounded">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <select
                  value={newFieldCategory}
                  onChange={(e) => setNewFieldCategory(e.target.value)}
                  className={inputClass}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Field Name</label>
                <input
                  type="text"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  className={inputClass}
                  placeholder="Field name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tooltip</label>
                <input
                  type="text"
                  value={newFieldTooltip}
                  onChange={(e) => setNewFieldTooltip(e.target.value)}
                  className={inputClass}
                  placeholder="Tooltip text (shown on hover)"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleAddField}
                disabled={!newFieldName.trim() || !newFieldCategory}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                Add Field
              </button>
              <button
                onClick={() => setShowAddField(false)}
                className="px-4 py-2 border border-input rounded-lg text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Excel Preview Modal ──────────────────────────────── */}
      {udPreviewOpen && udPreviewRows.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <h3 className="text-sm font-bold">Preview &amp; Configure Upload</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {udPreviewFile?.name} — {udPreviewRows.length} rows detected
                </p>
              </div>
              <button onClick={() => { setUdPreviewOpen(false); setUdPreviewFile(null); setUdPreviewWorkbook(null); setUdPreviewRows([]); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Controls */}
            <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold whitespace-nowrap">Header row:</label>
                <input
                  type="number"
                  min={1}
                  max={udPreviewRows.length}
                  value={udHeaderRow}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(udPreviewRows.length, parseInt(e.target.value) || 1));
                    setUdHeaderRow(v);
                    if (udDataStartRow <= v) setUdDataStartRow(v + 1);
                    setUdPreviewPage(0);
                  }}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold whitespace-nowrap">Data rows:</label>
                <input
                  type="number"
                  min={udHeaderRow + 1}
                  max={udPreviewRows.length}
                  value={udDataStartRow}
                  onChange={(e) => {
                    const v = Math.max(2, Math.min(udPreviewRows.length, parseInt(e.target.value) || 2));
                    setUdDataStartRow(v);
                    setUdHeaderRow(v - 1);
                    setUdPreviewPage(0);
                  }}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                  title="Start row"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="number"
                  min={udDataStartRow}
                  max={udPreviewRows.length}
                  value={udDataEndRow}
                  onChange={(e) => {
                    const v = Math.max(udDataStartRow, Math.min(udPreviewRows.length, parseInt(e.target.value) || udPreviewRows.length));
                    setUdDataEndRow(v);
                  }}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                  title="End row"
                />
                <span className="text-xs text-muted-foreground">
                  ({Math.max(0, (udDataEndRow || udPreviewRows.length) - udDataStartRow + 1)} rows)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold whitespace-nowrap">Columns:</label>
                <input
                  type="number"
                  min={1}
                  max={Math.max(...udPreviewRows.map((r) => r.length), 1)}
                  value={udStartCol + 1}
                  onChange={(e) => {
                    const v = Math.max(1, parseInt(e.target.value) || 1) - 1;
                    setUdStartCol(v);
                    if (udEndCol < v) setUdEndCol(v);
                  }}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                  title="Start column"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="number"
                  min={udStartCol + 1}
                  max={Math.max(...udPreviewRows.map((r) => r.length), 1)}
                  value={udEndCol + 1}
                  onChange={(e) => {
                    const maxC = Math.max(...udPreviewRows.map((r) => r.length), 1);
                    const v = Math.max(udStartCol + 1, Math.min(maxC, parseInt(e.target.value) || maxC)) - 1;
                    setUdEndCol(v);
                  }}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                  title="End column"
                />
              </div>
              {udSelStart && udSelEnd && (
                <button
                  onClick={() => { setUdSelStart(null); setUdSelEnd(null); }}
                  className="text-xs text-muted-foreground hover:text-destructive underline"
                >
                  Clear selection
                </button>
              )}
            </div>

            {/* Column toggle row */}
            <div className="px-5 py-2 border-b border-border overflow-x-auto">
              <div className="flex items-center gap-1 min-w-max">
                <div className="w-12 flex-shrink-0 text-xs font-semibold text-muted-foreground text-center">Row</div>
                {Array.from({ length: Math.max(...udPreviewRows.map((r) => r.length), 0) }, (_, colIdx) => {
                  const headerVal = udPreviewRows[udHeaderRow - 1]?.[colIdx];
                  const isSkipped = udColumnSkip[colIdx];
                  return (
                    <div key={colIdx} className="w-32 flex-shrink-0">
                      <button
                        onClick={() => setUdColumnSkip((prev) => ({ ...prev, [colIdx]: !prev[colIdx] }))}
                        className={`w-full px-1.5 py-1 border rounded text-xs truncate ${
                          isSkipped
                            ? 'border-input bg-muted/50 text-muted-foreground line-through'
                            : 'border-accent bg-accent/10 text-accent font-semibold'
                        }`}
                        title={isSkipped ? 'Click to include' : 'Click to skip'}
                      >
                        {headerVal != null && String(headerVal).trim() ? String(headerVal) : `Col ${colIdx + 1}`}
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Click a column header to include/skip it.</p>
            </div>

            {/* Data preview table — click and drag to select cell range */}
            <div
              className="flex-1 overflow-auto px-5 py-2 select-none"
              onMouseUp={() => {
                if (udSelecting && udSelStart && udSelEnd) {
                  const minR = Math.min(udSelStart.r, udSelEnd.r);
                  const maxR = Math.max(udSelStart.r, udSelEnd.r);
                  const minC = Math.min(udSelStart.c, udSelEnd.c);
                  const maxC = Math.max(udSelStart.c, udSelEnd.c);
                  // Set header to the row above the selection (or the first row of selection)
                  if (minR > 0) setUdHeaderRow(minR);
                  else setUdHeaderRow(1);
                  setUdDataStartRow(minR + 1);
                  setUdDataEndRow(maxR + 1);
                  setUdStartCol(minC);
                  setUdEndCol(maxC);
                  // Update column skip: skip columns outside range
                  const maxAllCols = Math.max(...udPreviewRows.map((r) => r.length), 0);
                  const newSkip: Record<number, boolean> = {};
                  for (let c = 0; c < maxAllCols; c++) newSkip[c] = c < minC || c > maxC;
                  setUdColumnSkip(newSkip);
                }
                setUdSelecting(false);
              }}
              onMouseLeave={() => { if (udSelecting) setUdSelecting(false); }}
            >
              <div className="min-w-max">
                {(() => {
                  const pageStart = udPreviewPage * UD_PREVIEW_PAGE_SIZE;
                  const pageEnd = Math.min(pageStart + UD_PREVIEW_PAGE_SIZE, udPreviewRows.length);
                  const visibleRows = udPreviewRows.slice(pageStart, pageEnd);
                  const maxCols = Math.max(...udPreviewRows.map((r) => r.length), 0);

                  // Compute selection bounds
                  let selMinR = -1, selMaxR = -1, selMinC = -1, selMaxC = -1;
                  if (udSelStart && udSelEnd) {
                    selMinR = Math.min(udSelStart.r, udSelEnd.r);
                    selMaxR = Math.max(udSelStart.r, udSelEnd.r);
                    selMinC = Math.min(udSelStart.c, udSelEnd.c);
                    selMaxC = Math.max(udSelStart.c, udSelEnd.c);
                  }

                  // Compute active data range for highlighting
                  const activeStartRow = udDataStartRow - 1;
                  const activeEndRow = (udDataEndRow || udPreviewRows.length) - 1;

                  return visibleRows.map((row, rIdx) => {
                    const actualRowIdx = pageStart + rIdx;
                    const isHeaderRow = actualRowIdx === udHeaderRow - 1;
                    const isInDataRange = actualRowIdx >= activeStartRow && actualRowIdx <= activeEndRow;
                    const isBeforeData = actualRowIdx < activeStartRow && !isHeaderRow;

                    return (
                      <div
                        key={actualRowIdx}
                        className={`flex items-center gap-1 ${
                          isHeaderRow
                            ? 'bg-blue-500/10 font-semibold'
                            : isBeforeData
                            ? 'opacity-40 bg-amber-500/5'
                            : actualRowIdx === activeStartRow
                            ? 'bg-accent/10 border-l-2 border-accent'
                            : 'hover:bg-muted/30'
                        }`}
                      >
                        <div
                          className={`w-12 flex-shrink-0 text-xs text-center py-1 cursor-pointer hover:text-accent font-mono ${
                            isHeaderRow ? 'text-blue-500 font-bold' : actualRowIdx === activeStartRow ? 'text-accent font-bold' : 'text-muted-foreground'
                          }`}
                          onClick={() => {
                            setUdDataStartRow(actualRowIdx + 1);
                            if (actualRowIdx >= 1) setUdHeaderRow(actualRowIdx);
                            setUdPreviewPage(0);
                          }}
                          title={`Click to set data start at row ${actualRowIdx + 1}`}
                        >
                          {actualRowIdx + 1}
                        </div>
                        {Array.from({ length: maxCols }, (_, cIdx) => {
                          const val = row[cIdx];
                          const isSkipped = udColumnSkip[cIdx];
                          const isInSelection = selMinR >= 0 && actualRowIdx >= selMinR && actualRowIdx <= selMaxR && cIdx >= selMinC && cIdx <= selMaxC;
                          const isInActiveRange = isInDataRange && cIdx >= udStartCol && cIdx <= udEndCol && !isSkipped;
                          return (
                            <div
                              key={cIdx}
                              className={`w-32 flex-shrink-0 px-1.5 py-1 text-xs truncate border-r border-border/30 cursor-crosshair ${
                                isInSelection
                                  ? 'bg-accent/30 ring-1 ring-accent/50'
                                  : isInActiveRange
                                  ? 'bg-accent/5'
                                  : isSkipped
                                  ? 'opacity-30 line-through'
                                  : ''
                              }`}
                              title={String(val ?? '')}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setUdSelecting(true);
                                setUdSelStart({ r: actualRowIdx, c: cIdx });
                                setUdSelEnd({ r: actualRowIdx, c: cIdx });
                              }}
                              onMouseEnter={() => {
                                if (udSelecting) setUdSelEnd({ r: actualRowIdx, c: cIdx });
                              }}
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
              <p className="text-xs text-muted-foreground mt-2">Click and drag on cells to select a range. Click row numbers to set data start.</p>
            </div>

            {/* Pagination + Actions */}
            <div className="px-5 py-3 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  disabled={udPreviewPage === 0}
                  onClick={() => setUdPreviewPage((p) => Math.max(0, p - 1))}
                  className="p-1 rounded border border-input text-xs disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs text-muted-foreground">
                  Rows {udPreviewPage * UD_PREVIEW_PAGE_SIZE + 1}–{Math.min((udPreviewPage + 1) * UD_PREVIEW_PAGE_SIZE, udPreviewRows.length)} of {udPreviewRows.length}
                </span>
                <button
                  disabled={(udPreviewPage + 1) * UD_PREVIEW_PAGE_SIZE >= udPreviewRows.length}
                  onClick={() => setUdPreviewPage((p) => p + 1)}
                  className="p-1 rounded border border-input text-xs disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {Object.values(udColumnSkip).filter((v) => !v).length} columns included
                </span>
                <button
                  onClick={() => { setUdPreviewOpen(false); setUdPreviewFile(null); setUdPreviewWorkbook(null); setUdPreviewRows([]); }}
                  className="px-3 py-1.5 text-xs border border-input rounded hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={processUdExcelWithMapping}
                  disabled={Object.values(udColumnSkip).every((v) => v)}
                  className="px-4 py-1.5 text-xs bg-accent text-white rounded font-semibold hover:bg-accent/90 disabled:opacity-50"
                >
                  Upload {Math.max(0, (udDataEndRow || udPreviewRows.length) - udDataStartRow + 1)} rows
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== IMPORT TO CATEGORY MODAL ===== */}
      {importOpen && importRows.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <h3 className="text-sm font-bold">Import to Existing Category</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {importFile?.name} — Select a cell range, choose a category, and map columns to fields
                </p>
              </div>
              <button onClick={() => { setImportOpen(false); setImportFile(null); setImportRows([]); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Controls: category picker + range */}
            <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold whitespace-nowrap">Category:</label>
                <select
                  value={importTargetCat}
                  onChange={(e) => { setImportTargetCat(e.target.value); setImportColMapping({}); setImportNewFieldNames({}); }}
                  className="px-2 py-1 bg-background border border-input rounded text-xs min-w-[140px]"
                >
                  <option value="">Select category...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold whitespace-nowrap">Rows:</label>
                <input
                  type="number" min={1} max={importRows.length}
                  value={importDataStartRow}
                  onChange={(e) => setImportDataStartRow(Math.max(1, Math.min(importRows.length, parseInt(e.target.value) || 1)))}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="number" min={importDataStartRow} max={importRows.length}
                  value={importDataEndRow}
                  onChange={(e) => setImportDataEndRow(Math.max(importDataStartRow, Math.min(importRows.length, parseInt(e.target.value) || importRows.length)))}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                />
                <span className="text-xs text-muted-foreground">
                  ({Math.max(0, (importDataEndRow || importRows.length) - importDataStartRow + 1)} rows)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold whitespace-nowrap">Cols:</label>
                <input
                  type="number" min={1} max={Math.max(...importRows.map((r) => r.length), 1)}
                  value={importStartCol + 1}
                  onChange={(e) => { const v = Math.max(1, parseInt(e.target.value) || 1) - 1; setImportStartCol(v); if (importEndCol < v) setImportEndCol(v); }}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="number" min={importStartCol + 1} max={Math.max(...importRows.map((r) => r.length), 1)}
                  value={importEndCol + 1}
                  onChange={(e) => { const maxC = Math.max(...importRows.map((r) => r.length), 1); setImportEndCol(Math.max(importStartCol, Math.min(maxC - 1, (parseInt(e.target.value) || maxC) - 1))); }}
                  className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
                />
              </div>
              {importSelStart && importSelEnd && (
                <button onClick={() => { setImportSelStart(null); setImportSelEnd(null); }} className="text-xs text-muted-foreground hover:text-destructive underline">
                  Clear selection
                </button>
              )}
            </div>

            {/* Column → Field mapping bar */}
            {importTargetCat && (
              <div className="px-5 py-2 border-b border-border overflow-x-auto">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">Map each column to a field:</p>
                <div className="flex items-start gap-1 min-w-max">
                  <div className="w-12 flex-shrink-0" />
                  {Array.from({ length: importEndCol - importStartCol + 1 }, (_, i) => {
                    const colIdx = importStartCol + i;
                    const previewVal = importRows[importDataStartRow - 1]?.[colIdx];
                    const targetCat = categories.find((c) => c.id === importTargetCat);
                    const catFields = targetCat ? targetCat.fields.filter((f) => !f.linked_file_name) : [];
                    const mappingVal = importColMapping[colIdx] ?? '';
                    return (
                      <div key={colIdx} className="w-32 flex-shrink-0">
                        <div className="text-xs text-muted-foreground truncate px-1 mb-0.5" title={String(previewVal ?? '')}>
                          Col {colIdx + 1}: {previewVal != null && String(previewVal).trim() ? String(previewVal) : '-'}
                        </div>
                        <select
                          value={mappingVal}
                          onChange={(e) => {
                            setImportColMapping((prev) => ({ ...prev, [colIdx]: e.target.value }));
                            if (e.target.value !== '__new__') {
                              setImportNewFieldNames((prev) => { const n = { ...prev }; delete n[colIdx]; return n; });
                            }
                          }}
                          className={`w-full px-1 py-1 bg-background border rounded text-xs ${
                            mappingVal === '__new__' ? 'border-green-500' : mappingVal ? 'border-accent' : 'border-input'
                          }`}
                        >
                          <option value="">Skip</option>
                          {catFields.map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                          <option value="__new__">+ New field...</option>
                        </select>
                        {mappingVal === '__new__' && (
                          <input
                            type="text"
                            autoFocus
                            placeholder="Field name"
                            value={importNewFieldNames[colIdx] ?? ''}
                            onChange={(e) => setImportNewFieldNames((prev) => ({ ...prev, [colIdx]: e.target.value }))}
                            className="w-full mt-1 px-1 py-1 bg-background border border-green-500 rounded text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Data preview with range selection */}
            <div
              className="flex-1 overflow-auto px-5 py-2 select-none"
              onMouseUp={() => {
                if (importSelecting && importSelStart && importSelEnd) {
                  const minR = Math.min(importSelStart.r, importSelEnd.r);
                  const maxR = Math.max(importSelStart.r, importSelEnd.r);
                  const minC = Math.min(importSelStart.c, importSelEnd.c);
                  const maxC = Math.max(importSelStart.c, importSelEnd.c);
                  setImportDataStartRow(minR + 1);
                  setImportDataEndRow(maxR + 1);
                  setImportStartCol(minC);
                  setImportEndCol(maxC);
                  // Reset column mappings when range changes
                  setImportColMapping({}); setImportNewFieldNames({});
                }
                setImportSelecting(false);
              }}
              onMouseLeave={() => { if (importSelecting) setImportSelecting(false); }}
            >
              <div className="min-w-max">
                {(() => {
                  const pageStart = importPage * UD_PREVIEW_PAGE_SIZE;
                  const pageEnd = Math.min(pageStart + UD_PREVIEW_PAGE_SIZE, importRows.length);
                  const visibleRows = importRows.slice(pageStart, pageEnd);
                  const maxCols = Math.max(...importRows.map((r) => r.length), 0);
                  const activeStartRow = importDataStartRow - 1;
                  const activeEndRow = (importDataEndRow || importRows.length) - 1;

                  let selMinR = -1, selMaxR = -1, selMinC = -1, selMaxC = -1;
                  if (importSelStart && importSelEnd) {
                    selMinR = Math.min(importSelStart.r, importSelEnd.r);
                    selMaxR = Math.max(importSelStart.r, importSelEnd.r);
                    selMinC = Math.min(importSelStart.c, importSelEnd.c);
                    selMaxC = Math.max(importSelStart.c, importSelEnd.c);
                  }

                  return visibleRows.map((row, rIdx) => {
                    const actualRowIdx = pageStart + rIdx;
                    const isInRange = actualRowIdx >= activeStartRow && actualRowIdx <= activeEndRow;

                    return (
                      <div key={actualRowIdx} className={`flex items-center gap-1 ${isInRange ? 'bg-accent/5' : 'opacity-40'}`}>
                        <div className="w-12 flex-shrink-0 text-xs text-center py-1 font-mono text-muted-foreground">
                          {actualRowIdx + 1}
                        </div>
                        {Array.from({ length: maxCols }, (_, cIdx) => {
                          const val = row[cIdx];
                          const isInSelection = selMinR >= 0 && actualRowIdx >= selMinR && actualRowIdx <= selMaxR && cIdx >= selMinC && cIdx <= selMaxC;
                          const isInActiveRange = isInRange && cIdx >= importStartCol && cIdx <= importEndCol;
                          const isMapped = !!(importColMapping[cIdx]);
                          return (
                            <div
                              key={cIdx}
                              className={`w-32 flex-shrink-0 px-1.5 py-1 text-xs truncate border-r border-border/30 cursor-crosshair ${
                                isInSelection
                                  ? 'bg-green-500/30 ring-1 ring-green-500/50'
                                  : isInActiveRange && isMapped
                                  ? 'bg-accent/15'
                                  : isInActiveRange
                                  ? 'bg-accent/5'
                                  : ''
                              }`}
                              title={String(val ?? '')}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setImportSelecting(true);
                                setImportSelStart({ r: actualRowIdx, c: cIdx });
                                setImportSelEnd({ r: actualRowIdx, c: cIdx });
                              }}
                              onMouseEnter={() => {
                                if (importSelecting) setImportSelEnd({ r: actualRowIdx, c: cIdx });
                              }}
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
              <p className="text-xs text-muted-foreground mt-2">Click and drag to select the cell range you want to import.</p>
            </div>

            {/* Pagination + Actions */}
            <div className="px-5 py-3 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  disabled={importPage === 0}
                  onClick={() => setImportPage((p) => Math.max(0, p - 1))}
                  className="p-1 rounded border border-input text-xs disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs text-muted-foreground">
                  Rows {importPage * UD_PREVIEW_PAGE_SIZE + 1}–{Math.min((importPage + 1) * UD_PREVIEW_PAGE_SIZE, importRows.length)} of {importRows.length}
                </span>
                <button
                  disabled={(importPage + 1) * UD_PREVIEW_PAGE_SIZE >= importRows.length}
                  onClick={() => setImportPage((p) => p + 1)}
                  className="p-1 rounded border border-input text-xs disabled:opacity-30 hover:bg-muted"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {Object.values(importColMapping).filter((v) => v !== '').length} columns mapped
                </span>
                <button
                  onClick={() => { setImportOpen(false); setImportFile(null); setImportRows([]); }}
                  className="px-3 py-1.5 text-xs border border-input rounded hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={processImportToCategory}
                  disabled={!importTargetCat || Object.values(importColMapping).every((v) => v === '')}
                  className="px-4 py-1.5 text-xs bg-green-600 text-white rounded font-semibold hover:bg-green-500 disabled:opacity-50"
                >
                  Import {Math.max(0, (importDataEndRow || importRows.length) - importDataStartRow + 1)} rows
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
