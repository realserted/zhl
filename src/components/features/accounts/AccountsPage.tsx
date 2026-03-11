'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase/client';
import { ProjectPermission } from '@/lib/types/project';
import {
  Trash2, Lock, Hash, Eye, EyeOff, ShieldAlert,
  PlusCircle, Upload, Loader2, X, GripVertical
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/shared/Button';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ProjectAccount {
  id: string;
  project_id: string;
  account_name: string | null;
  descriptor: string | null;
  company_name: string | null;
  person_name: string | null;
  phone: string | null;
  email: string | null;
  link: string | null;
  username: string | null;
  password: string | null;
  account_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface AccountsPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null;
}

interface ColumnDef {
  field: keyof ProjectAccount;
  label: string;
  icon?: 'lock' | 'hash';
  sensitive?: boolean;
  minWidth: number;
}

const COLUMNS: ColumnDef[] = [
  { field: 'account_name',  label: 'Account',        minWidth: 130 },
  { field: 'descriptor',    label: 'Descriptor',      minWidth: 120 },
  { field: 'company_name',  label: 'Company Name',    minWidth: 130 },
  { field: 'person_name',   label: 'Person Name',     minWidth: 120 },
  { field: 'phone',         label: 'Phone',           minWidth: 110 },
  { field: 'email',         label: 'Email',           minWidth: 160 },
  { field: 'link',          label: 'Link / URL',      minWidth: 140 },
  { field: 'username',      label: 'USERNAME',        icon: 'lock', sensitive: true, minWidth: 120 },
  { field: 'password',      label: 'PASSWORD',        icon: 'lock', sensitive: true, minWidth: 120 },
  { field: 'account_number',label: 'Account Number',  icon: 'hash', sensitive: true, minWidth: 130 },
  { field: 'notes',         label: 'NOTES',           minWidth: 160 },
];

// Map common Excel header names → field keys
const HEADER_MAP: Record<string, keyof ProjectAccount> = {
  account: 'account_name', 'account name': 'account_name', name: 'account_name',
  descriptor: 'descriptor',
  company: 'company_name', 'company name': 'company_name',
  person: 'person_name', 'person name': 'person_name', contact: 'person_name',
  phone: 'phone', telephone: 'phone', mobile: 'phone',
  email: 'email', 'e-mail': 'email',
  link: 'link', url: 'link', website: 'link',
  username: 'username', user: 'username', login: 'username',
  password: 'password', pass: 'password', pwd: 'password',
  'account number': 'account_number', 'account no': 'account_number', 'acct number': 'account_number', acct: 'account_number',
  notes: 'notes', note: 'notes', comments: 'notes',
};

// ── Sortable header cell ──────────────────────────────────────────────────────

