'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { ProjectPermission } from '@/lib/types/project';
import {
  Trash2, Lock, Hash, Eye, EyeOff, ShieldAlert,
  PlusCircle, Upload, Loader2, X,
} from 'lucide-react';
import * as XLSX from 'xlsx';

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

const COLUMNS: {
  field: keyof ProjectAccount;
  label: string;
  icon?: 'lock' | 'hash';
  sensitive?: boolean;
  minWidth?: number;
}[] = [
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

  const permLevel = userPermission?.perm_accounts ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;

  useEffect(() => {
    if (!selectedProjectId) { setAccounts([]); return; }
    loadAccounts();
  }, [selectedProjectId]);

  const loadAccounts = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('project_accounts')
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

  // Add a blank row
  const handleAddRow = async () => {
    if (!selectedProjectId) return;
    setAddingRow(true);
    setImportMessage(null);
    const { data, error } = await supabase
      .from('project_accounts')
      .insert({ project_id: selectedProjectId })
      .select()
      .single();
    setAddingRow(false);
    if (error) {
      console.error('Error adding row:', error);
      setImportMessage({ text: `Failed to add row: ${error.message ?? error.code ?? 'RLS policy blocked the request'}`, ok: false });
      return;
    }
    if (data) {
      setAccounts((prev) => [...prev, data as ProjectAccount]);
    }
  };

  // Delete a row
  const handleDelete = async (account: ProjectAccount) => {
    if (!confirm('Delete this account entry?')) return;
    const { error } = await supabase.from('project_accounts').delete().eq('id', account.id);
    if (!error) {
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
    }
  };

  // Inline edit save
  const saveEdit = async (accountId: string, field: string, value: string) => {
    setEditingCell(null);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    const oldValue = (account as unknown as Record<string, string | null>)[field] ?? '';
    if (value === oldValue) return;

    const { error } = await supabase
      .from('project_accounts')
      .update({ [field]: value || null })
      .eq('id', accountId);

    if (!error) {
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountId ? { ...a, [field]: value || null } : a))
      );
    }
  };

  const togglePassword = (id: string) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Excel / CSV upload
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

      // Map headers to fields
      const firstRow = rows[0];
      const headerToField: Record<string, keyof ProjectAccount> = {};
      for (const rawHeader of Object.keys(firstRow)) {
        const normalized = rawHeader.trim().toLowerCase();
        const mapped = HEADER_MAP[normalized];
        if (mapped) headerToField[rawHeader] = mapped;
      }

      const inserts = rows.map((row) => {
        const entry: Record<string, string | null> = {
          project_id: selectedProjectId,
        };
        for (const [rawHeader, field] of Object.entries(headerToField)) {
          const val = String(row[rawHeader] ?? '').trim();
          entry[field as string] = val || null;
        }
        return entry;
      });

      const { error } = await supabase.from('project_accounts').insert(inserts);
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
      {/* Security Notice */}
      <div className="mb-4 flex items-center gap-2 text-amber-500 dark:text-amber-400">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">
          This page is highly secure — only authorized project members can view.
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold">Project Account Vault</h2>
        {canEdit && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleAddRow}
              disabled={addingRow}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
            >
              {addingRow ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
              Add Row
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
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
          <button onClick={() => setImportMessage(null)}><X className="h-3 w-3" /></button>
        </div>
      )}

      {/* Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="text-sm border-collapse" style={{ tableLayout: 'auto', minWidth: '100%' }}>
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {COLUMNS.map((col) => (
                <th
                  key={col.field}
                  className="px-3 py-2 text-left text-xs font-semibold text-foreground whitespace-nowrap"
                  style={{ minWidth: col.minWidth }}
                >
                  <div className="flex items-center gap-1">
                    {col.icon === 'lock' && <Lock className="h-3 w-3 text-amber-500" />}
                    {col.icon === 'hash' && <Hash className="h-3 w-3 text-blue-500" />}
                    {col.label}
                  </div>
                </th>
              ))}
              {canEdit && <th className="px-3 py-2 w-8" />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLUMNS.length + (canEdit ? 1 : 0)} className="px-3 py-8 text-center">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + (canEdit ? 1 : 0)} className="px-3 py-8 text-center text-muted-foreground text-sm">
                  No entries yet. Click &quot;Add Row&quot; or upload a file to get started.
                </td>
              </tr>
            ) : (
              accounts.map((account) => (
                <tr key={account.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  {COLUMNS.map((col) => (
                    <td key={col.field} className="px-3 py-1.5">
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
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => handleDelete(account)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete row"
                      >
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

      {/* Column hint */}
      <p className="mt-2 text-[10px] text-muted-foreground/60">
        Excel/CSV column headers recognised: Account, Descriptor, Company Name, Person Name, Phone, Email, Link, Username, Password, Account Number, Notes
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
      className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded text-xs block min-h-[1.25rem] min-w-[60px]"
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
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground shrink-0" title={visible ? 'Hide' : 'Show'}>
          {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}
