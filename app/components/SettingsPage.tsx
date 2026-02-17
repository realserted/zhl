'use client';

import { Plus, ToggleLeft, Check, X, Loader2, Trash2 } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../lib/auth-context';
import { supabase } from '../../lib/supabase';
import { Project, ProjectPermission } from '../../lib/types/project';
import {
  getProjects,
  createProject as createProjectDb,
  getProjectPermissions,
  addProjectUser,
  updatePermission,
  removeProjectUser,
} from '../../lib/db/projects';

type EditingField = 'displayName' | 'phone' | 'email' | 'password' | null;

export default function SettingsPage() {
  const { user } = useAuth();

  // Account fields loaded from DB
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

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
        .from('accounts')
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

  const saveField = async (field: EditingField) => {
    if (!user || !field) return;
    setSaving(true);
    setFeedback(null);

    try {
      if (field === 'displayName') {
        const trimmed = editValue.trim();
        if (!trimmed) { setFeedback({ field, message: 'Display name cannot be empty', type: 'error' }); setSaving(false); return; }
        // Update accounts table
        const { error: dbErr } = await supabase.from('accounts').update({ display_name: trimmed }).eq('user_id', user.id);
        if (dbErr) throw dbErr;
        // Update auth metadata
        await supabase.auth.updateUser({ data: { display_name: trimmed } });
        setDisplayName(trimmed);
        setFeedback({ field, message: 'Display name updated', type: 'success' });

      } else if (field === 'phone') {
        const trimmed = editValue.trim();
        const { error: dbErr } = await supabase.from('accounts').update({ phone: trimmed || null }).eq('user_id', user.id);
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
        const { error: dbErr } = await supabase.from('accounts').update({ email: trimmed }).eq('user_id', user.id);
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

  // ===== PROJECT & PERMISSIONS STATE =====
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ProjectPermission[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingPerms, setLoadingPerms] = useState(false);

  // Create project modal
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  // Add user modal
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [addingUser, setAddingUser] = useState(false);

  // Load projects on mount
  useEffect(() => {
    if (!user) return;
    async function loadProjects() {
      setLoadingProjects(true);
      const data = await getProjects();
      setProjects(data);
      if (data.length > 0) {
        setSelectedProjectId(data[0].id);
      }
      setLoadingProjects(false);
    }
    loadProjects();
  }, [user]);

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
      setProjects((prev) => [...prev, project]);
      setSelectedProjectId(project.id);
      setNewProjectName('');
      setShowCreateProject(false);
    }
    setCreatingProject(false);
  };

  const handleAddUser = async () => {
    if (!selectedProjectId || !newUserName.trim() || !newUserEmail.trim()) return;
    setAddingUser(true);
    const perm = await addProjectUser(selectedProjectId, newUserName.trim(), newUserEmail.trim());
    if (perm) {
      setPermissions((prev) => [...prev, perm]);
      setNewUserName('');
      setNewUserEmail('');
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
    const ok = await removeProjectUser(permId);
    if (ok) {
      setPermissions((prev) => prev.filter((p) => p.id !== permId));
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

  const [statusThresholds, setStatusThresholds] = useState({
    taskersWithoutComments: { critical: 5, problematic: 3, good: 1 },
    overdueTaskers: { critical: 5, problematic: 3, good: 1 },
    unitDataComplete: { critical: 70, problematic: 80, good: 95 },
  });

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

            <button className="w-full text-left py-2 px-3 sm:px-4 rounded hover:bg-muted transition-colors text-sm sm:text-base">
              Sync taskers to google calendar
            </button>

            {/* Change Display Name */}
            <div className="py-2 px-3 sm:px-4 rounded border border-transparent">
              {editingField === 'displayName' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Change Display Name</label>
                  <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} className={inputClass} placeholder="Enter new display name" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => saveField('displayName')} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50">
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                    </button>
                    <button onClick={cancelEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-input rounded-lg text-xs font-semibold hover:bg-muted">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                  {feedback?.field === 'displayName' && (
                    <p className={`text-xs ${feedback.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>{feedback.message}</p>
                  )}
                </div>
              ) : (
                <button onClick={() => startEdit('displayName')} className="w-full text-left text-sm sm:text-base hover:text-accent transition-colors">
                  Change Display Name <span className="text-muted-foreground ml-2">({displayName || '...'})</span>
                </button>
              )}
            </div>

            {/* Change Phone */}
            <div className="py-2 px-3 sm:px-4 rounded border border-transparent">
              {editingField === 'phone' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Change Phone</label>
                  <input type="tel" value={editValue} onChange={(e) => setEditValue(e.target.value)} className={inputClass} placeholder="(555) 123-4567" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => saveField('phone')} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50">
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                    </button>
                    <button onClick={cancelEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-input rounded-lg text-xs font-semibold hover:bg-muted">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                  {feedback?.field === 'phone' && (
                    <p className={`text-xs ${feedback.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>{feedback.message}</p>
                  )}
                </div>
              ) : (
                <button onClick={() => startEdit('phone')} className="w-full text-left text-sm sm:text-base hover:text-accent transition-colors">
                  Change Phone <span className="text-muted-foreground ml-2">({phone || 'Not set'})</span>
                </button>
              )}
            </div>

            {/* Change Email */}
            <div className="py-2 px-3 sm:px-4 rounded border border-transparent">
              {editingField === 'email' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Change Email</label>
                  <input type="email" value={editValue} onChange={(e) => setEditValue(e.target.value)} className={inputClass} placeholder="you@example.com" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => saveField('email')} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50">
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                    </button>
                    <button onClick={cancelEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-input rounded-lg text-xs font-semibold hover:bg-muted">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                  {feedback?.field === 'email' && (
                    <p className={`text-xs ${feedback.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>{feedback.message}</p>
                  )}
                </div>
              ) : (
                <button onClick={() => startEdit('email')} className="w-full text-left text-sm sm:text-base hover:text-accent transition-colors">
                  Change Email <span className="text-muted-foreground ml-2">({email || '...'})</span>
                </button>
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
                    <button onClick={() => saveField('password')} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50">
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                    </button>
                    <button onClick={cancelEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-input rounded-lg text-xs font-semibold hover:bg-muted">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                  {feedback?.field === 'password' && (
                    <p className={`text-xs ${feedback.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>{feedback.message}</p>
                  )}
                </div>
              ) : (
                <button onClick={() => startEdit('password')} className="w-full text-left text-sm sm:text-base hover:text-accent transition-colors">
                  Change Password
                </button>
              )}
            </div>

            <button className="w-full text-left py-2 px-3 sm:px-4 rounded hover:bg-muted transition-colors text-sm sm:text-base">
              Billing Settings
            </button>
          </div>
        </section>

        {/* PROJECT SETTINGS SECTION */}
        <section className="mb-8 sm:mb-12">
          <h2 className="text-lg sm:text-xl font-bold mb-6 sm:mb-8 pb-4 border-b border-border flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
            PROJECT SETTINGS FOR
            {loadingProjects ? (
              <span className="text-sm text-muted-foreground">Loading...</span>
            ) : projects.length > 0 ? (
              <select
                className="border border-input rounded px-2 sm:px-3 py-1 sm:py-2 bg-background text-foreground text-sm"
                value={selectedProjectId || ''}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-muted-foreground">No projects yet</span>
            )}
            <button
              onClick={() => setShowCreateProject(true)}
              className="w-full sm:w-auto sm:ml-auto border-2 border-foreground px-4 sm:px-6 py-2 rounded font-semibold hover:bg-muted transition-colors text-sm sm:text-base"
            >
              CREATE NEW PROJECT
            </button>
          </h2>

          {/* Create Project Modal */}
          {showCreateProject && (
            <div className="mb-6 bg-card border border-border rounded-xl p-5 max-w-md">
              <h3 className="text-sm font-semibold text-foreground mb-3">New Project</h3>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                className={inputClass + ' mb-3'}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreateProject}
                  disabled={creatingProject || !newProjectName.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {creatingProject ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Create
                </button>
                <button
                  onClick={() => { setShowCreateProject(false); setNewProjectName(''); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-input rounded-lg text-xs font-semibold hover:bg-muted"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          )}

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
            <div className="overflow-x-auto border border-input rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-input">
                    <th className="px-4 py-3 text-left font-semibold">NAME</th>
                    <th className="px-4 py-3 text-left font-semibold">Email</th>
                    {permColumns.map((col) => (
                      <th key={col.key} className="px-4 py-3 text-left font-semibold">{col.label}</th>
                    ))}
                    <th className="px-4 py-3 text-left font-semibold">Project Permissions</th>
                    <th className="px-4 py-3 text-left font-semibold">Work Roles</th>
                    <th className="px-4 py-3 text-left font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((perm) => (
                    <tr key={perm.id} className="border-b border-input hover:bg-muted/50">
                      <td className="px-4 py-3 whitespace-nowrap">{perm.user_name}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{perm.user_email}</td>
                      {permColumns.map((col) => (
                        <td key={col.key} className="px-4 py-3">
                          <select
                            className={selectClass}
                            value={perm[col.key] as string}
                            onChange={(e) => handlePermChange(perm.id, col.key, e.target.value)}
                          >
                            {col.options.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <select
                          className={selectClass}
                          value={perm.project_role}
                          onChange={(e) => handlePermChange(perm.id, 'project_role', e.target.value)}
                        >
                          {projectRoleOptions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className={selectClass}
                          value={perm.work_role}
                          onChange={(e) => handlePermChange(perm.id, 'work_role', e.target.value)}
                        >
                          {workRoleOptions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleRemoveUser(perm.id)}
                          title="Remove user"
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add User */}
          {showAddUser ? (
            <div className="mt-4 bg-card border border-border rounded-xl p-5 max-w-md">
              <h3 className="text-sm font-semibold text-foreground mb-3">Add User</h3>
              <div className="space-y-2 mb-3">
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Name"
                  className={inputClass}
                />
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="Email"
                  className={inputClass}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddUser()}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddUser}
                  disabled={addingUser || !newUserName.trim() || !newUserEmail.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {addingUser ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Add
                </button>
                <button
                  onClick={() => { setShowAddUser(false); setNewUserName(''); setNewUserEmail(''); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-input rounded-lg text-xs font-semibold hover:bg-muted"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddUser(true)}
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add User
            </button>
          )}
        </section>
        )}

          {/* EMAIL READING SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 text-foreground">EMAIL READING</h3>
            <div className="space-y-2 ml-4">
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors">
                Link Company Gmail
              </button>
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors">
                Autoforwarding
              </button>
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors">
                Summarize prompt
              </button>
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors">
                Notify if
              </button>
            </div>
          </div>

          {/* LINK BANK ACCOUNT SECTION */}
          <div className="mb-8 ml-6">
            <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors">
              Link Bank Account
            </button>
            <p className="text-sm text-muted-foreground ml-4 mt-1">(do via Plaid)</p>
          </div>

          {/* STATUS THRESHOLDS SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-4 bg-muted px-3 py-2 rounded">STATUS THRESHOLDS</h3>
            <div className="overflow-x-auto border border-input rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-input">
                    <th className="px-4 py-3 text-left font-semibold">Metric</th>
                    <th className="px-4 py-3 text-center font-semibold">Critical</th>
                    <th className="px-4 py-3 text-center font-semibold">Problematic</th>
                    <th className="px-4 py-3 text-center font-semibold">Good</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Taskers without comments</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.taskersWithoutComments.critical}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.taskersWithoutComments.problematic}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.taskersWithoutComments.good}</td>
                  </tr>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Overdue taskers</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.overdueTaskers.critical}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.overdueTaskers.problematic}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.overdueTaskers.good}</td>
                  </tr>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Unit Data % Complete</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.unitDataComplete.critical}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.unitDataComplete.problematic}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.unitDataComplete.good}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* UNIT DATA SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 px-3 py-2 rounded">UNIT DATA</h3>
            <div className="ml-4">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Allow Users to customize their display</span>
              </label>
              <div className="flex gap-4 ml-6 text-sm">
                <button className="px-3 py-1 rounded border border-input hover:bg-muted transition-colors">Yes</button>
                <button className="px-3 py-1 rounded border border-input hover:bg-muted transition-colors">No</button>
              </div>
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
            <div className="overflow-x-auto border border-input rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-input">
                    <th className="px-4 py-3 text-left font-semibold"></th>
                    <th className="px-4 py-3 text-center font-semibold">Email</th>
                    <th className="px-4 py-3 text-center font-semibold">Text</th>
                    <th className="px-4 py-3 text-left font-semibold">Setting</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Taskers as #1 Due Date</td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3">
                      <select className={selectClass}>
                        <option>Missed</option>
                        <option>24 H</option>
                        <option>48 H</option>
                      </select>
                    </td>
                  </tr>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Taskers as #2 Due Date</td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3">
                      <select className={selectClass}>
                        <option>Missed</option>
                        <option>24 H</option>
                        <option>48 H</option>
                      </select>
                    </td>
                  </tr>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Every user&apos;s Tasker Due Date</td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3"></td>
                  </tr>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Utility Bill Irregularity</td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Variance:</span>
                        <input type="text" placeholder="x%" className="w-16 px-2 py-1 border border-input rounded bg-background text-foreground text-xs" />
                      </div>
                    </td>
                  </tr>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Major Financial Discrepancy</td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">$</span>
                        <input type="text" placeholder="Amount" className="w-20 px-2 py-1 border border-input rounded bg-background text-foreground text-xs" />
                      </div>
                    </td>
                  </tr>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Out of Office start/ends</td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3 text-center"><input type="checkbox" className="w-4 h-4" /></td>
                    <td className="px-4 py-3">
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
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors text-sm">Law changes</button>
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors text-sm">City Development Plan</button>
              <div className="space-y-2">
                <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors text-sm">Property Tax Unpaid</button>
                <div className="flex items-center gap-3 py-2 px-4">
                  <span className="text-sm">Property Tax Reassessment</span>
                  <span className="text-xs text-muted-foreground ml-auto">Notify in advance:</span>
                  <input type="number" placeholder="X" className="w-14 px-2 py-1 border border-input rounded bg-background text-foreground text-xs" />
                  <span className="text-xs text-muted-foreground">days</span>
                </div>
              </div>
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors text-sm">Contractor Bids</button>
            </div>
          </div>

          {/* MEETINGS SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-4 bg-muted px-3 py-2 rounded text-orange-600 dark:text-orange-400">MEETINGS</h3>
            <div className="ml-4 space-y-2">
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors text-sm">Google Meet settings</button>
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors text-sm underline">Edit Transcription to Summary Prompt (for YOU)</button>
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors text-sm underline">Edit Transcription to Summary Prompt (for EVERYONE)</button>
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
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors text-sm text-red-600 dark:text-red-400 underline">
                UNIT DATA: Link and edit to a target google sheet
              </button>
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
        </section>

      </div>
    </main>
  );
}
