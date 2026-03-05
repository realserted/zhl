'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader2, Trash2, X, Link, Upload, FileSpreadsheet, Pencil, FileText, ExternalLink, GripVertical } from 'lucide-react';
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
} from '@/lib/db/unit-data';
import { createRecoveryRequest } from '@/lib/db/unit-data-recovery';
import { downloadFileUrl } from '@/lib/db/files';
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
  const [uploading, setUploading] = useState(false);

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
  const nonEmptyRows = rows.filter((row) =>
    newRowIds.has(row.id) ||
    visibleFields.some((field) => {
      const val = valueMap.get(`${row.id}-${field.id}`);
      return val?.value != null && val.value.trim() !== '';
    })
  );

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

  // Add category
  const handleAddCategory = async () => {
    if (!selectedProjectId || !user || !newCategoryName.trim()) return;
    const cat = await createCategory(selectedProjectId, newCategoryName.trim(), categories.length);
    if (cat) {
      setCategories((prev) => [...prev, { ...cat, fields: [] }]);
      log(`Added category "${newCategoryName.trim()}"`);
      setNewCategoryName('');
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

  // Excel upload handler
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProjectId || !user) return;

    setUploading(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });

      // Use the file name (without extension) as the category name
      const fileName = file.name.replace(/\.(xlsx?|csv)$/i, '');

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

        if (jsonData.length === 0) continue;

        // Category name: file name if single sheet, or "fileName - sheetName" if multiple sheets
        const catName = workbook.SheetNames.length === 1 ? fileName : `${fileName} - ${sheetName}`;

        // Create category
        const cat = await createCategory(selectedProjectId, catName, categories.length);
        if (!cat) continue;

        // First row = column headers = field names
        const headers = (jsonData[0] as string[]).map((h) => String(h ?? '').trim()).filter(Boolean);
        const fields: UnitDataField[] = [];

        for (let fi = 0; fi < headers.length; fi++) {
          const field = await createField(cat.id, selectedProjectId, headers[fi], 'text', null, false, false, fi);
          if (field) fields.push(field);
        }

        // Remaining rows = data
        const newRows: UnitDataRow[] = [];
        for (let ri = 1; ri < jsonData.length; ri++) {
          const rowData = jsonData[ri] as string[];
          if (!rowData || rowData.every((cell) => cell === null || cell === undefined || String(cell).trim() === '')) continue;

          const row = await createRow(selectedProjectId, rows.length + newRows.length);
          if (!row) continue;
          newRows.push(row);

          // Insert values for each field
          for (let fi = 0; fi < fields.length; fi++) {
            const cellVal = rowData[fi] !== null && rowData[fi] !== undefined ? String(rowData[fi]).trim() : '';
            if (cellVal) {
              await upsertValue(row.id, fields[fi].id, cellVal);
            }
          }
        }

        // Update local state
        setCategories((prev) => [...prev, { ...cat, fields }]);
        setRows((prev) => [...prev, ...newRows]);

        // Reload values to get all the newly inserted ones
        const valData = await getValues(selectedProjectId);
        const vMap = new Map<string, UnitDataValue>();
        valData.forEach((v) => vMap.set(`${v.row_id}-${v.field_id}`, v));
        setValueMap(vMap);

        log(`Imported Excel "${file.name}" as category "${catName}" (${fields.length} fields, ${newRows.length} rows)`);
      }
    } catch (err) {
      console.error('Error processing Excel file:', err);
      alert('Failed to process the Excel file. Please check the format and try again.');
    } finally {
      setUploading(false);
      // Reset file input so same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = '';
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
      {/* Hidden file input for Excel upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={handleExcelUpload}
      />

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
                <table className="text-xs sm:text-sm" style={{ tableLayout: 'fixed', width: totalTableWidth, minWidth: '100%' }}>
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
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={visibleFields.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                        No data yet. Click &quot;+ Add Row&quot; to start adding data.
                      </td>
                    </tr>
                  ) : (
                    nonEmptyRows.map((row) => (
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

                            return (
                              <td
                                key={field.id}
                                className="px-4 py-4 whitespace-nowrap border-r border-border/50 last:border-r-0 overflow-hidden group/td"
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
                                    onClick={canEdit ? () => {
                                      setEditingCell({ rowId: row.id, fieldId: field.id });
                                      setEditValue(cellValue);
                                    } : undefined}
                                    className={`${canEdit ? 'cursor-pointer hover:bg-primary/5' : ''} px-2 py-1 rounded-lg min-w-12 min-h-5 text-xs flex items-center gap-2 transition-all font-medium`}
                                    title={canEdit ? 'Click to edit' : undefined}
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
                                      <button
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          const url = await downloadFileUrl(val.file_url!);
                                          if (url) window.open(url, '_blank');
                                        }}
                                        className="shrink-0 p-1 text-blue-500 hover:text-blue-400 transition-colors bg-blue-500/5 rounded-md"
                                        title={`Linked to: ${getRowLabel(row.id)} — Click to download`}
                                      >
                                        <Link className="h-3 w-3" />
                                      </button>
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
        maxWidth="sm"
      >
        <div className="space-y-6">
          <input
            type="text"
            autoFocus
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
            placeholder="Enter category name..."
            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
          />
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
    </main>
  );
}