function SortableHeaderCell({
  col, width, onResizeStart,
}: {
  col: ColumnDef;
  width: number;
  onResizeStart: (field: string, e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.field });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    width,
    minWidth: 60,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <th ref={setNodeRef} style={style} {...attributes} className="relative px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap group/th select-none">
      <div className="flex items-center gap-1.5" {...listeners}>
        <span className="cursor-grab opacity-0 group-hover/th:opacity-50 transition-opacity shrink-0">
          <GripVertical className="h-3 w-3" />
        </span>
        {col.icon === 'lock' && <Lock className="h-3.5 w-3.5 text-amber-500" />}
        {col.icon === 'hash' && <Hash className="h-3.5 w-3.5 text-blue-500" />}
        {col.label}
      </div>
      {/* Resize handle - wide hit area, narrow visible line */}
      <div
        onMouseDown={(e) => {
          e.stopPropagation(); // prevent dnd-kit from capturing this
          onResizeStart(col.field, e);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-[-4px] top-0 bottom-0 w-[9px] cursor-col-resize z-10 flex items-center justify-center group/resize"
      >
        <div className="w-[2px] h-full bg-transparent group-hover/resize:bg-primary/50 transition-colors" />
      </div>
    </th>
  );
}

// Undo history entry: snapshot of changed cells before an edit/paste
interface UndoEntry {
  changes: { id: string; field: string; oldValue: string | null }[];
  /** Row IDs that were created during paste (to delete on undo) */
  createdRowIds?: string[];
}

export default function AccountsPage({ selectedProjectId, userPermission }: AccountsPageProps) {
  const [accounts, setAccounts] = useState<ProjectAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [addingRow, setAddingRow] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importMessage, setImportMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const undoStack = useRef<UndoEntry[]>([]);

  // Column ordering & resizing
  const [columnOrder, setColumnOrder] = useState<string[]>(COLUMNS.map((c) => c.field));
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  const colMap = useMemo(() => {
    const m = new Map<string, ColumnDef>();
    for (const c of COLUMNS) m.set(c.field, c);
    return m;
  }, []);

  const orderedColumns = useMemo(() => {
    return columnOrder.map((f) => colMap.get(f)).filter(Boolean) as ColumnDef[];
  }, [columnOrder, colMap]);

  const permLevel = userPermission?.perm_accounts ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;

  // DnD sensors
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  // Column resizing
  const handleResizeStart = useCallback((field: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[field] ?? (colMap.get(field)?.minWidth ?? 130);

    const onMouseMove = (ev: MouseEvent) => {
      const diff = ev.clientX - startX;
      setColWidths((prev) => ({ ...prev, [field]: Math.max(60, startW + diff) }));
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [colWidths, colMap]);

  useEffect(() => {
    if (!selectedProjectId) { setAccounts([]); return; }
    loadAccounts();
  }, [selectedProjectId]);

  const loadAccounts = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('zhl_project_accounts')
      .select('*')
      .eq('project_id', selectedProjectId)
      .order('created_at', { ascending: true });
    setLoading(false);
    if (error) {
      console.error('Error loading project accounts:', error);
      setImportMessage({ text: `Failed to load accounts: ${error.message ?? error.code ?? 'RLS policy blocked the request'}`, ok: false });
      return;
    }
    setAccounts((data ?? []) as ProjectAccount[]);
  };

  const handleAddRow = async () => {
    if (!selectedProjectId) return;
    setAddingRow(true);
    setImportMessage(null);
    const { data, error } = await supabase
      .from('zhl_project_accounts')
      .insert({ project_id: selectedProjectId })
      .select()
      .single();
    setAddingRow(false);
    if (error) {
      console.error('Error adding row:', error);
      setImportMessage({ text: `Failed to add row: ${error.message ?? error.code ?? 'RLS policy blocked the request'}`, ok: false });
      return;
    }
    if (data) setAccounts((prev) => [...prev, data as ProjectAccount]);
  };

  const handleDelete = async (account: ProjectAccount) => {
    if (!confirm('Delete this account entry?')) return;
    const { error } = await supabase.from('zhl_project_accounts').delete().eq('id', account.id);
    if (!error) setAccounts((prev) => prev.filter((a) => a.id !== account.id));
  };

  const saveEdit = async (accountId: string, field: string, value: string) => {
    setEditingCell(null);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    const oldValue = (account as unknown as Record<string, string | null>)[field] ?? '';
    if (value === oldValue) return;

    const { error } = await supabase
      .from('zhl_project_accounts')
      .update({ [field]: value || null })
      .eq('id', accountId);

    if (!error) {
      // Push to undo stack
      undoStack.current.push({
        changes: [{ id: accountId, field, oldValue: (account as unknown as Record<string, string | null>)[field] ?? null }],
      });
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountId ? { ...a, [field]: value || null } : a))
      );
    }
  };

  // ── Undo handler (Ctrl+Z) ────────────────────────────────────────────────
  const handleUndo = useCallback(async () => {
    const entry = undoStack.current.pop();
    if (!entry) return;

    // Delete any rows that were created during a paste
    if (entry.createdRowIds?.length) {
      for (const rowId of entry.createdRowIds) {
        await supabase.from('zhl_project_accounts').delete().eq('id', rowId);
      }
      setAccounts((prev) => prev.filter((a) => !entry.createdRowIds!.includes(a.id)));
    }

    // Revert changed cells
    for (const change of entry.changes) {
      await supabase
        .from('zhl_project_accounts')
        .update({ [change.field]: change.oldValue })
        .eq('id', change.id);
    }

    setAccounts((prev) =>
      prev.map((a) => {
        const relevant = entry.changes.filter((c) => c.id === a.id);
        if (relevant.length === 0) return a;
        const patched = { ...a };
        for (const c of relevant) {
          (patched as unknown as Record<string, string | null>)[c.field] = c.oldValue;
        }
        return patched;
      })
    );
    setImportMessage({ text: 'Undo successful.', ok: true });
  }, []);

  // Listen for Ctrl+Z globally on the table
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        // Don't intercept if user is typing in an input
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        handleUndo();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleUndo]);

  const togglePassword = (id: string) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Paste handler ──────────────────────────────────────────────────────────
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    if (!canEdit || !selectedProjectId) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;

    const rows = text.split('\n').map((line) => line.split('\t'));
    if (rows.length === 0 || (rows.length === 1 && rows[0].length <= 1)) return;

    // If editing a cell, use that as anchor; otherwise paste from first row + first column
    const anchorRowIdx = editingCell ? accounts.findIndex((a) => a.id === editingCell.id) : 0;
    const anchorColIdx = editingCell ? orderedColumns.findIndex((c) => c.field === editingCell.field) : 0;
    if (anchorRowIdx < 0 || anchorColIdx < 0) return;

    e.preventDefault();
    setEditingCell(null);

    const updates: PromiseLike<void>[] = [];
    let newAccounts = [...accounts];
    const undoChanges: { id: string; field: string; oldValue: string | null }[] = [];
    const createdRowIds: string[] = [];

    for (let r = 0; r < rows.length; r++) {
      const rowIdx = anchorRowIdx + r;
      // Skip empty trailing rows
      if (rows[r].every((cell) => !cell.trim())) continue;

      // Add new rows if needed
      if (rowIdx >= newAccounts.length) {
        const { data } = await supabase
          .from('zhl_project_accounts')
          .insert({ project_id: selectedProjectId })
          .select()
          .single();
        if (data) {
          newAccounts = [...newAccounts, data as ProjectAccount];
          createdRowIds.push((data as ProjectAccount).id);
        } else continue;
      }

      const account = newAccounts[rowIdx];

      for (let c = 0; c < rows[r].length; c++) {
        const colIdx = anchorColIdx + c;
        if (colIdx >= orderedColumns.length) break;
        const field = orderedColumns[colIdx].field;
        const val = rows[r][c].trim();
        const oldValue = (account as unknown as Record<string, string | null>)[field] ?? null;

        // Track for undo
        undoChanges.push({ id: account.id, field, oldValue });

        updates.push(
          supabase
            .from('zhl_project_accounts')
            .update({ [field]: val || null })
            .eq('id', account.id)
            .then(() => {
              newAccounts = newAccounts.map((a) =>
                a.id === account.id ? { ...a, [field]: val || null } : a
              );
            })
        );
      }
    }

    await Promise.all(updates);
    setAccounts(newAccounts);

    // Push to undo stack
    undoStack.current.push({ changes: undoChanges, createdRowIds });

    setImportMessage({ text: `Pasted ${rows.filter((r) => r.some((c) => c.trim())).length} rows. Press Ctrl+Z to undo.`, ok: true });
  }, [canEdit, selectedProjectId, editingCell, accounts, orderedColumns]);

  // ── Excel / CSV upload ─────────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProjectId) return;
    e.target.value = '';
    setUploading(true);
    setImportMessage(null);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });

      if (rows.length === 0) {
        setImportMessage({ text: 'No data rows found in the file.', ok: false });
        setUploading(false);
        return;
      }

      const firstRow = rows[0];
      const headerToField: Record<string, keyof ProjectAccount> = {};
      for (const rawHeader of Object.keys(firstRow)) {
        const normalized = rawHeader.trim().toLowerCase();
        const mapped = HEADER_MAP[normalized];
        if (mapped) headerToField[rawHeader] = mapped;
      }

      const inserts = rows.map((row) => {
        const entry: Record<string, string | null> = { project_id: selectedProjectId };
        for (const [rawHeader, field] of Object.entries(headerToField)) {
          const val = String(row[rawHeader] ?? '').trim();
          entry[field as string] = val || null;
        }
        return entry;
      });

      const { error } = await supabase.from('zhl_project_accounts').insert(inserts);
      if (error) {
        setImportMessage({ text: `Import failed: ${error.message}`, ok: false });
      } else {
        await loadAccounts();
        setImportMessage({ text: `Imported ${inserts.length} row${inserts.length !== 1 ? 's' : ''} successfully.`, ok: true });
      }
    } catch {
      setImportMessage({ text: 'Failed to parse file. Please use .xlsx or .csv format.', ok: false });
    }

    setUploading(false);
  };

  if (!selectedProjectId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Select a project to view the account vault.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1800px] mx-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold tracking-tight">Project Account Vault</h2>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-600 dark:text-amber-500">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span className="text-[10px] font-medium">Secure</span>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddRow}
              disabled={addingRow}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold tracking-wider uppercase bg-primary/10 text-primary hover:bg-primary/20 transition-all disabled:opacity-50"
            >
              {addingRow ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
              Add Row
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold tracking-wider uppercase bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90 transition-all disabled:opacity-50 active:scale-[0.98]"
              title="Upload an Excel (.xlsx) or CSV file. Columns are matched by header name."
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload Excel / CSV
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
        )}
      </div>

      {/* Import status message */}
      {importMessage && (
        <div className={`mb-3 flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg border ${importMessage.ok ? 'bg-green-50 dark:bg-green-950/20 border-green-500/30 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-950/20 border-red-500/30 text-destructive'}`}>
          <span>{importMessage.text}</span>
          <Button variant="ghost" size="icon" onClick={() => setImportMessage(null)} className="h-6 w-6">
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="glass-card rounded-2xl border border-border/50 shadow-sm overflow-x-auto" onPaste={handlePaste}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <table className="text-xs sm:text-sm" style={{ tableLayout: 'fixed', width: orderedColumns.reduce((sum, col) => sum + (colWidths[col.field] ?? col.minWidth), 0) + (canEdit ? 50 : 0) }}>
            <colgroup>
              {orderedColumns.map((col) => (
                <col key={col.field} style={{ width: colWidths[col.field] ?? col.minWidth }} />
              ))}
              {canEdit && <col style={{ width: 50 }} />}
            </colgroup>
            <thead>
              <tr className="bg-muted/30 border-b border-border/50">
                <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
                  {orderedColumns.map((col) => (
                    <SortableHeaderCell
                      key={col.field}
                      col={col}
                      width={colWidths[col.field] ?? col.minWidth}
                      onResizeStart={handleResizeStart}
                    />
                  ))}
                </SortableContext>
                {canEdit && <th className="px-3 py-2" style={{ width: 50 }} />}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={orderedColumns.length + (canEdit ? 1 : 0)} className="px-3 py-8 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={orderedColumns.length + (canEdit ? 1 : 0)} className="px-3 py-8 text-center text-muted-foreground text-sm">
                    No entries yet. Click &quot;Add Row&quot; or upload a file to get started.
                  </td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                    {orderedColumns.map((col) => (
                      <td key={col.field} className="px-4 py-4 whitespace-nowrap overflow-hidden text-ellipsis">
                        {col.field === 'password' ? (
                          <PasswordCell
                            account={account}
                            visible={visiblePasswords.has(account.id)}
                            onToggle={() => togglePassword(account.id)}
                            editing={editingCell?.id === account.id && editingCell?.field === 'password'}
                            editValue={editValue}
                            canEdit={canEdit}
                            onStartEdit={() => { setEditingCell({ id: account.id, field: 'password' }); setEditValue(account.password ?? ''); }}
                            onEditChange={setEditValue}
                            onSave={(v) => saveEdit(account.id, 'password', v)}
                            onCancel={() => setEditingCell(null)}
                          />
                        ) : (
                          <EditableCell
                            value={(account as unknown as Record<string, string | null>)[col.field] ?? ''}
                            editing={editingCell?.id === account.id && editingCell?.field === col.field}
                            editValue={editValue}
                            canEdit={canEdit}
                            onStartEdit={() => {
                              const v = (account as unknown as Record<string, string | null>)[col.field] ?? '';
                              setEditingCell({ id: account.id, field: col.field });
                              setEditValue(v);
                            }}
                            onEditChange={setEditValue}
                            onSave={(v) => saveEdit(account.id, col.field, v)}
                            onCancel={() => setEditingCell(null)}
                          />
                        )}
                      </td>
                    ))}
                    {canEdit && (
                      <td className="px-4 py-4 whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(account)}
                          className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all h-8 w-8"
                          title="Delete row"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </DndContext>
      </div>

      {/* Column hint */}
      <p className="mt-2 text-[10px] text-muted-foreground/60">
        Drag column headers to reorder &middot; Resize by dragging column edges &middot; Paste from Google Sheets / Excel with Ctrl+V &middot; Undo with Ctrl+Z
      </p>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EditableCell({
  value, editing, editValue, canEdit,
  onStartEdit, onEditChange, onSave, onCancel,
}: {
  value: string;
  editing: boolean;
  editValue: string;
  canEdit: boolean;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={editValue}
        onChange={(e) => onEditChange(e.target.value)}
        onBlur={() => onSave(editValue)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(editValue);
          if (e.key === 'Escape') onCancel();
        }}
        className="w-full min-w-[80px] px-1 py-0.5 bg-background border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
    );
  }
  if (!canEdit) {
    return <span className="text-xs">{value || <span className="text-muted-foreground/40">—</span>}</span>;
  }
  return (
    <span
      onClick={onStartEdit}
      className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded text-xs block min-h-5 min-w-[60px]"
    >
      {value || <span className="text-muted-foreground/30">—</span>}
    </span>
  );
}

function PasswordCell({
  account, visible, onToggle, editing, editValue, canEdit,
  onStartEdit, onEditChange, onSave, onCancel,
}: {
  account: ProjectAccount;
  visible: boolean;
  onToggle: () => void;
  editing: boolean;
  editValue: string;
  canEdit: boolean;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const stored = account.password ?? '';

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={editValue}
        onChange={(e) => onEditChange(e.target.value)}
        onBlur={() => onSave(editValue)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(editValue);
          if (e.key === 'Escape') onCancel();
        }}
        className="w-full min-w-[80px] px-1 py-0.5 bg-background border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
    );
  }

  return (
    <div className="flex items-center gap-1">
      {canEdit ? (
        <span
          onClick={onStartEdit}
          className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded text-xs block min-w-[60px]"
        >
          {stored ? (visible ? stored : '••••••') : <span className="text-muted-foreground/30">—</span>}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {stored ? (visible ? stored : '••••••') : '—'}
        </span>
      )}
      {stored && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground shrink-0 h-6 w-6"
          title={visible ? 'Hide' : 'Show'}
        >
          {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </Button>
      )}
    </div>
  );
}
