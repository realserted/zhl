'use client';

import { useState, useEffect, useRef, lazy, Suspense } from 'react';
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

const PdfViewer = lazy(() => import('@/components/shared/PdfViewer'));
import { getView, getProjectViews, saveView, saveFieldOrder } from '@/lib/db/unit-data-views';
import { getProjectSettings } from '@/lib/db/project-settings';
import { logUserAction } from '@/lib/db/user-logs';
import { ProjectPermission } from '@/lib/types/project';
import * as XLSX from 'xlsx';
import { Modal } from '@/components/shared/Modal';

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
        className="p-0.5 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shrink-0 touch-none"
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

  // File preview modal
  const [filePreview, setFilePreview] = useState<{ url: string; name: string; htmlContent?: string; downloadUrl?: string; pdfData?: ArrayBuffer } | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);

  const closeFilePreview = () => {
    if (filePreview?.url?.startsWith('blob:')) URL.revokeObjectURL(filePreview.url);
    setFilePreview(null);
  };

  // Cell selection for bulk operations (click + shift-click range, or click-drag)
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set()); // "rowId-fieldId"
  const [selAnchor, setSelAnchor] = useState<{ rowId: string; fieldId: string } | null>(null);
  const [tableSelecting, setTableSelecting] = useState(false);

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

  // Refresh values when a file is added via AddFilesModal
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
                    onChange={(e) => handleViewChange(e.target.value as ViewMode)}
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

            {/* Save View — owners can save any view, non-owners only Personal View */}
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

            {/* Add Category / Add Custom Field / Upload Excel — hidden for View-only */}
            {canEdit && (
              <div className="flex flex-col gap-2 mb-6">
                <button
                  onClick={() => setShowAddCategory(true)}
                  className="flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all px-1"
                >
                  <Plus className="h-3.5 w-3.5" /> ADD CATEGORY
                </button>
                <button
                  onClick={() => {
                    if (categories.length > 0) setNewFieldCategory(categories[0].id);
                    setShowAddField(true);
                  }}
                  className="flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all px-1"
                >
                  <Plus className="h-3.5 w-3.5" /> ADD CUSTOM FIELD
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all disabled:opacity-50 px-1"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  )}
                  {uploading ? 'IMPORTING...' : 'UPLOAD EXCEL'}
                </button>
                <button
                  onClick={() => quickFileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all disabled:opacity-50 px-1"
                >
                  <Upload className="h-3.5 w-3.5" />
                  QUICK UPLOAD
                </button>
                <button
                  onClick={() => importFileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-emerald-500 hover:text-emerald-400 transition-all disabled:opacity-50 px-1"
                >
                  <Download className="h-3.5 w-3.5" />
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
                          className="rounded border-input shrink-0"
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
                            className="text-xs font-bold text-primary bg-background/50 border border-primary/20 rounded-lg px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                          />
                        ) : (
                          <span className="text-[11px] font-bold tracking-wide text-primary truncate flex items-center gap-1 uppercase">
                            {cat.name}
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
                          </span>
                        )}
                      </label>
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
                                  className="rounded border-input shrink-0"
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
                    <div className="ml-4 space-y-0.5">
                      {getOrderedFields(cat).map((field) => (
                        <div key={field.id} className="flex items-center gap-1 group/field">
                          <label className={`flex items-center gap-2 flex-1 min-w-0 ${canToggleFields ? 'cursor-pointer' : 'cursor-default'}`}>
                            <input
                              type="checkbox"
                              checked={field.visible}
                              onChange={() => toggleField(field.id)}
                              disabled={!canToggleFields}
                              className="rounded border-input shrink-0"
                            />
                            <span className={`text-xs flex items-center gap-1 ${field.visible ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
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
                      <col key={field.id} style={{ width: columnWidths.get(field.id) ?? 120 }} />
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
                            onMouseDown={(e) => handleResizeMouseDown(e, field.id)}
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
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            setFilePreviewLoading(true);
                                            const url = await downloadFileUrl(val.file_url!, true);
                                            if (!url) { setFilePreviewLoading(false); return; }
                                            const fileName = decodeURIComponent(val.file_url!.split('/').pop() || 'File');

                                            // For docx files, convert to HTML client-side using mammoth
                                            if (/\.docx$/i.test(fileName)) {
                                              try {
                                                const mammoth = (await import('mammoth')).default;
                                                const response = await fetch(url);
                                                const arrayBuffer = await response.arrayBuffer();
                                                const result = await mammoth.convertToHtml({ arrayBuffer });
                                                setFilePreview({ url, name: fileName, htmlContent: result.value });
                                              } catch {
                                                setFilePreview({ url, name: fileName });
                                              }
                                            } else if (/\.pdf$/i.test(fileName)) {
                                              // Download PDF as ArrayBuffer for client-side rendering with pdf.js
                                              try {
                                                const response = await fetch(url);
                                                const arrayBuffer = await response.arrayBuffer();
                                                setFilePreview({ url, name: fileName, pdfData: arrayBuffer });
                                              } catch {
                                                setFilePreview({ url, name: fileName });
                                              }
                                            } else {
                                              setFilePreview({ url, name: fileName });
                                            }
                                            setFilePreviewLoading(false);
                                          }}
                                          className="shrink-0 p-1 text-blue-500 hover:text-blue-400 transition-colors bg-blue-500/5 rounded-md"
                                          title={`Linked to: ${getRowLabel(row.id)} — Click to preview`}
                                          disabled={filePreviewLoading}
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

          {/* Add Row Button — hidden for View-only */}
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

      {/* ===== ADD CATEGORY MODAL ===== */}
      <Modal
        isOpen={showAddCategory}
        onClose={() => setShowAddCategory(false)}
        title="Add Category"
        maxWidth="md"
      >
        <div className="space-y-5">
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Category Name</label>
            <input
              type="text"
              autoFocus
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
              placeholder="Enter category name..."
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Fields (optional)</label>
            <div className="space-y-2">
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
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (fieldName.trim() && idx === newCategoryFields.length - 1) {
                          setNewCategoryFields((prev) => [...prev, '']);
                        } else if (!fieldName.trim() && newCategoryFields.length > 1) {
                          handleAddCategory();
                        }
                      }
                    }}
                    className="flex-1 px-4 py-2.5 bg-background/50 border border-primary/20 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
                    placeholder={`Field ${idx + 1} name...`}
                  />
                  {newCategoryFields.length > 1 && (
                    <button
                      onClick={() => setNewCategoryFields((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setNewCategoryFields((prev) => [...prev, ''])}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors ml-1"
              >
                <Plus className="h-3 w-3" /> Add another field
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleAddCategory}
              disabled={!newCategoryName.trim()}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              Create Category
            </button>
            <button
              onClick={() => setShowAddCategory(false)}
              className="w-full px-4 py-3 border border-border rounded-2xl text-sm font-bold hover:bg-muted transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* ===== ADD CUSTOM FIELD MODAL ===== */}
      <Modal
        isOpen={showAddField}
        onClose={() => setShowAddField(false)}
        title="Add Custom Field"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Category</label>
            <div className="relative">
              <select
                value={newFieldCategory}
                onChange={(e) => setNewFieldCategory(e.target.value)}
                className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium appearance-none"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Field Name</label>
            <input
              type="text"
              autoFocus
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
              placeholder="Enter field name..."
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Tooltip</label>
            <input
              type="text"
              value={newFieldTooltip}
              onChange={(e) => setNewFieldTooltip(e.target.value)}
              className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
              placeholder="Help text shown on hover..."
            />
          </div>
          <div className="flex flex-col gap-3 mt-6">
            <button
              onClick={handleAddField}
              disabled={!newFieldName.trim() || !newFieldCategory}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              Create Field
            </button>
            <button
              onClick={() => setShowAddField(false)}
              className="w-full px-4 py-3 border border-border rounded-2xl text-sm font-bold hover:bg-muted transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* ===== UPLOAD WITH PREVIEW MODAL ===== */}
      <Modal
        isOpen={udPreviewOpen}
        onClose={() => { setUdPreviewOpen(false); setUdPreviewFile(null); setUdPreviewWorkbook(null); setUdPreviewRows([]); }}
        title={`Upload Preview — ${udPreviewFile?.name ?? ''}`}
        maxWidth="7xl"
      >
        <div className="flex flex-col" style={{ maxHeight: '75vh' }}>
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4 px-5 py-4 border-b border-border/50 bg-muted/20">
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Header</span>
              <input type="number" min={0} value={udHeaderRow} onChange={(e) => { setUdHeaderRow(Number(e.target.value)); setUdPreviewPage(0); }}
                className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Start</span>
              <input type="number" min={1} value={udDataStartRow} onChange={(e) => { setUdDataStartRow(Number(e.target.value)); setUdPreviewPage(0); }}
                className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">End</span>
              <input type="number" min={0} value={udDataEndRow} onChange={(e) => setUdDataEndRow(Number(e.target.value))}
                className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Col Start</span>
              <input type="number" min={0} value={udStartCol} onChange={(e) => setUdStartCol(Number(e.target.value))}
                className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Col End</span>
              <input type="number" min={0} value={udEndCol} onChange={(e) => setUdEndCol(Number(e.target.value))}
                className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
            <span className="text-[10px] font-bold tracking-widest uppercase text-primary ml-auto">
              {Math.max(0, (udDataEndRow || udPreviewRows.length) - udDataStartRow + 1)} data rows
            </span>
          </div>

          {/* Data preview */}
          <div className="flex-1 overflow-auto px-5 py-3">
            <div className="min-w-max">
              {(() => {
                const pageStart = udPreviewPage * UD_PREVIEW_PAGE_SIZE;
                const pageEnd = Math.min(pageStart + UD_PREVIEW_PAGE_SIZE, udPreviewRows.length);
                const visibleRows = udPreviewRows.slice(pageStart, pageEnd);
                const maxCols = Math.max(...udPreviewRows.map((r) => r.length), 0);

                const selR1 = udSelStart && udSelEnd ? Math.min(udSelStart.r, udSelEnd.r) : null;
                const selR2 = udSelStart && udSelEnd ? Math.max(udSelStart.r, udSelEnd.r) : null;
                const selC1 = udSelStart && udSelEnd ? Math.min(udSelStart.c, udSelEnd.c) : null;
                const selC2 = udSelStart && udSelEnd ? Math.max(udSelStart.c, udSelEnd.c) : null;

                return visibleRows.map((row, rIdx) => {
                  const actualRowIdx = pageStart + rIdx;
                  const isHeaderRow = udHeaderRow >= 1 && actualRowIdx === udHeaderRow - 1;
                  const isBeforeStart = actualRowIdx < udDataStartRow - 1;
                  const isStartRow = actualRowIdx === udDataStartRow - 1;
                  const isAfterEnd = udDataEndRow > 0 && actualRowIdx >= udDataEndRow;

                  return (
                    <div
                      key={actualRowIdx}
                      className={`flex items-center gap-1 rounded-lg transition-all ${
                        isHeaderRow ? 'bg-blue-500/10 font-semibold'
                        : isBeforeStart || isAfterEnd ? 'opacity-30'
                        : isStartRow ? 'bg-primary/10 border-l-2 border-primary'
                        : 'hover:bg-muted/30'
                      }`}
                    >
                      <div
                        className={`w-10 flex-shrink-0 text-xs text-center py-1.5 cursor-pointer hover:text-primary font-mono transition-colors ${
                          isHeaderRow ? 'text-blue-500 font-bold' : isStartRow ? 'text-primary font-bold' : 'text-muted-foreground/60'
                        }`}
                        onClick={() => { setUdDataStartRow(actualRowIdx + 1); if (actualRowIdx >= 1) setUdHeaderRow(actualRowIdx); setUdPreviewPage(0); }}
                        title={`Click to set data start at row ${actualRowIdx + 1}`}
                      >
                        {actualRowIdx + 1}
                      </div>
                      {Array.from({ length: maxCols }, (_, cIdx) => {
                        const val = row[cIdx];
                        const inRange = cIdx >= udStartCol && cIdx <= udEndCol && !udColumnSkip[cIdx];
                        const inSelection = selR1 !== null && selC1 !== null && actualRowIdx >= selR1 && actualRowIdx <= selR2! && cIdx >= selC1 && cIdx <= selC2!;
                        return (
                          <div
                            key={cIdx}
                            className={`w-28 flex-shrink-0 px-2 py-1.5 text-xs truncate border-r border-border/20 cursor-cell font-medium transition-all ${
                              inSelection ? 'bg-primary/20 ring-1 ring-primary/40 rounded' : inRange ? 'text-foreground/80' : 'opacity-20'
                            }`}
                            title={val != null ? String(val) : ''}
                            onMouseDown={() => { setUdSelecting(true); setUdSelStart({ r: actualRowIdx, c: cIdx }); setUdSelEnd({ r: actualRowIdx, c: cIdx }); }}
                            onMouseEnter={() => { if (udSelecting) setUdSelEnd({ r: actualRowIdx, c: cIdx }); }}
                            onMouseUp={() => {
                              setUdSelecting(false);
                              if (udSelStart && udSelEnd) {
                                const r1 = Math.min(udSelStart.r, udSelEnd.r);
                                const r2 = Math.max(udSelStart.r, udSelEnd.r);
                                const c1 = Math.min(udSelStart.c, udSelEnd.c);
                                const c2 = Math.max(udSelStart.c, udSelEnd.c);
                                setUdHeaderRow(r1 + 1);
                                setUdDataStartRow(r1 + 2);
                                setUdDataEndRow(r2 + 1);
                                setUdStartCol(c1);
                                setUdEndCol(c2);
                              }
                            }}
                          >
                            {val != null ? String(val) : ''}
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
          <div className="px-5 py-4 border-t border-border/50 flex items-center justify-between bg-muted/20">
            <div className="flex items-center gap-2">
              <button disabled={udPreviewPage === 0} onClick={() => setUdPreviewPage((p) => Math.max(0, p - 1))}
                className="p-1.5 rounded-lg border border-border/50 text-xs disabled:opacity-30 hover:bg-muted transition-all"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <span className="text-xs text-muted-foreground font-medium">
                Rows {udPreviewPage * UD_PREVIEW_PAGE_SIZE + 1}–{Math.min((udPreviewPage + 1) * UD_PREVIEW_PAGE_SIZE, udPreviewRows.length)} of {udPreviewRows.length}
              </span>
              <button disabled={(udPreviewPage + 1) * UD_PREVIEW_PAGE_SIZE >= udPreviewRows.length} onClick={() => setUdPreviewPage((p) => p + 1)}
                className="p-1.5 rounded-lg border border-border/50 text-xs disabled:opacity-30 hover:bg-muted transition-all"><ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => { setUdPreviewOpen(false); setUdPreviewFile(null); setUdPreviewWorkbook(null); setUdPreviewRows([]); }}
                className="px-4 py-2.5 text-xs border border-border rounded-2xl hover:bg-muted font-bold transition-all">Cancel</button>
              <button onClick={processUdExcelWithMapping} disabled={uploading}
                className="px-5 py-2.5 text-xs bg-primary text-primary-foreground rounded-2xl font-bold shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]">
                {uploading ? 'Uploading...' : `Upload ${Math.max(0, (udDataEndRow || udPreviewRows.length) - udDataStartRow + 1)} rows`}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ===== IMPORT TO CATEGORY MODAL ===== */}
      <Modal
        isOpen={importOpen}
        onClose={() => { setImportOpen(false); setImportFile(null); setImportRows([]); }}
        title={`Import to Category — ${importFile?.name ?? ''}`}
        maxWidth="7xl"
      >
        <div className="flex flex-col" style={{ maxHeight: '75vh' }}>
          {/* Target category + range controls */}
          <div className="flex flex-wrap items-center gap-4 px-5 py-4 border-b border-border/50 bg-muted/20">
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Category</span>
              <div className="relative">
                <select value={importTargetCat} onChange={(e) => { setImportTargetCat(e.target.value); setImportColMapping({}); setImportNewFieldNames({}); }}
                  className="px-3 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs font-medium appearance-none pr-7 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all">
                  <option value="">Select category...</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              </div>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Start</span>
              <input type="number" min={1} value={importDataStartRow} onChange={(e) => { setImportDataStartRow(Number(e.target.value)); setImportPage(0); }}
                className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">End</span>
              <input type="number" min={0} value={importDataEndRow} onChange={(e) => setImportDataEndRow(Number(e.target.value))}
                className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Col Start</span>
              <input type="number" min={0} value={importStartCol} onChange={(e) => setImportStartCol(Number(e.target.value))}
                className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Col End</span>
              <input type="number" min={0} value={importEndCol} onChange={(e) => setImportEndCol(Number(e.target.value))}
                className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
          </div>

          {/* Column-to-field mapping */}
          {importTargetCat && (
            <div className="px-5 py-3 border-b border-border/50 overflow-x-auto bg-muted/10">
              <div className="flex items-end gap-1 min-w-max">
                <div className="w-10 flex-shrink-0" />
                {Array.from({ length: Math.min(Math.max(...importRows.map((r) => r.length), 0), importEndCol + 1) }, (_, colIdx) => {
                  if (colIdx < importStartCol) return null;
                  const cat = categories.find((c) => c.id === importTargetCat);
                  const mappedVal = importColMapping[colIdx] ?? '';
                  const isNew = mappedVal === '__new__';
                  return (
                    <div key={colIdx} className="w-28 flex-shrink-0 space-y-1">
                      <select value={mappedVal} onChange={(e) => setImportColMapping((prev) => ({ ...prev, [colIdx]: e.target.value }))}
                        className={`w-full px-1.5 py-1 border rounded-lg text-[10px] font-medium transition-all ${mappedVal ? 'border-primary/40 bg-primary/10 text-primary font-bold' : 'border-border/50 bg-background/50 text-muted-foreground'}`}>
                        <option value="">— Skip —</option>
                        {cat?.fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        <option value="__new__">+ New field...</option>
                      </select>
                      {isNew && (
                        <input value={importNewFieldNames[colIdx] ?? ''} onChange={(e) => setImportNewFieldNames((prev) => ({ ...prev, [colIdx]: e.target.value }))}
                          placeholder="Field name..."
                          className="w-full px-1.5 py-1 border border-primary/20 rounded-lg text-[10px] bg-background/50 font-medium focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Data preview */}
          <div className="flex-1 overflow-auto px-5 py-3">
            <div className="min-w-max">
              {(() => {
                const IMPORT_PAGE_SIZE = 20;
                const pageStart = importPage * IMPORT_PAGE_SIZE;
                const pageEnd = Math.min(pageStart + IMPORT_PAGE_SIZE, importRows.length);
                const visibleRows = importRows.slice(pageStart, pageEnd);
                const maxCols = Math.max(...importRows.map((r) => r.length), 0);

                const selR1 = importSelStart && importSelEnd ? Math.min(importSelStart.r, importSelEnd.r) : null;
                const selR2 = importSelStart && importSelEnd ? Math.max(importSelStart.r, importSelEnd.r) : null;
                const selC1 = importSelStart && importSelEnd ? Math.min(importSelStart.c, importSelEnd.c) : null;
                const selC2 = importSelStart && importSelEnd ? Math.max(importSelStart.c, importSelEnd.c) : null;

                return visibleRows.map((row, rIdx) => {
                  const actualRowIdx = pageStart + rIdx;
                  const inDataRange = actualRowIdx >= importDataStartRow - 1 && (importDataEndRow === 0 || actualRowIdx < importDataEndRow);
                  return (
                    <div key={actualRowIdx} className={`flex items-center gap-1 rounded-lg transition-all ${inDataRange ? 'hover:bg-muted/30' : 'opacity-30'}`}>
                      <div className="w-10 flex-shrink-0 text-xs text-center py-1.5 text-muted-foreground/60 font-mono">{actualRowIdx + 1}</div>
                      {Array.from({ length: maxCols }, (_, cIdx) => {
                        const val = row[cIdx];
                        const inColRange = cIdx >= importStartCol && cIdx <= importEndCol;
                        const inSelection = selR1 !== null && selC1 !== null && actualRowIdx >= selR1 && actualRowIdx <= selR2! && cIdx >= selC1 && cIdx <= selC2!;
                        return (
                          <div key={cIdx}
                            className={`w-28 flex-shrink-0 px-2 py-1.5 text-xs truncate border-r border-border/20 cursor-cell font-medium transition-all ${
                              inSelection ? 'bg-primary/20 ring-1 ring-primary/40 rounded' : inColRange ? 'text-foreground/80' : 'opacity-20'
                            }`}
                            title={val != null ? String(val) : ''}
                            onMouseDown={() => { setImportSelecting(true); setImportSelStart({ r: actualRowIdx, c: cIdx }); setImportSelEnd({ r: actualRowIdx, c: cIdx }); }}
                            onMouseEnter={() => { if (importSelecting) setImportSelEnd({ r: actualRowIdx, c: cIdx }); }}
                            onMouseUp={() => {
                              setImportSelecting(false);
                              if (importSelStart && importSelEnd) {
                                const r1 = Math.min(importSelStart.r, importSelEnd.r);
                                const r2 = Math.max(importSelStart.r, importSelEnd.r);
                                const c1 = Math.min(importSelStart.c, importSelEnd.c);
                                const c2 = Math.max(importSelStart.c, importSelEnd.c);
                                setImportDataStartRow(r1 + 1);
                                setImportDataEndRow(r2 + 1);
                                setImportStartCol(c1);
                                setImportEndCol(c2);
                              }
                            }}
                          >
                            {val != null ? String(val) : ''}
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
          <div className="px-5 py-4 border-t border-border/50 flex items-center justify-between bg-muted/20">
            <div className="flex items-center gap-2">
              <button disabled={importPage === 0} onClick={() => setImportPage((p) => Math.max(0, p - 1))}
                className="p-1.5 rounded-lg border border-border/50 text-xs disabled:opacity-30 hover:bg-muted transition-all"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <span className="text-xs text-muted-foreground font-medium">
                Rows {importPage * 20 + 1}–{Math.min((importPage + 1) * 20, importRows.length)} of {importRows.length}
              </span>
              <button disabled={(importPage + 1) * 20 >= importRows.length} onClick={() => setImportPage((p) => p + 1)}
                className="p-1.5 rounded-lg border border-border/50 text-xs disabled:opacity-30 hover:bg-muted transition-all"><ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
                Mapped: {Object.values(importColMapping).filter((v) => v !== '').length} field(s)
              </span>
              <button onClick={() => { setImportOpen(false); setImportFile(null); setImportRows([]); }}
                className="px-4 py-2.5 text-xs border border-border rounded-2xl hover:bg-muted font-bold transition-all">Cancel</button>
              <button onClick={processImportToCategory}
                disabled={uploading || !importTargetCat || Object.values(importColMapping).filter((v) => v !== '').length === 0}
                className="px-5 py-2.5 text-xs bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-600/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]">
                {uploading ? 'Importing...' : 'Import to Category'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* File Preview Modal */}
      {filePreview && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/60 backdrop-blur-md" onClick={closeFilePreview} />
          <div className="relative bg-background/95 border border-white/10 rounded-xl shadow-2xl flex flex-col w-full max-w-5xl animate-in fade-in zoom-in duration-200" style={{ height: '85vh' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
              <h3 className="text-sm font-bold tracking-tight truncate">{filePreview.name}</h3>
              <div className="flex items-center gap-2">
                <a
                  href={filePreview.downloadUrl || filePreview.url}
                  download={filePreview.name}
                  className="px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase text-muted-foreground hover:text-foreground border border-border/50 rounded-xl transition-all"
                >
                  Download
                </a>
                <button onClick={closeFilePreview} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* Preview content */}
            <div className="flex-1 overflow-hidden p-1">
              {filePreview.htmlContent ? (
                <div
                  className="w-full h-full overflow-auto bg-white rounded-lg p-8"
                  dangerouslySetInnerHTML={{ __html: filePreview.htmlContent }}
                  style={{ color: '#222', fontSize: '14px', lineHeight: '1.6' }}
                />
              ) : /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(filePreview.name) ? (
                <div className="w-full h-full flex items-center justify-center overflow-auto p-4">
                  <img src={filePreview.url} alt={filePreview.name} className="max-w-full max-h-full object-contain rounded-lg" />
                </div>
              ) : /\.(mp4|webm|ogg|mov)$/i.test(filePreview.name) ? (
                <video src={filePreview.url} controls className="w-full h-full object-contain rounded-lg" />
              ) : /\.(mp3|wav|aac|flac|ogg)$/i.test(filePreview.name) ? (
                <div className="w-full h-full flex items-center justify-center">
                  <audio src={filePreview.url} controls className="w-full max-w-md" />
                </div>
              ) : filePreview.pdfData ? (
                <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>}>
                  <PdfViewer data={filePreview.pdfData} />
                </Suspense>
              ) : /\.(txt|html?|csv)$/i.test(filePreview.name) ? (
                <iframe
                  src={filePreview.url}
                  className="w-full h-full rounded-lg border-0"
                  title={filePreview.name}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <FileText className="h-16 w-16 opacity-30" />
                  <p className="text-sm font-medium">Preview not available for this file type</p>
                  <a
                    href={filePreview.url}
                    download={filePreview.name}
                    className="px-4 py-2 text-xs font-bold tracking-wider uppercase bg-primary text-primary-foreground rounded-xl transition-all hover:opacity-90"
                  >
                    Download to view
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
