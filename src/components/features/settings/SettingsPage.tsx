'use client';

import { Plus, ToggleLeft, Check, X, Loader2, Trash2 } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Project, ProjectPermission } from '@/lib/types/project';
import {
  createProject as createProjectDb,
  deleteProject as deleteProjectDb,
  updateProjectStatus,
  getProjectPermissions,
  addProjectUser,
  updatePermission,
  removeProjectUser,
} from '@/lib/db/projects';
import { logUserAction } from '@/lib/db/user-logs';
import { createNotification } from '@/lib/db/notifications';
import {
  getProjectSettings,
  saveProjectSettings,
  DEFAULT_PROJECT_SETTINGS,
  type ProjectSettings,
} from '@/lib/db/project-settings';
import { submitAdminRequest } from '@/lib/db/admin-requests';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';

type EditingField = 'displayName' | 'phone' | 'email' | 'password' | null;

interface SettingsPageProps {
  selectedProjectId: string | null;
  selectedProjectName?: string | null;
  selectedProjectStatus?: Project['status'] | null;
  onProjectCreated?: (project: Project) => void;
  onProjectDeleted?: (projectId: string) => void;
  onProjectStatusChange?: (projectId: string, status: Project['status']) => void;
  userPermission?: ProjectPermission | null; // null = owner (full access)
}

