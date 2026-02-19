'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../lib/auth-context';
import { supabase } from '../../lib/supabase';
import { ProjectPermission } from '../../lib/types/project';
import { ProjectAccount } from '../../lib/types/project-account';
import {
  getProjectAccounts,
  createProjectAccount,
  updateProjectAccount,
  deleteProjectAccount,
} from '../../lib/db/project-accounts';
import { logUserAction } from '../../lib/db/user-logs';
import { Plus, Trash2, Lock, Hash, Eye, EyeOff, ExternalLink, ShieldAlert } from 'lucide-react';

interface AccountsPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null;
}

export default function AccountsPage({ selectedProjectId, userPermission }: AccountsPageProps) {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<ProjectAccount[]>([]);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());

  // Refs for display name / email (avoid stale closures in async callbacks)
  const displayNameRef = useRef('Unknown');
  const userEmailRef = useRef('');

  // Permission handling
  const permLevel = userPermission?.perm_accounts ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;

  // Load user display name
  useEffect(() => {
    if (!user) return;
    userEmailRef.current = user.email || '';
    supabase
      .from('accounts')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        displayNameRef.current = data?.display_name || user.email || 'Unknown';
      });
  }, [user]);

  // Load accounts when project changes
  useEffect(() => {
    if (!selectedProjectId) { setAccounts([]); return; }
    getProjectAccounts(selectedProjectId).then(setAccounts);
  }, [selectedProjectId]);

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

  const handleAddAccount = async () => {
    if (!selectedProjectId || !user) return;
    const newAccount = await createProjectAccount(selectedProjectId, user.id);
    if (newAccount) {
      setAccounts((prev) => [...prev, newAccount]);
      log('Added a new account entry');
    }
  };

  const handleDeleteAccount = async (account: ProjectAccount) => {
    if (!confirm('Delete this account entry?')) return;
    const ok = await deleteProjectAccount(account.id);
    if (ok) {
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      log(`Deleted account "${account.account_name || 'Untitled'}"`);
    }
  };

  const saveInlineEdit = async (accountId: string, field: string, value: string) => {
    setEditingCell(null);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    const oldValue = (account as unknown as Record<string, string | null>)[field] ?? '';
    if (value === oldValue) return;

    const ok = await updateProjectAccount(accountId, field, value || null);
    if (ok) {
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountId ? { ...a, [field]: value || null } : a))
      );
      const label = columns.find((c) => c.field === field)?.label ?? field;
      log(`Updated ${label} on account "${account.account_name || 'Untitled'}"`);
    }
  };

  const togglePasswordVisibility = (accountId: string) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  // Column definitions
  const columns: { field: string; label: string; icon?: 'lock' | 'hash'; sensitive?: boolean }[] = [
    { field: 'account_name', label: 'Account' },
    { field: 'descriptor', label: 'Descriptor' },
    { field: 'company_name', label: 'Company Name' },
    { field: 'person_name', label: 'Person Name' },
    { field: 'phone', label: 'Phone' },
    { field: 'email', label: 'Email' },
    { field: 'link', label: 'Link' },
    { field: 'username', label: 'USERNAME', icon: 'lock', sensitive: true },
    { field: 'password', label: 'PASSWORD', icon: 'lock', sensitive: true },
    { field: 'account_number', label: 'Account Number', icon: 'hash', sensitive: true },
    { field: 'notes', label: 'NOTES' },
  ];

  // Editable cell component
  const EditableCell = ({
    account,
    field,
    displayValue,
  }: {
    account: ProjectAccount;
    field: string;
    displayValue: string;
  }) => {
    const isEditing = editingCell?.id === account.id && editingCell?.field === field;

    if (isEditing) {
      return (
        <input
          autoFocus
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => saveInlineEdit(account.id, field, editValue)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveInlineEdit(account.id, field, editValue);
            if (e.key === 'Escape') setEditingCell(null);
          }}
          className="w-full px-1 py-0.5 bg-background border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      );
    }

    if (!canEdit) {
      return <span className="text-xs">{displayValue || <span className="text-muted-foreground/40">-</span>}</span>;
    }

    return (
      <span
        onClick={() => {
          setEditingCell({ id: account.id, field });
          setEditValue(displayValue);
        }}
        className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded text-xs block min-h-[1.25rem]"
      >
        {displayValue || <span className="text-muted-foreground/40">-</span>}
      </span>
    );
  };

  // Render a cell based on column type
  const renderCell = (account: ProjectAccount, col: typeof columns[number]) => {
    const value = (account as unknown as Record<string, string | null>)[col.field] ?? '';

    // Password field — masked display with toggle
    if (col.field === 'password') {
      const isVisible = visiblePasswords.has(account.id);
      const masked = value ? '••••••' : '';
      const display = isVisible ? value : masked;

      return (
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <EditableCell account={account} field={col.field} displayValue={isVisible ? value : value} />
          </div>
          {value && (
            <button
              onClick={() => togglePasswordVisibility(account.id)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              title={isVisible ? 'Hide password' : 'Show password'}
            >
              {isVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          )}
        </div>
      );
    }

    // Link field — clickable when filled
    if (col.field === 'link' && value && !editingCell?.id) {
      return (
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <EditableCell account={account} field={col.field} displayValue={value} />
          </div>
          <a
            href={value.startsWith('http') ? value : `https://${value}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent/80 shrink-0"
            title="Open link"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      );
    }

    // Password field when editing — show actual value
    if (col.field === 'password' && editingCell?.id === account.id && editingCell?.field === 'password') {
      return <EditableCell account={account} field={col.field} displayValue={value} />;
    }

    return <EditableCell account={account} field={col.field} displayValue={value} />;
  };

  if (!selectedProjectId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Select a project to view accounts.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      {/* Security Notice */}
      <div className="mb-6 flex items-center gap-2 text-amber-500 dark:text-amber-400">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">
          This page is highly secure and encrypted - only authorized users can view.
        </span>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {columns.map((col) => (
                <th
                  key={col.field}
                  className="px-3 py-2 text-left text-xs font-semibold text-foreground whitespace-nowrap"
                >
                  <div className="flex items-center gap-1">
                    {col.icon === 'lock' && <Lock className="h-3 w-3 text-amber-500" />}
                    {col.icon === 'hash' && <Hash className="h-3 w-3 text-blue-500" />}
                    {col.label}
                  </div>
                </th>
              ))}
              {canEdit && (
                <th className="px-3 py-2 text-xs font-semibold text-foreground w-10"></th>
              )}
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (canEdit ? 1 : 0)}
                  className="px-3 py-8 text-center text-muted-foreground text-sm"
                >
                  No accounts yet.{canEdit ? ' Click "+ Add Account" to add one.' : ''}
                </td>
              </tr>
            ) : (
              accounts.map((account) => (
                <tr key={account.id} className="border-b border-border hover:bg-muted/30">
                  {columns.map((col) => (
                    <td key={col.field} className="px-3 py-2 min-w-[100px]">
                      {renderCell(account, col)}
                    </td>
                  ))}
                  {canEdit && (
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleDeleteAccount(account)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete account"
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

      {/* Add Account button */}
      {canEdit && (
        <button
          onClick={handleAddAccount}
          className="mt-4 flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Account
        </button>
      )}
    </div>
  );
}
