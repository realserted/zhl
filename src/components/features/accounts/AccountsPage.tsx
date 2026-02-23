'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { ProjectPermission } from '@/lib/types/project';
import { logUserAction } from '@/lib/db/user-logs';
import { Trash2, Lock, Hash, Eye, EyeOff, ShieldAlert, UserPlus, X, Loader2 } from 'lucide-react';

interface AccountRow {
  id: string;
  user_id: string;
  display_name: string;
  email: string;
  phone: string | null;
  descriptor: string | null;
  company_name: string | null;
  person_name: string | null;
  username: string | null;
  password_hash: string | null;
  account_number: string | null;
  notes: string | null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

interface AccountsPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null;
}

export default function AccountsPage({ selectedProjectId, userPermission }: AccountsPageProps) {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [newUserForm, setNewUserForm] = useState({
    displayName: '',
    email: '',
    phone: '',
    password: '',
    descriptor: '',
    companyName: '',
    personName: '',
    username: '',
    accountNumber: '',
    notes: '',
  });
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());

  const displayNameRef = useRef('Unknown');
  const userEmailRef = useRef('');

  const permLevel = userPermission?.perm_accounts ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;

  useEffect(() => {
    if (!user) return;
    userEmailRef.current = user.email || '';
    supabase
      .from('accounts')
      .select('is_admin, display_name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setIsAdmin(data?.is_admin === true);
        displayNameRef.current = data?.display_name || user.email || 'Unknown';
      });
  }, [user]);

  // Load all accounts from the accounts table
  useEffect(() => {
    if (!selectedProjectId || isAdmin === null) return;
    loadAccounts();
  }, [selectedProjectId, isAdmin]);

  const loadAccounts = async () => {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .order('created_at', { ascending: true });
    if (!error && data) {
      setAccounts(data as AccountRow[]);
    }
  };

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

  const handleCreateUserAccount = async () => {
    if (!user || !isAdmin || !selectedProjectId) return;
    setCreatingUser(true);
    setCreateUserError(null);

    const email = newUserForm.email.trim().toLowerCase();
    const displayName = newUserForm.displayName.trim();
    const password = newUserForm.password;
    const phone = newUserForm.phone.trim();

    if (!email || !displayName || password.length < 6) {
      setCreateUserError('Email, display name, and password (min 6 chars) are required.');
      setCreatingUser(false);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setCreateUserError('Missing admin session. Please sign in again.');
      setCreatingUser(false);
      return;
    }

    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        projectId: selectedProjectId,
        email,
        password,
        displayName,
        phone: phone || null,
        descriptor: newUserForm.descriptor.trim() || null,
        companyName: newUserForm.companyName.trim() || null,
        personName: newUserForm.personName.trim() || null,
        username: newUserForm.username.trim() || null,
        accountNumber: newUserForm.accountNumber.trim() || null,
        notes: newUserForm.notes.trim() || null,
      }),
    });

    const json = await res.json().catch(() => ({} as { error?: string }));
    if (!res.ok) {
      setCreateUserError(json.error ?? 'Failed to create user account.');
      setCreatingUser(false);
      return;
    }

    await loadAccounts();
    setShowCreateUser(false);
    setNewUserForm({
      displayName: '', email: '', phone: '', password: '',
      descriptor: '', companyName: '', personName: '',
      username: '', accountNumber: '', notes: '',
    });
    log(`Created user account "${displayName}" (${email})`);
    setCreatingUser(false);
  };

  const handleDeleteAccount = async (account: AccountRow) => {
    if (!confirm('Delete this account entry? This will NOT delete the authentication user.')) return;
    const { error } = await supabase.from('accounts').delete().eq('id', account.id);
    if (!error) {
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      log(`Deleted account "${account.display_name || 'Untitled'}"`);
    }
  };

  const saveInlineEdit = async (accountId: string, field: string, value: string) => {
    setEditingCell(null);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    const oldValue = (account as unknown as Record<string, string | null>)[field] ?? '';
    if (value === oldValue) return;

    const { error } = await supabase
      .from('accounts')
      .update({ [field]: value || null })
      .eq('id', accountId);

    if (!error) {
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountId ? { ...a, [field]: value || null } : a))
      );
      const label = columns.find((c) => c.field === field)?.label ?? field;
      log(`Updated ${label} on account "${account.display_name || 'Untitled'}"`);
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

  // Column definitions — maps to `accounts` table fields
  const columns: { field: string; label: string; icon?: 'lock' | 'hash'; sensitive?: boolean; readonly?: boolean }[] = [
    { field: 'display_name', label: 'Account' },
    { field: 'descriptor', label: 'Descriptor' },
    { field: 'company_name', label: 'Company Name' },
    { field: 'person_name', label: 'Person Name' },
    { field: 'phone', label: 'Phone' },
    { field: 'email', label: 'Email' },
    { field: 'username', label: 'USERNAME', icon: 'lock', sensitive: true },
    { field: 'password_hash', label: 'PASSWORD', icon: 'lock', sensitive: true, readonly: true },
    { field: 'account_number', label: 'Account Number', icon: 'hash', sensitive: true },
    { field: 'notes', label: 'NOTES' },
  ];

  const EditableCell = ({
    account,
    field,
    displayValue,
    isReadonly,
  }: {
    account: AccountRow;
    field: string;
    displayValue: string;
    isReadonly?: boolean;
  }) => {
    const isEditing = editingCell?.id === account.id && editingCell?.field === field;

    if (isEditing && !isReadonly) {
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

    if (!canEdit || isReadonly) {
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

  const renderCell = (account: AccountRow, col: typeof columns[number]) => {
    const value = (account as unknown as Record<string, string | null>)[col.field] ?? '';

    // Password field — show masked, not editable (managed by Supabase Auth)
    if (col.field === 'password_hash') {
      const display = value && value !== 'managed_by_supabase_auth' ? value : '';
      const isVisible = visiblePasswords.has(account.id);
      const masked = display ? '••••••' : 'Auth managed';

      return (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{isVisible ? display || 'Auth managed' : masked}</span>
          {display && (
            <button
              onClick={() => togglePasswordVisibility(account.id)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              title={isVisible ? 'Hide' : 'Show'}
            >
              {isVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          )}
        </div>
      );
    }

    return <EditableCell account={account} field={col.field} displayValue={value} isReadonly={col.readonly} />;
  };

  if (!selectedProjectId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Select a project to view accounts.
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Access denied. Accounts is restricted to admins only.
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
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold">Project Account Vault</h2>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button
              onClick={() => setShowCreateUser(true)}
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-accent hover:text-accent/80 transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              Create User Account
            </button>
          )}
        </div>
      </div>
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
              {canEdit && isAdmin && (
                <th className="px-3 py-2 text-xs font-semibold text-foreground w-10"></th>
              )}
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (canEdit && isAdmin ? 1 : 0)}
                  className="px-3 py-8 text-center text-muted-foreground text-sm"
                >
                  No accounts yet.
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
                  {canEdit && isAdmin && (
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
      {createUserError && <p className="mt-2 text-xs text-destructive">{createUserError}</p>}

      {showCreateUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Create User Account</h2>
              <button onClick={() => setShowCreateUser(false)} className="p-1 hover:bg-muted rounded">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Display name *"
                value={newUserForm.displayName}
                onChange={(e) => setNewUserForm((prev) => ({ ...prev, displayName: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm"
              />
              <input
                type="email"
                placeholder="Email *"
                value={newUserForm.email}
                onChange={(e) => setNewUserForm((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm"
              />
              <input
                type="password"
                placeholder="Password (min 6 chars) *"
                value={newUserForm.password}
                onChange={(e) => setNewUserForm((prev) => ({ ...prev, password: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm"
              />
              <input
                type="text"
                placeholder="Phone (optional)"
                value={newUserForm.phone}
                onChange={(e) => setNewUserForm((prev) => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm"
              />
              <input
                type="text"
                placeholder="Descriptor (optional)"
                value={newUserForm.descriptor}
                onChange={(e) => setNewUserForm((prev) => ({ ...prev, descriptor: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm"
              />
              <input
                type="text"
                placeholder="Company name (optional)"
                value={newUserForm.companyName}
                onChange={(e) => setNewUserForm((prev) => ({ ...prev, companyName: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm"
              />
              <input
                type="text"
                placeholder="Person name (optional)"
                value={newUserForm.personName}
                onChange={(e) => setNewUserForm((prev) => ({ ...prev, personName: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm"
              />
              <input
                type="text"
                placeholder="Username (optional)"
                value={newUserForm.username}
                onChange={(e) => setNewUserForm((prev) => ({ ...prev, username: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm"
              />
              <input
                type="text"
                placeholder="Account number (optional)"
                value={newUserForm.accountNumber}
                onChange={(e) => setNewUserForm((prev) => ({ ...prev, accountNumber: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm"
              />
              <textarea
                placeholder="Notes (optional)"
                value={newUserForm.notes}
                onChange={(e) => setNewUserForm((prev) => ({ ...prev, notes: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm resize-none"
              />
              {createUserError && <p className="text-xs text-destructive">{createUserError}</p>}
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleCreateUserAccount}
                disabled={creatingUser}
                className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {creatingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Create User
              </button>
              <button
                onClick={() => setShowCreateUser(false)}
                className="px-4 py-2 border border-input rounded-lg text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