export default function SettingsPage({ selectedProjectId, selectedProjectName, selectedProjectStatus, onProjectCreated, onProjectDeleted, onProjectStatusChange, userPermission }: SettingsPageProps) {
  const { user } = useAuth();

  // Account fields loaded from DB
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Send request to admin
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [requestFeedback, setRequestFeedback] = useState('');

  // Editing state
  const [editingField, setEditingField] = useState<EditingField>(null);
  const [editValue, setEditValue] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ field: string; message: string; type: 'success' | 'error' } | null>(null);

  // Load account data from Supabase on mount
  useEffect(() => {
    if (!user) return;
    async function loadAccount() {
      const { data } = await supabase
        .from('zhl_accounts')
        .select('display_name, phone, email')
        .eq('user_id', user!.id)
        .single();
      if (data) {
        setDisplayName(data.display_name);
        setPhone(data.phone || '');
        setEmail(data.email);
      } else {
        // Fallback to auth metadata
        setDisplayName(user!.user_metadata?.display_name || '');
        setEmail(user!.email || '');
        setPhone(user!.user_metadata?.phone || '');
      }
    }
    loadAccount();
  }, [user]);

  const startEdit = (field: EditingField) => {
    setEditingField(field);
    setFeedback(null);
    if (field === 'displayName') setEditValue(displayName);
    else if (field === 'phone') setEditValue(phone);
    else if (field === 'email') setEditValue(email);
    else if (field === 'password') {
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSubmitRequest = async () => {
    if (!user || !requestMessage.trim()) return;
    setSubmittingRequest(true);
    const ok = await submitAdminRequest(user.id, displayName, email, requestMessage.trim());
    if (ok) {
      setRequestFeedback('Request sent to admin!');
      setRequestMessage('');
      setTimeout(() => { setShowRequestForm(false); setRequestFeedback(''); }, 2500);
    } else {
      setRequestFeedback('Failed to send. Please try again.');
    }
    setSubmittingRequest(false);
  };

  const saveField = async (field: EditingField) => {
    if (!user || !field) return;
    setSaving(true);
    setFeedback(null);

    try {
      if (field === 'displayName') {
        const trimmed = editValue.trim();
        if (!trimmed) { setFeedback({ field, message: 'Display name cannot be empty', type: 'error' }); setSaving(false); return; }
        // Update accounts table
        const { error: dbErr } = await supabase.from('zhl_accounts').update({ display_name: trimmed }).eq('user_id', user.id);
        if (dbErr) throw dbErr;
        // Update auth metadata
        await supabase.auth.updateUser({ data: { display_name: trimmed } });
        setDisplayName(trimmed);
        setFeedback({ field, message: 'Display name updated', type: 'success' });

      } else if (field === 'phone') {
        const trimmed = editValue.trim();
        const { error: dbErr } = await supabase.from('zhl_accounts').update({ phone: trimmed || null }).eq('user_id', user.id);
        if (dbErr) throw dbErr;
        await supabase.auth.updateUser({ data: { phone: trimmed || null } });
        setPhone(trimmed);
        setFeedback({ field, message: 'Phone number updated', type: 'success' });

      } else if (field === 'email') {
        const trimmed = editValue.trim();
        if (!trimmed) { setFeedback({ field, message: 'Email cannot be empty', type: 'error' }); setSaving(false); return; }
        // Update Supabase Auth email (sends confirmation)
        const { error: authErr } = await supabase.auth.updateUser({ email: trimmed });
        if (authErr) throw authErr;
        // Update accounts table
        const { error: dbErr } = await supabase.from('zhl_accounts').update({ email: trimmed }).eq('user_id', user.id);
        if (dbErr) throw dbErr;
        setEmail(trimmed);
        setFeedback({ field, message: 'Email updated. Check your inbox to confirm.', type: 'success' });

      } else if (field === 'password') {
        if (newPassword.length < 6) { setFeedback({ field, message: 'Password must be at least 6 characters', type: 'error' }); setSaving(false); return; }
        if (newPassword !== confirmPassword) { setFeedback({ field, message: 'Passwords do not match', type: 'error' }); setSaving(false); return; }
        const { error: authErr } = await supabase.auth.updateUser({ password: newPassword });
        if (authErr) throw authErr;
        setFeedback({ field, message: 'Password updated', type: 'success' });
      }

      setEditingField(null);
      setEditValue('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setFeedback({ field, message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  // Permission flags — null userPermission means owner (full access)
  const isProjectOwner = !userPermission;
  const canManagePerms = isProjectOwner || (userPermission?.project_role?.includes('Project Manager') ?? false);

  // ===== PROJECT & PERMISSIONS STATE =====
  const [permissions, setPermissions] = useState<ProjectPermission[]>([]);
  const [loadingPerms, setLoadingPerms] = useState(false);

  // Create project modal
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  // Add user modal
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [lookingUpName, setLookingUpName] = useState(false);
  const [emailNotFound, setEmailNotFound] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [newUserPerms, setNewUserPerms] = useState<Record<string, string>>({
    perm_taskers: 'View',
    perm_unit_data: 'View',
    perm_files: 'View',
    perm_accounts: 'View',
    perm_reports: 'View',
    perm_templates: 'View Only',
    perm_meetings: 'View',
    perm_user_logs: "View / Don't view",
    project_role: 'Project Manager (can change all permissions on a project)',
    work_role: 'Administrative',
    unit_data_view: 'All Project Users',
  });

  // Load permissions when selected project changes
  const loadPermissions = useCallback(async (projectId: string) => {
    setLoadingPerms(true);
    const data = await getProjectPermissions(projectId);
    setPermissions(data);
    setLoadingPerms(false);
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadPermissions(selectedProjectId);
    } else {
      setPermissions([]);
    }
  }, [selectedProjectId, loadPermissions]);

  const handleCreateProject = async () => {
    if (!user || !newProjectName.trim()) return;
    setCreatingProject(true);
    const project = await createProjectDb(newProjectName.trim(), user.id);
    if (project) {
      onProjectCreated?.(project);
      logUserAction({ projectId: project.id, userId: user.id, userName: displayName, userEmail: email, action: `Created project "${project.name}"` });
      setNewProjectName('');
      setShowCreateProject(false);
    }
    setCreatingProject(false);
  };

  const [deletingProject, setDeletingProject] = useState(false);

  const PROJECT_STATUSES: Project['status'][] = ['Critical', 'Problematic', 'Needs Attention', 'Good', 'Excellent'];
  const [savingStatus, setSavingStatus] = useState(false);

  const handleStatusChange = async (newStatus: Project['status']) => {
    if (!selectedProjectId) return;
    setSavingStatus(true);
    const ok = await updateProjectStatus(selectedProjectId, newStatus);
    if (ok) {
      onProjectStatusChange?.(selectedProjectId, newStatus);
    }
    setSavingStatus(false);
  };

  const handleDeleteProject = async () => {
    if (!selectedProjectId || !user) return;
    const confirmed = window.confirm(
      'Are you sure you want to delete this project? This will permanently remove all project data including permissions, unit data, files, and financials. This cannot be undone.'
    );
    if (!confirmed) return;
    setDeletingProject(true);
    const ok = await deleteProjectDb(selectedProjectId);
    if (ok) {
      onProjectDeleted?.(selectedProjectId);
    }
    setDeletingProject(false);
  };

  // Auto-lookup display name when email changes
  const emailLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (emailLookupTimer.current) clearTimeout(emailLookupTimer.current);
    setNewUserName('');
    setEmailNotFound(false);
    const trimmed = newUserEmail.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    setLookingUpName(true);
    emailLookupTimer.current = setTimeout(async () => {
      const { data } = await supabase.rpc('lookup_display_name_by_email', { p_email: trimmed });
      if (data) {
        setNewUserName(data as string);
        setEmailNotFound(false);
      } else {
        setNewUserName('');
        setEmailNotFound(true);
      }
      setLookingUpName(false);
    }, 500);
    return () => { if (emailLookupTimer.current) clearTimeout(emailLookupTimer.current); };
  }, [newUserEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddUser = async () => {
    if (!selectedProjectId || !newUserName.trim() || !newUserEmail.trim()) return;
    setAddingUser(true);
    const perm = await addProjectUser(selectedProjectId, newUserName.trim(), newUserEmail.trim());
    if (perm) {
      // Apply the preset permissions chosen in the modal
      const updates = Object.entries(newUserPerms).map(([field, value]) =>
        updatePermission(perm.id, field, value)
      );
      await Promise.all(updates);
      // Build the full record with preset values so the table shows correct data immediately
      const fullPerm: ProjectPermission = { ...perm, ...newUserPerms } as ProjectPermission;
      setPermissions((prev) => [...prev, fullPerm]);
      if (user) {
        logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayName, userEmail: email, action: `Added user "${newUserName.trim()}" to project` });
      }
      // Notify the added user if they have an account (user_id known)
      if (perm.user_id && perm.user_id !== user?.id) {
        createNotification({
          userId: perm.user_id,
          type: 'project_access',
          title: 'Added to Project',
          message: `You were added to the project "${selectedProjectName ?? 'Unknown Project'}" by ${displayName}`,
          relatedId: selectedProjectId ?? undefined,
          relatedType: 'project',
        }).catch(() => {});
      }
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPerms({
        perm_taskers: 'View',
        perm_unit_data: 'View',
        perm_files: 'View',
        perm_accounts: 'View',
        perm_reports: 'View',
        perm_templates: 'View Only',
        perm_meetings: 'View',
        perm_user_logs: "View / Don't view",
        project_role: 'Project Manager (can change all permissions on a project)',
        work_role: 'Administrative',
        unit_data_view: 'All Project Users',
      });
      setShowAddUser(false);
    }
    setAddingUser(false);
  };

  const handlePermChange = async (permId: string, field: string, value: string) => {
    // Optimistic update
    setPermissions((prev) =>
      prev.map((p) => (p.id === permId ? { ...p, [field]: value } : p))
    );
    await updatePermission(permId, field, value);
  };

  const handleRemoveUser = async (permId: string) => {
    const perm = permissions.find((p) => p.id === permId);
    const ok = await removeProjectUser(permId);
    if (ok) {
      setPermissions((prev) => prev.filter((p) => p.id !== permId));
      if (user && selectedProjectId && perm) {
        logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayName, userEmail: email, action: `Removed user "${perm.user_name}" from project` });
      }
    }
  };

  // Permission column definitions
  const permColumns: { key: keyof ProjectPermission; label: string; options: string[] }[] = [
    { key: 'perm_taskers', label: 'TASKERS', options: ['View', 'Edit', 'Admin'] },
    { key: 'perm_unit_data', label: 'UNIT DATA', options: ['View', 'Edit', 'Admin'] },
    { key: 'perm_files', label: 'FILES', options: ['View', 'Edit', 'Admin'] },
    { key: 'perm_accounts', label: 'ACCOUNTS', options: ['View', 'Edit', 'Admin'] },
    { key: 'perm_reports', label: 'REPORTS', options: ['View', 'Edit', 'Admin'] },
    { key: 'perm_templates', label: 'TEMPLATES', options: ['View Only', 'Suggest Change', 'View Suggested Change', 'Approve Changes', 'Edit'] },
    { key: 'perm_meetings', label: 'MEETINGS', options: ['View', 'Edit', 'Admin'] },
    { key: 'perm_user_logs', label: 'USER LOGS', options: ["View / Don't view"] },
  ];

  const projectRoleOptions = [
    'Project Owner',
    'Transfer Ownership (Only 1 owner on each project)',
    'Project Manager (can change all permissions on a project)',
    'Property Manager (coming soon)',
    'Limited Partner (no view perms, only receives emailed reports)',
    'Accountant (views financial records only)',
  ];

  const workRoleOptions = ['Administrative', 'Capex', 'Financial', 'Legal', 'Management', 'Misc', 'Strategic', 'Workflow'];

  const selectClass = 'border border-input rounded px-2 py-1 bg-background text-foreground text-xs';

  // ── Project settings (thresholds + feature flags) ──────────────────────────
  const [projectSettings, setProjectSettings] = useState<Omit<ProjectSettings, 'id' | 'project_id'>>(
    DEFAULT_PROJECT_SETTINGS
  );
  const [savingSettings, setSavingSettings] = useState(false);

  // Load settings whenever the selected project changes
  useEffect(() => {
    if (!selectedProjectId) return;
    getProjectSettings(selectedProjectId).then((s) => {
      setProjectSettings(s);
    });
  }, [selectedProjectId]);

  // ── Current metrics (real data for STATUS THRESHOLDS) ──────────────────────
  const [currentMetrics, setCurrentMetrics] = useState<{
    overdueCount: number | null;
    noCommentsCount: number | null;
    unitDataPercent: number | null;
  }>({ overdueCount: null, noCommentsCount: null, unitDataPercent: null });

  useEffect(() => {
    if (!selectedProjectId) {
      setCurrentMetrics({ overdueCount: null, noCommentsCount: null, unitDataPercent: null });
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    (async () => {
      // 1. Overdue active taskers
      const { count: overdueCount } = await supabase
        .from('zhl_taskers')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', selectedProjectId)
        .not('status', 'in', '("Archived","Complete")')
        .not('due_date', 'is', null)
        .lt('due_date', today);

      // 2. Active taskers without any comments
      const { data: activeTaskers } = await supabase
        .from('zhl_taskers')
        .select('id')
        .eq('project_id', selectedProjectId)
        .not('status', 'in', '("Archived","Complete")');
      const activeIds = (activeTaskers ?? []).map((t: { id: string }) => t.id);
      let noCommentsCount = activeIds.length;
      if (activeIds.length > 0) {
        const { data: commentedRows } = await supabase
          .from('zhl_tasker_logs')
          .select('tasker_id')
          .in('tasker_id', activeIds)
          .eq('type', 'comment');
        const commentedSet = new Set((commentedRows ?? []).map((r: { tasker_id: string }) => r.tasker_id));
        noCommentsCount = activeIds.filter((id: string) => !commentedSet.has(id)).length;
      }

      // 3. Unit data % complete
      const { data: projectRows } = await supabase
        .from('zhl_unit_data_rows')
        .select('id')
        .eq('project_id', selectedProjectId);
      const rowIds = (projectRows ?? []).map((r: { id: string }) => r.id);
      let unitDataPercent: number | null = null;
      if (rowIds.length === 0) {
        unitDataPercent = 100;
      } else {
        const { count: fieldCount } = await supabase
          .from('zhl_unit_data_fields')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', selectedProjectId);
        const totalPossible = rowIds.length * (fieldCount ?? 0);
        if (totalPossible > 0) {
          const { count: valueCount } = await supabase
            .from('zhl_unit_data_values')
            .select('*', { count: 'exact', head: true })
            .in('row_id', rowIds)
            .not('value', 'is', null);
          unitDataPercent = Math.round(((valueCount ?? 0) / totalPossible) * 100);
        } else {
          unitDataPercent = 100;
        }
      }

      setCurrentMetrics({ overdueCount: overdueCount ?? 0, noCommentsCount, unitDataPercent });
    })();
  }, [selectedProjectId]);

  /** Save a single numeric threshold field and update local state. */
  const saveThreshold = async (field: keyof Omit<ProjectSettings, 'id' | 'project_id'>, rawValue: string) => {
    if (!selectedProjectId || !isProjectOwner) return;
    const num = parseInt(rawValue, 10);
    if (isNaN(num) || num < 0) return;
    setSavingSettings(true);
    const ok = await saveProjectSettings(selectedProjectId, { [field]: num });
    if (ok) setProjectSettings((prev) => ({ ...prev, [field]: num }));
    setSavingSettings(false);
  };

  /** Toggle allow_user_customization and persist. */
  const setAllowCustomization = async (value: boolean) => {
    if (!selectedProjectId || !isProjectOwner) return;
    setSavingSettings(true);
    const ok = await saveProjectSettings(selectedProjectId, { allow_user_customization: value });
    if (ok) setProjectSettings((prev) => ({ ...prev, allow_user_customization: value }));
    setSavingSettings(false);
  };


  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* MY ACCOUNT SECTION */}
        <section className="mb-8 sm:mb-12">
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 pb-4 border-b border-border">MY ACCOUNT</h2>

          <div className="space-y-2 sm:space-y-3 sm:ml-6">
            <div className="py-2">
              <p className="text-sm sm:text-base font-semibold">Link Presaling Account</p>
              <p className="text-xs sm:text-sm text-muted-foreground">(auto-links if presaling email is present)</p>
            </div>

            <div className="py-2 px-3 sm:px-4 rounded">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm sm:text-base font-semibold">Google Calendar</span>
                <span className="text-xs text-muted-foreground">Use the calendar icon on each tasker to add it to Google Calendar</span>
              </div>
            </div>

            {/* Change Display Name */}
            <div className="py-2 px-3 sm:px-4 rounded border border-transparent">
              {editingField === 'displayName' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Change Display Name</label>
                  <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} className={inputClass} placeholder="Enter new display name" />
                  <div className="flex items-center gap-2">
                    <Button onClick={() => saveField('displayName')} disabled={saving} size="sm" isLoading={saving && editingField === 'displayName'}>
                      {!saving && <Check className="w-3 h-3 mr-1.5" />} Save
                    </Button>
                    <Button onClick={cancelEdit} variant="outline" size="sm" className="flex items-center gap-1.5">
                      <X className="w-3 h-3 mr-1.5" /> Cancel
                    </Button>
                  </div>
                  {feedback?.field === 'displayName' && (
                    <p className={`text-xs ${feedback.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>{feedback.message}</p>
                  )}
                </div>
              ) : (
                <Button onClick={() => startEdit('displayName')} variant="ghost" className="w-full justify-start text-sm sm:text-base hover:text-primary transition-colors h-auto py-2 px-3 sm:px-4">
                  Change Display Name <span className="text-muted-foreground ml-2">({displayName || '...'})</span>
                </Button>
              )}
            </div>

            {/* Change Phone */}
            <div className="py-2 px-3 sm:px-4 rounded border border-transparent">
              {editingField === 'phone' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Change Phone</label>
                  <input type="tel" value={editValue} onChange={(e) => setEditValue(e.target.value)} className={inputClass} placeholder="(555) 123-4567" />
                  <div className="flex items-center gap-2">
                    <Button onClick={() => saveField('phone')} disabled={saving} size="sm" isLoading={saving && editingField === 'phone'}>
                      {!saving && <Check className="w-3 h-3 mr-1.5" />} Save
                    </Button>
                    <Button onClick={cancelEdit} variant="outline" size="sm">
                      <X className="w-3 h-3 mr-1.5" /> Cancel
                    </Button>
                  </div>
                  {feedback?.field === 'phone' && (
                    <p className={`text-xs ${feedback.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>{feedback.message}</p>
                  )}
                </div>
              ) : (
                <Button onClick={() => startEdit('phone')} variant="ghost" className="w-full justify-start text-sm sm:text-base hover:text-primary transition-colors h-auto py-2 px-3 sm:px-4">
                  Change Phone <span className="text-muted-foreground ml-2">({phone || 'Not set'})</span>
                </Button>
              )}
            </div>

            {/* Change Email */}
            <div className="py-2 px-3 sm:px-4 rounded border border-transparent">
              {editingField === 'email' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Change Email</label>
                  <input type="email" value={editValue} onChange={(e) => setEditValue(e.target.value)} className={inputClass} placeholder="you@example.com" />
                  <div className="flex items-center gap-2">
                    <Button onClick={() => saveField('email')} disabled={saving} size="sm" isLoading={saving && editingField === 'email'}>
                      {!saving && <Check className="w-3 h-3 mr-1.5" />} Save
                    </Button>
                    <Button onClick={cancelEdit} variant="outline" size="sm">
                      <X className="w-3 h-3 mr-1.5" /> Cancel
                    </Button>
                  </div>
                  {feedback?.field === 'email' && (
                    <p className={`text-xs ${feedback.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>{feedback.message}</p>
                  )}
                </div>
              ) : (
                <Button onClick={() => startEdit('email')} variant="ghost" className="w-full justify-start text-sm sm:text-base hover:text-primary transition-colors h-auto py-2 px-3 sm:px-4">
                  Change Email <span className="text-muted-foreground ml-2">({email || '...'})</span>
                </Button>
              )}
            </div>

            {/* Change Password */}
            <div className="py-2 px-3 sm:px-4 rounded border border-transparent">
              {editingField === 'password' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Change Password</label>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} placeholder="New password (min 6 characters)" />
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} placeholder="Confirm new password" />
                  <div className="flex items-center gap-2">
                    <Button onClick={() => saveField('password')} disabled={saving} size="sm" isLoading={saving && editingField === 'password'}>
                      {!saving && <Check className="w-3 h-3 mr-1.5" />} Save
                    </Button>
                    <Button onClick={cancelEdit} variant="outline" size="sm">
                      <X className="w-3 h-3 mr-1.5" /> Cancel
                    </Button>
                  </div>
                  {feedback?.field === 'password' && (
                    <p className={`text-xs ${feedback.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>{feedback.message}</p>
                  )}
                </div>
              ) : (
                <Button onClick={() => startEdit('password')} variant="ghost" className="w-full justify-start text-sm sm:text-base hover:text-primary transition-colors h-auto py-2 px-3 sm:px-4">
                  Change Password
                </Button>
              )}
            </div>

            <Button variant="ghost" className="w-full justify-start text-sm sm:text-base hover:text-primary transition-colors h-auto py-2 px-3 sm:px-4">
              Billing Settings
            </Button>
          </div>
        </section>

        {/* PROJECT SETTINGS SECTION */}
        <section className="mb-8 sm:mb-12">
          <h2 className="text-lg sm:text-xl font-bold mb-6 sm:mb-8 pb-4 border-b border-border flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
            PROJECT SETTINGS
            {!selectedProjectId && (
              <span className="text-sm text-muted-foreground">— Select a project from the navbar</span>
            )}
            <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2">
              <Button
                onClick={() => setShowCreateProject(true)}
                variant="outline"
                className="border-2 border-foreground px-4 sm:px-6 py-2 rounded font-semibold hover:bg-muted transition-colors text-sm sm:text-base h-auto"
              >
                CREATE NEW PROJECT
              </Button>
              {selectedProjectId && isProjectOwner && (
                <Button
                  onClick={handleDeleteProject}
                  disabled={deletingProject}
                  variant="danger"
                  className="border-2 border-destructive text-white px-4 sm:px-6 py-2 rounded font-semibold hover:bg-destructive hover:text-white transition-colors text-sm sm:text-base disabled:opacity-50 h-auto"
                  isLoading={deletingProject}
                >
                  {deletingProject ? 'Deleting...' : 'DELETE PROJECT'}
                </Button>
              )}
            </div>
          </h2>

          {/* Create Project Modal */}
          <Modal
            isOpen={showCreateProject}
            onClose={() => { setShowCreateProject(false); setNewProjectName(''); }}
            title="New Project"
            maxWidth="md"
          >
            <div className="space-y-4">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                className={inputClass}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleCreateProject}
                  disabled={creatingProject || !newProjectName.trim()}
                  isLoading={creatingProject}
                  size="sm"
                >
                  {!creatingProject && <Check className="w-3 h-3 mr-1.5" />} Create
                </Button>
                <Button
                  onClick={() => { setShowCreateProject(false); setNewProjectName(''); }}
                  variant="outline"
                  size="sm"
                >
                  <X className="w-3 h-3 mr-1.5" /> Cancel
                </Button>
              </div>
            </div>
          </Modal>

          {/* Project Status */}
          {selectedProjectId && isProjectOwner && (
            <div className="mb-6 bg-card border border-border rounded-xl p-5 max-w-lg">
              <h3 className="text-sm font-semibold text-foreground mb-3">Project Status</h3>
              <p className="text-xs text-muted-foreground mb-4">Set the overall health status of this project.</p>
              <div className="flex flex-wrap gap-2">
                {PROJECT_STATUSES.map((status) => {
                  const isActive = (selectedProjectStatus ?? 'Good') === status;
                  const colorMap: Record<string, string> = {
                    Critical:       'border-red-500 bg-red-500/10 text-red-500',
                    Problematic:    'border-orange-500 bg-orange-500/10 text-orange-500',
                    'Needs Attention': 'border-yellow-500 bg-yellow-500/10 text-yellow-500',
                    Good:           'border-green-500 bg-green-500/10 text-green-500',
                    Excellent:      'border-blue-500 bg-blue-500/10 text-blue-500',
                  };
                  const idleMap: Record<string, string> = {
                    Critical:       'border-input hover:border-red-500 hover:text-red-500',
                    Problematic:    'border-input hover:border-orange-500 hover:text-orange-500',
                    'Needs Attention': 'border-input hover:border-yellow-500 hover:text-yellow-500',
                    Good:           'border-input hover:border-green-500 hover:text-green-500',
                    Excellent:      'border-input hover:border-blue-500 hover:text-blue-500',
                  };
                  return (
                    <Button
                      key={status}
                      onClick={() => handleStatusChange(status)}
                      disabled={savingStatus}
                      className={`px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-colors disabled:opacity-50 h-auto shadow-none ${
                        isActive ? colorMap[status] : `text-muted-foreground ${idleMap[status]}`
                      }`}
                      variant="ghost"
                    >
                      {status}
                    </Button>
                  );
                })}
              </div>
              {savingStatus && (
                <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </p>
              )}
            </div>
          )}
        </section>

        {/* USERS AND PERMISSIONS SECTION */}
        {selectedProjectId && (
        <section>
          <h2 className="text-xl font-bold mb-6 bg-muted px-4 py-3 rounded">USERS AND PERMISSIONS</h2>

          {loadingPerms ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading permissions...
            </div>
          ) : permissions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No users added to this project yet.</p>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border/50">
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">NAME</th>
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Email</th>
                    {permColumns.map((col) => (
                      <th key={col.key} className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">{col.label}</th>
                    ))}
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Unit Data View</th>
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Project Permissions</th>
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Work Roles</th>
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap"></th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((perm) => (
                    <tr key={perm.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                      <td className="px-4 py-4 whitespace-nowrap">{perm.user_name}</td>
                      <td className="px-4 py-4 whitespace-nowrap">{perm.user_email}</td>
                      {permColumns.map((col) => (
                        <td key={col.key} className="px-4 py-4 whitespace-nowrap">
                          <select
                            disabled={!canManagePerms}
                            className={`${selectClass} ${!canManagePerms ? 'opacity-75 cursor-default' : ''}`}
                            value={perm[col.key] as string}
                            onChange={(e) => handlePermChange(perm.id, col.key, e.target.value)}
                          >
                            {col.options.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>
                      ))}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <select
                          disabled={!canManagePerms}
                          className={`${selectClass} ${!canManagePerms ? 'opacity-75 cursor-default' : ''}`}
                          value={perm.unit_data_view || 'All Project Users'}
                          onChange={(e) => handlePermChange(perm.id, 'unit_data_view', e.target.value)}
                        >
                          <option value="All Project Users">All Project Users</option>
                          <option value="PM View">PM View</option>
                          <option value="Personal View">Personal View</option>
                        </select>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <select
                          disabled={!canManagePerms}
                          className={`${selectClass} ${!canManagePerms ? 'opacity-75 cursor-default' : ''}`}
                          value={perm.project_role}
                          onChange={(e) => handlePermChange(perm.id, 'project_role', e.target.value)}
                        >
                          {projectRoleOptions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <select
                          disabled={!canManagePerms}
                          className={`${selectClass} ${!canManagePerms ? 'opacity-75 cursor-default' : ''}`}
                          value={perm.work_role}
                          onChange={(e) => handlePermChange(perm.id, 'work_role', e.target.value)}
                        >
                          {workRoleOptions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {canManagePerms && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveUser(perm.id)}
                            title="Remove user"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add User Modal */}
          <Modal
            isOpen={showAddUser}
            onClose={() => { setShowAddUser(false); setNewUserName(''); setNewUserEmail(''); setEmailNotFound(false); }}
            title="Add User to Project"
            maxWidth="2xl"
          >
            <div className="space-y-5">
              {/* Email + auto-resolved name */}
              <div>
                <label className="block text-xs font-semibold mb-1">Email</label>
                <input type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="user@example.com" className={inputClass} />
                <div className="mt-1.5 min-h-5">
                  {lookingUpName && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Looking up user…</span>
                  )}
                  {!lookingUpName && newUserName && (
                    <span className="text-xs text-green-500 font-medium">User found: {newUserName}</span>
                  )}
                  {!lookingUpName && emailNotFound && (
                    <span className="text-xs text-red-500">No account found with this email</span>
                  )}
                </div>
              </div>

              {/* Roles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Project Role</label>
                  <select value={newUserPerms.project_role} onChange={(e) => setNewUserPerms((p) => ({ ...p, project_role: e.target.value }))} className={inputClass}>
                    {projectRoleOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Work Role</label>
                  <select value={newUserPerms.work_role} onChange={(e) => setNewUserPerms((p) => ({ ...p, work_role: e.target.value }))} className={inputClass}>
                    {workRoleOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              {/* Unit Data View assignment */}
              <div>
                <label className="block text-xs font-semibold mb-1">Unit Data View</label>
                <select
                  value={newUserPerms.unit_data_view}
                  onChange={(e) => setNewUserPerms((p) => ({ ...p, unit_data_view: e.target.value }))}
                  className={inputClass}
                >
                  <option value="All Project Users">All Project Users</option>
                  <option value="PM View">PM View</option>
                  <option value="Personal View">Personal View</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">Controls which field visibility config the user sees on Unit Data</p>
              </div>

              {/* Permissions per module */}
              <div>
                <label className="block text-xs font-semibold mb-2">Module Permissions</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {permColumns.map((col) => (
                    <div key={col.key}>
                      <label className="block text-xs text-muted-foreground mb-1">{col.label}</label>
                      <select
                        value={newUserPerms[col.key as string]}
                        onChange={(e) => setNewUserPerms((p) => ({ ...p, [col.key]: e.target.value }))}
                        className={inputClass}
                      >
                        {col.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-3">
                <Button
                  onClick={handleAddUser}
                  disabled={addingUser || !newUserName.trim() || !newUserEmail.trim() || lookingUpName || emailNotFound}
                  isLoading={addingUser}
                  className="w-full sm:w-auto"
                >
                  {!addingUser && <Check className="w-4 h-4 mr-1.5" />} Add User
                </Button>
                <Button
                  onClick={() => { setShowAddUser(false); setNewUserName(''); setNewUserEmail(''); setEmailNotFound(false); }}
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  <X className="w-4 h-4 mr-1.5" /> Cancel
                </Button>
              </div>
            </div>
          </Modal>

          {canManagePerms && (
            <Button
              onClick={() => setShowAddUser(true)}
              variant="outline"
              className="mt-4 border-2 border-foreground px-4 sm:px-6 py-2 rounded font-semibold hover:bg-muted transition-colors text-sm sm:text-base h-auto"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          )}
        </section>
        )}

          {/* EMAIL READING SECTION */}
          <div className="mt-10 mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 text-foreground">EMAIL READING</h3>
            <div className="space-y-2 ml-4">
              <Button variant="ghost" className="w-full justify-start text-sm sm:text-base hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">
                Link Company Gmail
              </Button>
              <Button variant="ghost" className="w-full justify-start text-sm sm:text-base hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">
                Autoforwarding
              </Button>
              <Button variant="ghost" className="w-full justify-start text-sm sm:text-base hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">
                Summarize prompt
              </Button>
              <Button variant="ghost" className="w-full justify-start text-sm sm:text-base hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">
                Notify if
              </Button>
            </div>
          </div>

          {/* LINK BANK ACCOUNT SECTION */}
          <div className="mb-8 ml-6">
            <Button variant="ghost" className="w-full justify-start text-sm sm:text-base hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">
              Link Bank Account
            </Button>
            <p className="text-sm text-muted-foreground ml-4 mt-1">(do via Plaid)</p>
          </div>

          {/* STATUS THRESHOLDS SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-4 bg-muted px-3 py-2 rounded flex items-center gap-3">
              STATUS THRESHOLDS
              {savingSettings && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            </h3>
            {!selectedProjectId ? (
              <p className="text-sm text-muted-foreground px-1">Select a project to configure thresholds.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-3 px-1">
                  {isProjectOwner
                    ? 'Click any value to edit it. Changes save automatically.'
                    : 'Only the project owner can edit thresholds.'}
                </p>
                <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border/50">
                        <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Metric</th>
                        <th className="px-4 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-red-500 whitespace-nowrap">Critical</th>
                        <th className="px-4 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-orange-500 whitespace-nowrap">Problematic</th>
                        <th className="px-4 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-green-500 whitespace-nowrap">Good</th>
                        <th className="px-4 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Current</th>
                      </tr>
                    </thead>
                    <tbody>
                      {([
                        {
                          label: 'Taskers without comments',
                          critical:    'threshold_tw_comments_critical'    as const,
                          problematic: 'threshold_tw_comments_problematic' as const,
                          good:        'threshold_tw_comments_good'        as const,
                        },
                        {
                          label: 'Overdue taskers',
                          critical:    'threshold_overdue_critical'    as const,
                          problematic: 'threshold_overdue_problematic' as const,
                          good:        'threshold_overdue_good'        as const,
                        },
                        {
                          label: 'Unit Data % Complete',
                          critical:    'threshold_unit_data_critical'    as const,
                          problematic: 'threshold_unit_data_problematic' as const,
                          good:        'threshold_unit_data_good'        as const,
                        },
                      ] as const).map((row) => (
                        <tr key={row.label} className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                          <td className="px-4 py-4 whitespace-nowrap">{row.label}</td>
                          {([
                            { key: row.critical,    color: 'text-red-500' },
                            { key: row.problematic, color: 'text-orange-500' },
                            { key: row.good,        color: 'text-green-500' },
                          ] as const).map(({ key, color }) => (
                            <td key={key} className="px-4 py-4 text-center whitespace-nowrap">
                              <input
                                type="number"
                                min={0}
                                disabled={!isProjectOwner}
                                defaultValue={projectSettings[key]}
                                key={`${selectedProjectId}-${key}-${projectSettings[key]}`}
                                onBlur={(e) => saveThreshold(key, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                }}
                                className={`w-16 text-center px-2 py-1 rounded border border-input bg-background text-sm font-semibold ${color} focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-default`}
                              />
                            </td>
                          ))}
                          <td className="px-4 py-4 text-center whitespace-nowrap">
                            {row.label === 'Taskers without comments' ? (
                              currentMetrics.noCommentsCount !== null ? (
                                <span className={`text-sm font-semibold ${
                                  currentMetrics.noCommentsCount >= projectSettings.threshold_tw_comments_critical ? 'text-red-500' :
                                  currentMetrics.noCommentsCount >= projectSettings.threshold_tw_comments_problematic ? 'text-orange-500' :
                                  'text-green-500'
                                }`}>{currentMetrics.noCommentsCount}</span>
                              ) : <span className="text-xs text-muted-foreground">—</span>
                            ) : row.label === 'Overdue taskers' ? (
                              currentMetrics.overdueCount !== null ? (
                                <span className={`text-sm font-semibold ${
                                  currentMetrics.overdueCount >= projectSettings.threshold_overdue_critical ? 'text-red-500' :
                                  currentMetrics.overdueCount >= projectSettings.threshold_overdue_problematic ? 'text-orange-500' :
                                  'text-green-500'
                                }`}>{currentMetrics.overdueCount}</span>
                              ) : <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              currentMetrics.unitDataPercent !== null ? (
                                <span className={`text-sm font-semibold ${
                                  currentMetrics.unitDataPercent <= projectSettings.threshold_unit_data_critical ? 'text-red-500' :
                                  currentMetrics.unitDataPercent <= projectSettings.threshold_unit_data_problematic ? 'text-orange-500' :
                                  'text-green-500'
                                }`}>{currentMetrics.unitDataPercent}%</span>
                              ) : <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* UNIT DATA SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 px-3 py-2 rounded">UNIT DATA</h3>
            <div className="ml-4">
              <p className="text-sm font-medium mb-3">Allow Users to customize their display</p>
              <div className="flex gap-3 text-sm">
                <Button
                  disabled={!isProjectOwner || !selectedProjectId}
                  onClick={() => setAllowCustomization(true)}
                  variant="ghost"
                  className={`px-4 py-1.5 rounded border font-semibold transition-colors disabled:opacity-50 disabled:cursor-default h-auto shadow-none ${
                    projectSettings.allow_user_customization
                      ? 'border-green-500 bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'border-input text-muted-foreground hover:bg-muted'
                  }`}
                >
                  Yes
                </Button>
                <Button
                  disabled={!isProjectOwner || !selectedProjectId}
                  onClick={() => setAllowCustomization(false)}
                  variant="ghost"
                  className={`px-4 py-1.5 rounded border font-semibold transition-colors disabled:opacity-50 disabled:cursor-default h-auto shadow-none ${
                    !projectSettings.allow_user_customization
                      ? 'border-red-500 bg-red-500/10 text-red-600 dark:text-red-400'
                      : 'border-input text-muted-foreground hover:bg-muted'
                  }`}
                >
                  No
                </Button>
              </div>
              {!isProjectOwner && selectedProjectId && (
                <p className="text-xs text-muted-foreground mt-2">Only the project owner can change this.</p>
              )}
            </div>
          </div>

          {/* DISPO SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3">DISPO</h3>
            <div className="ml-4 space-y-3">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Open for Offers</span>
              </label>
              <div className="ml-6 text-sm">
                <label className="flex items-center gap-2 py-2">
                  <input type="checkbox" className="w-4 h-4" />
                  <span>Control what data to share</span>
                </label>
              </div>
            </div>
          </div>

          {/* FINANCIAL SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 text-foreground">FINANCIAL</h3>
            <div className="ml-4 space-y-2">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>GROSS INCOME</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>EXPENSES</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>LOANS</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>CASHFLOW</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>DISBURSEMENTS</span>
              </label>
            </div>
          </div>

          {/* UNIT DATA DISPLAY OPTIONS */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 text-foreground">UNIT DATA</h3>
            <div className="ml-4 space-y-2">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Rent Info</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Rent Collections</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Property Info</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Tenant Info (is it present?)</span>
              </label>
            </div>
          </div>

          {/* FILES SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 text-foreground">FILES</h3>
            <div className="ml-4 space-y-2">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Dispo</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>PUBLIC Folder</span>
              </label>
            </div>
          </div>

          {/* NOTIFICATIONS SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-4 bg-muted px-3 py-2 rounded text-orange-600 dark:text-orange-400">NOTIFICATIONS</h3>
            <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border/50">
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap"></th>
                    <th className="px-4 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Email</th>
                    <th className="px-4 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Text</th>
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Setting</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-4 whitespace-nowrap">Taskers as #1 Due Date</td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <select className={selectClass}>
                        <option>Missed</option>
                        <option>24 H</option>
                        <option>48 H</option>
                      </select>
                    </td>
                  </tr>
                  <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-4 whitespace-nowrap">Taskers as #2 Due Date</td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <select className={selectClass}>
                        <option>Missed</option>
                        <option>24 H</option>
                        <option>48 H</option>
                      </select>
                    </td>
                  </tr>
                  <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-4 whitespace-nowrap">Every user&apos;s Tasker Due Date</td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 whitespace-nowrap"></td>
                  </tr>
                  <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-4 whitespace-nowrap">Utility Bill Irregularity</td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Variance:</span>
                        <input type="text" placeholder="x%" className="w-16 px-2 py-1 border border-input rounded bg-background text-foreground text-xs" />
                      </div>
                    </td>
                  </tr>
                  <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-4 whitespace-nowrap">Major Financial Discrepancy</td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">$</span>
                        <input type="text" placeholder="Amount" className="w-20 px-2 py-1 border border-input rounded bg-background text-foreground text-xs" />
                      </div>
                    </td>
                  </tr>
                  <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-4 whitespace-nowrap">Out of Office start/ends</td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 text-center whitespace-nowrap"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="w-3 h-3" /> User 1</label>
                        <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="w-3 h-3" /> User 2</label>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Weather alerts */}
            <div className="mt-4 ml-4 space-y-3">
              <div>
                <p className="text-sm font-medium mb-2">Dangerous Weather Alerts</p>
                <div className="flex flex-wrap gap-4 ml-4">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4" /> Freeze Warnings</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4" /> Flood</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4" /> Hurricane / Tornado / Earthquake</label>
                </div>
              </div>
              <Button variant="ghost" className="w-full justify-start text-sm hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">Law changes</Button>
              <Button variant="ghost" className="w-full justify-start text-sm hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">City Development Plan</Button>
              <div className="space-y-2">
                <Button variant="ghost" className="w-full justify-start text-sm hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">Property Tax Unpaid</Button>
                <div className="flex items-center gap-3 py-2 px-4">
                  <span className="text-sm">Property Tax Reassessment</span>
                  <span className="text-xs text-muted-foreground ml-auto">Notify in advance:</span>
                  <input type="number" placeholder="X" className="w-14 px-2 py-1 border border-input rounded bg-background text-foreground text-xs" />
                  <span className="text-xs text-muted-foreground">days</span>
                </div>
              </div>
              <Button variant="ghost" className="w-full justify-start text-sm hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">Contractor Bids</Button>
            </div>
          </div>

          {/* MEETINGS SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-4 bg-muted px-3 py-2 rounded text-orange-600 dark:text-orange-400">MEETINGS</h3>
            <div className="ml-4 space-y-4">
              {/* Default meeting location */}
              <div>
                <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2">
                  Default Meeting Location
                </label>
                <input
                  type="text"
                  defaultValue={projectSettings.default_meeting_location ?? ''}
                  key={`${selectedProjectId}-mtg-loc-${projectSettings.default_meeting_location ?? ''}`}
                  onBlur={async (e) => {
                    const val = e.target.value.trim();
                    if (val !== (projectSettings.default_meeting_location ?? '') && selectedProjectId) {
                      const ok = await saveProjectSettings(selectedProjectId, { default_meeting_location: val });
                      if (ok) setProjectSettings((prev) => ({ ...prev, default_meeting_location: val }));
                    }
                  }}
                  placeholder="e.g., Conference Room A, Zoom, Google Meet link..."
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Pre-fills the location field when creating new meetings.
                </p>
              </div>

              {/* Google Calendar ID */}
              <div>
                <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2">
                  Google Calendar ID
                </label>
                <input
                  type="text"
                  defaultValue={projectSettings.google_calendar_id ?? ''}
                  key={`${selectedProjectId}-gcal-id-${projectSettings.google_calendar_id ?? ''}`}
                  onBlur={async (e) => {
                    const val = e.target.value.trim();
                    if (val !== (projectSettings.google_calendar_id ?? '') && selectedProjectId) {
                      const ok = await saveProjectSettings(selectedProjectId, { google_calendar_id: val });
                      if (ok) setProjectSettings((prev) => ({ ...prev, google_calendar_id: val }));
                    }
                  }}
                  placeholder="e.g., primary or your-email@gmail.com"
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Required for auto-generating Google Meet links. Use <strong>&quot;primary&quot;</strong> for your default calendar, or paste a specific calendar ID.
                </p>
              </div>

              {/* How it works */}
              <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold text-muted-foreground mb-1.5">HOW MEETINGS WORK:</p>
                <ul className="text-[10px] text-muted-foreground space-y-1 list-disc list-inside leading-relaxed">
                  <li>Editors and admins can <strong>create, edit, and delete</strong> meetings with a title, date, time, location, and meeting link</li>
                  <li>All users can <strong>view</strong> meetings on the calendar and see meeting details</li>
                  <li>Click <strong>&quot;GCal&quot;</strong> on any meeting to add it to your personal Google Calendar (opens in a new tab)</li>
                  <li>If a <strong>Google Meet</strong> or video link is set, all users can click <strong>&quot;Join Meeting&quot;</strong> to join directly</li>
                  <li>You can manually generate a Meet link by clicking <strong>&quot;Generate Google Meet link&quot;</strong> in the meeting form</li>
                </ul>
              </div>

              <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold text-muted-foreground mb-1.5">AUTO GOOGLE MEET SETUP:</p>
                <ul className="text-[10px] text-muted-foreground space-y-1 list-disc list-inside leading-relaxed">
                  <li>Make sure your <strong>Google Drive is connected</strong> on the Files page (this also enables Calendar access)</li>
                  <li>Set the <strong>Google Calendar ID</strong> above (use <strong>&quot;primary&quot;</strong> for your main calendar)</li>
                  <li>Set the <strong>Default Meeting Location</strong> to <strong>&quot;Google Meet&quot;</strong></li>
                  <li>When creating a meeting, if the location contains <strong>&quot;Google Meet&quot;</strong> and a date is selected, a Google Meet link will be <strong>automatically generated</strong> on the Review step</li>
                  <li>The generated Meet link is attached to the meeting and included in email invitations sent to attendees</li>
                </ul>
              </div>

              <Button variant="ghost" className="w-full justify-start text-sm underline hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">Edit Transcription to Summary Prompt (for YOU)</Button>
              <Button variant="ghost" className="w-full justify-start text-sm underline hover:text-primary transition-colors h-auto py-2 px-4 shadow-none">Edit Transcription to Summary Prompt (for EVERYONE)</Button>
            </div>
          </div>

          {/* TASKERS SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-4 bg-muted px-3 py-2 rounded text-orange-600 dark:text-orange-400">TASKERS</h3>
            <div className="ml-4 space-y-1">
              <div className="flex items-center justify-between py-2 px-4 rounded hover:bg-muted/50">
                <span className="text-sm">LLC Renewal</span>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="w-4 h-4" /> Auto-Add</label>
              </div>
              <div className="flex items-center justify-between py-2 px-4 rounded hover:bg-muted/50">
                <span className="text-sm">Registered Agent Renewal</span>
                <input type="checkbox" className="w-4 h-4" />
              </div>
              <div className="flex items-center justify-between py-2 px-4 rounded hover:bg-muted/50">
                <span className="text-sm">Tax Due Date</span>
                <input type="checkbox" className="w-4 h-4" />
              </div>
              <div className="flex items-center justify-between py-2 px-4 rounded hover:bg-muted/50">
                <span className="text-sm">Reports to LP</span>
                <input type="checkbox" className="w-4 h-4" />
              </div>
              <div className="flex items-center justify-between py-2 px-4 rounded hover:bg-muted/50">
                <span className="text-sm">Property Tax Due</span>
                <input type="checkbox" className="w-4 h-4" />
              </div>
              <div className="flex items-center justify-between py-2 px-4 rounded hover:bg-muted/50">
                <span className="text-sm">Property Tax Reassessment</span>
                <input type="checkbox" className="w-4 h-4" />
              </div>
              <div className="flex items-center justify-between py-2 px-4 rounded hover:bg-muted/50">
                <span className="text-sm">Insurance Premium Renewal</span>
                <input type="checkbox" className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-4 ml-4 space-y-3">
              <div className="flex items-center gap-3 py-2 px-4">
                <span className="text-sm">Due date default:</span>
                <select className={selectClass}>
                  <option>Mondays</option>
                  <option>Tuesdays</option>
                  <option>Wednesdays</option>
                  <option>Thursdays</option>
                  <option>Fridays</option>
                  <option>Saturdays</option>
                  <option>Sundays</option>
                </select>
              </div>
              <div className="flex items-center gap-3 py-2 px-4">
                <span className="text-sm">Default tasker assignee:</span>
                <input type="text" placeholder="Name" className="w-32 px-2 py-1 border border-input rounded bg-background text-foreground text-xs" />
              </div>
            </div>
          </div>

          {/* UNIT DATA SETTINGS SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-4 bg-muted px-3 py-2 rounded text-red-600 dark:text-red-400">UNIT DATA</h3>
            <div className="ml-4 space-y-3">
              <div className="flex items-center gap-3 py-2 px-4">
                <span className="text-sm">Prompt for reviewing leases:</span>
                <input type="text" placeholder="Make sure they don't have a $2700 deposit" className="flex-1 px-2 py-1 border border-input rounded bg-background text-foreground text-xs" />
              </div>
              <Button variant="ghost" className="w-full justify-start text-sm text-red-600 dark:text-red-400 underline hover:text-red-500 transition-colors h-auto py-2 px-4 shadow-none">
                UNIT DATA: Link and edit to a target google sheet
              </Button>
            </div>
          </div>

          {/* USER LOGS SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-4 bg-muted px-3 py-2 rounded text-blue-600 dark:text-blue-400">USER LOGS</h3>
            <div className="ml-4 space-y-3">
              <p className="text-sm font-semibold px-4">GIVE ALERTS IF:</p>
              <div className="flex items-center gap-2 py-2 px-4">
                <span className="text-sm">No Action by</span>
                <input type="text" placeholder="x" className="w-10 px-2 py-1 border border-input rounded bg-background text-foreground text-xs text-center" />
                <span className="text-sm">user for</span>
                <input type="number" placeholder="X" className="w-14 px-2 py-1 border border-input rounded bg-background text-foreground text-xs text-center" />
                <span className="text-sm">days</span>
              </div>
            </div>
          </div>

          {/* REPORTS SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-4 bg-muted px-3 py-2 rounded text-green-600 dark:text-green-400">REPORTS</h3>
            <div className="ml-4">
              <p className="text-sm text-muted-foreground py-2 px-4">Report settings coming soon.</p>
            </div>
          </div>

      </div>
    </main>
  );
}
