'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, ChevronLeft, ChevronRight, Loader2, Trash2, X, Link, Upload, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { supabase } from '../../lib/supabase';
import { CategoryWithFields, UnitDataField, UnitDataRow, UnitDataValue } from '../../lib/types/unit-data';
import {
  getCategories,
  getRows,
  getValues,
  createCategory,
  createField,
  createRow,
  deleteRow,
  deleteCategory,
  upsertValue,
  updateFieldVisibility,
  seedDefaultSchema,
} from '../../lib/db/unit-data';
import { logUserAction } from '../../lib/db/user-logs';
import * as XLSX from 'xlsx';

interface UnitDataPageProps {
  selectedProjectId: string | null;
}

type ViewMode = 'ALL FIELDS' | 'All Project Users' | 'Personal View (future)' | 'PM View';

export default function UnitDataPage({ selectedProjectId }: UnitDataPageProps) {
  const { user } = useAuth();

  // Data state
  const [categories, setCategories] = useState<CategoryWithFields[]>([]);
  const [rows, setRows] = useState<UnitDataRow[]>([]);
  const [valueMap, setValueMap] = useState<Map<string, UnitDataValue>>(new Map());
  const [loading, setLoading] = useState(true);

  // User info for logging — use refs so async callbacks always get latest
  const [displayName, setDisplayName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const displayNameRef = useRef('');
  const userEmailRef = useRef('');

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [selectedView, setSelectedView] = useState<ViewMode>('ALL FIELDS');

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
  const [newFieldIsFileLink, setNewFieldIsFileLink] = useState(false);
  const [newFieldIsHyperlink, setNewFieldIsHyperlink] = useState(false);

  // Excel upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Load user info
  useEffect(() => {
    if (!user) return;
    supabase
      .from('accounts')
      .select('display_name, email')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        const name = data?.display_name || user.email || 'Unknown';
        const email = data?.email || user.email || '';
        setDisplayName(name);
        setUserEmail(email);
        displayNameRef.current = name;
        userEmailRef.current = email;
      });
  }, [user]);

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

    let cats = await getCategories(projectId);

    // Seed defaults if no schema exists yet
    if (cats.length === 0) {
      cats = await seedDefaultSchema(projectId);
    }

    const rowData = await getRows(projectId);
    const valData = await getValues(projectId);

    const vMap = new Map<string, UnitDataValue>();
    valData.forEach((v) => vMap.set(`${v.row_id}-${v.field_id}`, v));

    // Delete rows that have no values at all
    const rowsWithValues = new Set(valData.map((v) => v.row_id));
    const emptyRows = rowData.filter((r) => !rowsWithValues.has(r.id));
    await Promise.all(emptyRows.map((r) => deleteRow(r.id)));
    const cleanedRows = rowData.filter((r) => rowsWithValues.has(r.id));

    setCategories(cats);
    setRows(cleanedRows);
    setValueMap(vMap);
    setLoading(false);
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

  // Get all visible fields in order
  const visibleFields = categories.flatMap((c) => c.fields.filter((f) => f.visible));

  // Filter out fully blank rows (no values across any visible field)
  const nonEmptyRows = rows.filter((row) =>
    visibleFields.some((field) => {
      const val = valueMap.get(`${row.id}-${field.id}`);
      return val?.value != null && val.value.trim() !== '';
    })
  );

  // View mode handler — changes which fields are visible
  const handleViewChange = async (view: ViewMode) => {
    setSelectedView(view);

    if (view === 'ALL FIELDS') {
      // Show all fields
      for (const cat of categories) {
        for (const field of cat.fields) {
          if (!field.visible) await updateFieldVisibility(field.id, true);
        }
      }
      setCategories((prev) =>
        prev.map((c) => ({ ...c, fields: c.fields.map((f) => ({ ...f, visible: true })) }))
      );
    }
    // Other views can be customized later — for now they just set the label
  };

  // Toggle category visibility (all fields in category)
  const toggleCategory = async (categoryId: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;

    const allVisible = cat.fields.every((f) => f.visible);
    const newVisible = !allVisible;

    for (const field of cat.fields) {
      await updateFieldVisibility(field.id, newVisible);
    }

    setCategories((prev) =>
      prev.map((c) =>
        c.id === categoryId
          ? { ...c, fields: c.fields.map((f) => ({ ...f, visible: newVisible })) }
          : c
      )
    );
  };

  // Toggle individual field visibility
  const toggleField = async (fieldId: string) => {
    const field = categories.flatMap((c) => c.fields).find((f) => f.id === fieldId);
    if (!field) return;

    const newVisible = !field.visible;
    await updateFieldVisibility(fieldId, newVisible);

    setCategories((prev) =>
      prev.map((c) => ({
        ...c,
        fields: c.fields.map((f) => (f.id === fieldId ? { ...f, visible: newVisible } : f)),
      }))
    );
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

  // Delete category
  const handleDeleteCategory = async (categoryId: string) => {
    if (!user || !selectedProjectId) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;

    const confirmed = window.confirm(`Delete category "${cat.name}" and all its fields? This cannot be undone.`);
    if (!confirmed) return;

    const ok = await deleteCategory(categoryId);
    if (ok) {
      setCategories((prev) => prev.filter((c) => c.id !== categoryId));
      log(`Deleted category "${cat.name}"`);
    }
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
      newFieldIsFileLink,
      newFieldIsHyperlink,
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
      setNewFieldIsFileLink(false);
      setNewFieldIsHyperlink(false);
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
              DATA VIEW <span className="font-normal text-muted-foreground text-xs ml-1">(collapse)</span>
            </button>

            {/* Load View Dropdown */}
            <div className="mb-2">
              <label className="text-xs text-muted-foreground block mb-1">Load View:</label>
              <select
                value={selectedView}
                onChange={(e) => handleViewChange(e.target.value as ViewMode)}
                className="w-full border border-input rounded px-2 py-1 bg-background text-foreground text-xs"
              >
                <option value="ALL FIELDS">ALL FIELDS</option>
                <option value="All Project Users">All Project Users</option>
                <option value="Personal View (future)">Personal View (future)</option>
                <option value="PM View">PM View</option>
              </select>
            </div>

            {/* Save View */}
            <button className="text-xs text-muted-foreground hover:text-foreground mb-4 block">
              Save View
            </button>

            {/* Add Category / Add Custom Field / Upload Excel */}
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
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent/80 disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-3 w-3" />
                )}
                {uploading ? 'Importing...' : 'Upload Excel'}
              </button>
            </div>

            {/* Category + Field Checkboxes */}
            <div className="space-y-3">
              {categories.map((cat, ci) => {
                const allVisible = cat.fields.length > 0 && cat.fields.every((f) => f.visible);
                const someVisible = cat.fields.some((f) => f.visible);
                const color = categoryColors[ci % categoryColors.length];

                return (
                  <div key={cat.id} className={`border-l-2 border-dotted ${color} pl-3`}>
                    {/* Category checkbox + delete */}
                    <div className="flex items-center gap-2 mb-1">
                      <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={allVisible}
                          ref={(el) => { if (el) el.indeterminate = someVisible && !allVisible; }}
                          onChange={() => toggleCategory(cat.id)}
                          className="rounded border-input flex-shrink-0"
                        />
                        <span className="text-xs font-semibold text-accent truncate">{cat.name}</span>
                      </label>
                      <button
                        onClick={() => handleDeleteCategory(cat.id)}
                        className="p-0.5 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                        title={`Delete "${cat.name}"`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Field checkboxes */}
                    <div className="ml-4 space-y-0.5">
                      {cat.fields.map((field) => (
                        <label key={field.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={field.visible}
                            onChange={() => toggleField(field.id)}
                            className="rounded border-input"
                          />
                          <span className={`text-xs ${field.visible ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                            {field.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
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
              <table className="w-full text-xs sm:text-sm">
                {/* Category header row */}
                <thead>
                  {categories.some((cat) => cat.fields.filter((f) => f.visible).length > 0) && (
                  <tr className="border-b border-input">
                    {categories.map((cat) => {
                      const catVisibleFields = cat.fields.filter((f) => f.visible);
                      if (catVisibleFields.length === 0) return null;
                      const isCollapsed = collapsedCategories.has(cat.id);

                      return (
                        <th
                          key={cat.id}
                          colSpan={isCollapsed ? 1 : catVisibleFields.length}
                          className="px-3 py-2 text-left bg-muted/50 border-r border-input last:border-r-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-amber-500">&#128193;</span>
                            <span className="font-semibold text-xs text-accent">{cat.name}</span>
                            <button
                              onClick={() => toggleCategoryCollapse(cat.id)}
                              className="text-xs text-blue-500 hover:underline ml-1"
                            >
                              ({isCollapsed ? 'Expand' : 'Collapse'})
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
                      const catVisibleFields = cat.fields.filter((f) => f.visible);
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
                          className="px-3 py-2 text-left font-semibold text-xs whitespace-nowrap border-r border-input last:border-r-0"
                          title={field.tooltip ?? undefined}
                        >
                          <div className="flex items-center gap-1">
                            {field.name}
                            {field.is_file_link && <Upload className="h-3 w-3 text-muted-foreground" />}
                            {field.is_hyperlink && <Link className="h-3 w-3 text-muted-foreground" />}
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
                      <tr key={row.id} className="border-b border-input hover:bg-muted/30 transition-colors">
                        {categories.map((cat) => {
                          const catVisibleFields = cat.fields.filter((f) => f.visible);
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
                                className="px-3 py-2 border-r border-input last:border-r-0"
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
                                    onClick={() => {
                                      setEditingCell({ rowId: row.id, fieldId: field.id });
                                      setEditValue(cellValue);
                                    }}
                                    className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded block min-w-[3rem] min-h-[1.25rem] text-xs"
                                    title="Click to edit"
                                  >
                                    {field.is_hyperlink && cellValue ? (
                                      <a
                                        href={cellValue}
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
                                  </span>
                                )}
                              </td>
                            );
                          });
                        })}
                        <td className="px-2 py-2">
                          <button
                            onClick={() => handleDeleteRow(row.id)}
                            className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                            title="Delete row"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Add Row Button */}
          <button
            onClick={handleAddRow}
            className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-accent hover:text-accent/80 transition-colors"
          >
            <Plus className="h-3 w-3" /> Add Row
          </button>
        </div>
      </div>

      {/* ===== ADD CATEGORY MODAL ===== */}
      {showAddCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Add Category</h2>
              <button onClick={() => setShowAddCategory(false)} className="p-1 hover:bg-muted rounded">
                <X className="h-5 w-5" />
              </button>
            </div>
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className={inputClass}
              placeholder="Category name"
              onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
            />
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleAddCategory}
                disabled={!newCategoryName.trim()}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
              <button
                onClick={() => setShowAddCategory(false)}
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
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newFieldIsFileLink}
                    onChange={(e) => setNewFieldIsFileLink(e.target.checked)}
                    className="rounded border-input"
                  />
                  Links to files?
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newFieldIsHyperlink}
                    onChange={(e) => setNewFieldIsHyperlink(e.target.checked)}
                    className="rounded border-input"
                  />
                  Hyperlink?
                </label>
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
    </main>
  );
}
