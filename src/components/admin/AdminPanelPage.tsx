'use client';

import { Plus, Upload, Loader2, ShieldAlert, Check, Trash2, Save, X } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Project } from '@/lib/types/project';
import { logUserAction } from '@/lib/db/user-logs';
import { AdminRequest, getAdminRequests, resolveAdminRequest, deleteAdminRequest } from '@/lib/db/admin-requests';
import { getAllBackupRequests, updateBackupRequestStatus } from '@/lib/db/files';
import { ProjectFileBackupRequest } from '@/lib/types/files';
import { UnitDataRecoveryRequest, getRecoveryRequests, resolveRecoveryRequest } from '@/lib/db/unit-data-recovery';
import { restoreField, restoreCategory } from '@/lib/db/unit-data';
import { getProjectSettings, saveProjectSettings } from '@/lib/db/project-settings';
import { getBankTypes, updateBankTypePrompt, createBankType, approveBankType, rejectBankType } from '@/lib/db/financial';
import { FinancialBankType } from '@/lib/types/financial';

const STATUS_OPTIONS = ['Critical', 'Problematic', 'Needs Attention', 'Good', 'Excellent'] as const;

const STATUS_COLORS: Record<string, string> = {
  Critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  Problematic: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  'Needs Attention': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  Good: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  Excellent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
};

const US_STATES = [
  '', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

interface ProjectWithOwner extends Project {
  owner_name: string;
  owner_email: string;
}

interface AdminPanelPageProps {
  onProjectStatusChange?: (projectId: string, status: string) => void;
}

export default function AdminPanelPage({ onProjectStatusChange }: AdminPanelPageProps) {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectWithOwner[]>([]);

  // Template section state
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [taskerNamePrompt, setTaskerNamePrompt] = useState('');
  const [statusPrompt, setStatusPrompt] = useState('');
  const [bankTypes, setBankTypes] = useState<FinancialBankType[]>([]);
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [promptSaveMsg, setPromptSaveMsg] = useState('');
  const [showAddBankType, setShowAddBankType] = useState(false);
  const [newBankTypeName, setNewBankTypeName] = useState('');

  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [backupRequests, setBackupRequests] = useState<(ProjectFileBackupRequest & { project_name: string })[]>([]);
  const [loadingBackupRequests, setLoadingBackupRequests] = useState(false);
  const [recoveryRequests, setRecoveryRequests] = useState<UnitDataRecoveryRequest[]>([]);
  const [loadingRecoveryRequests, setLoadingRecoveryRequests] = useState(false);

  // Check if user is admin
  useEffect(() => {
    if (!user) return;
    supabase
      .from('zhl_accounts')
      .select('is_admin')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        setIsAdmin(data?.is_admin === true);
      });
  }, [user]);

  // Load all projects with owner info + requests
  useEffect(() => {
    if (!isAdmin) return;
    loadProjects();
    setLoadingRequests(true);
    getAdminRequests().then((data) => { setRequests(data); setLoadingRequests(false); });
    setLoadingBackupRequests(true);
    getAllBackupRequests().then((data) => { setBackupRequests(data); setLoadingBackupRequests(false); });
    setLoadingRecoveryRequests(true);
    getRecoveryRequests().then((data) => { setRecoveryRequests(data); setLoadingRecoveryRequests(false); });
  }, [isAdmin]);

  const loadProjects = async () => {
    setLoading(true);

    // Fetch all projects
    const { data: projectsData, error: projErr } = await supabase
      .from('zhl_projects')
      .select('*')
      .order('created_at', { ascending: true });

    if (projErr || !projectsData) {
      console.error('Error loading projects:', projErr);
      setLoading(false);
      return;
    }

    // Fetch all project_permissions to find the "Project Owner" for each project
    const { data: permsData } = await supabase
      .from('zhl_project_permissions')
      .select('project_id, user_name, user_email, project_role');

    // Build a map of project_id -> owner info from permissions (Project Owner role)
    const ownerMap = new Map<string, { user_name: string; user_email: string }>();
    (permsData ?? []).forEach((p: { project_id: string; user_name: string; user_email: string; project_role: string }) => {
      if (p.project_role === 'Project Owner') {
        ownerMap.set(p.project_id, { user_name: p.user_name, user_email: p.user_email });
      }
    });

    // Fallback: also fetch accounts for owner_id in case no permission has "Project Owner" role
    const { data: accountsData } = await supabase
      .from('zhl_accounts')
      .select('user_id, display_name, email');

    const accountMap = new Map<string, { display_name: string; email: string }>();
    (accountsData ?? []).forEach((a: { user_id: string; display_name: string; email: string }) => {
      accountMap.set(a.user_id, { display_name: a.display_name, email: a.email });
    });

    const enriched: ProjectWithOwner[] = projectsData.map((p: Project) => {
      const permOwner = ownerMap.get(p.id);
      return {
        ...p,
        owner_name: permOwner?.user_name ?? accountMap.get(p.owner_id)?.display_name ?? 'Unknown',
        owner_email: permOwner?.user_email ?? accountMap.get(p.owner_id)?.email ?? '',
      };
    });

    setProjects(enriched);
    setLoading(false);
  };

  // Load AI prompts & bank types when a project is selected
  const loadProjectPrompts = useCallback(async (projectId: string) => {
    if (!projectId) return;
    const [settings, types] = await Promise.all([
      getProjectSettings(projectId),
      getBankTypes(projectId),
    ]);
    setTaskerNamePrompt(settings.tasker_name_ai_prompt || '');
    setStatusPrompt(settings.status_ai_prompt || '');
    setBankTypes(types);
  }, []);

  useEffect(() => {
    if (selectedProjectId) loadProjectPrompts(selectedProjectId);
  }, [selectedProjectId, loadProjectPrompts]);

  // Auto-select first project once loaded
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const handleSavePrompts = async () => {
    if (!selectedProjectId) return;
    setSavingPrompts(true);
    setPromptSaveMsg('');
    const ok = await saveProjectSettings(selectedProjectId, {
      tasker_name_ai_prompt: taskerNamePrompt,
      status_ai_prompt: statusPrompt,
    });
    setSavingPrompts(false);
    setPromptSaveMsg(ok ? 'Saved!' : 'Error saving prompts');
    if (ok) setTimeout(() => setPromptSaveMsg(''), 2000);
  };

  const handleBankTypePromptChange = (bankTypeId: string, newPrompt: string) => {
    setBankTypes((prev) => prev.map((b) => b.id === bankTypeId ? { ...b, ai_prompt: newPrompt } : b));
  };

  const handleSaveBankTypePrompt = async (bankTypeId: string) => {
    const bt = bankTypes.find((b) => b.id === bankTypeId);
    if (!bt) return;
    await updateBankTypePrompt(bankTypeId, bt.ai_prompt);
  };

  const handleAddBankType = async () => {
    if (!selectedProjectId || !newBankTypeName.trim()) return;
    const bt = await createBankType(selectedProjectId, newBankTypeName.trim(), 'approved');
    if (bt) setBankTypes((prev) => [...prev, bt]);
    setNewBankTypeName('');
    setShowAddBankType(false);
  };

  const handleApproveBankType = async (id: string) => {
    const ok = await approveBankType(id);
    if (ok) setBankTypes((prev) => prev.map((b) => b.id === id ? { ...b, status: 'approved' } : b));
  };

  const handleRejectBankType = async (id: string) => {
    const ok = await rejectBankType(id);
    if (ok) setBankTypes((prev) => prev.filter((b) => b.id !== id));
  };

  const handleDeleteBankType = async (id: string) => {
    const ok = await rejectBankType(id);
    if (ok) setBankTypes((prev) => prev.filter((b) => b.id !== id));
  };

  // Update project field
  const updateProjectField = async (projectId: string, field: string, value: string | number | null) => {
    const { error } = await supabase
      .from('zhl_projects')
      .update({ [field]: value })
      .eq('id', projectId);

    if (error) {
      console.error('Error updating project:', error);
      return;
    }

    const project = projects.find((p) => p.id === projectId);
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, [field]: value } : p))
    );

    // Notify parent when status changes so navbar updates
    if (field === 'status' && typeof value === 'string') {
      onProjectStatusChange?.(projectId, value);
    }

    // Log admin action
    if (user && project) {
      const fieldLabel = field.charAt(0).toUpperCase() + field.slice(1);
      logUserAction({ projectId, userId: user.id, userName: 'AdminJon', userEmail: 'admin@zhl.com', action: `Changed ${fieldLabel} to "${value}" for project "${project.name}"` });
    }
  };

  const handleResolveRequest = async (id: string) => {
    const ok = await resolveAdminRequest(id);
    if (ok) setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: 'resolved' } : r));
  };

  const handleDeleteRequest = async (id: string) => {
    const ok = await deleteAdminRequest(id);
    if (ok) setRequests((prev) => prev.filter((r) => r.id !== id));
  };

  const handleBackupRequestStatus = async (id: string, status: ProjectFileBackupRequest['status']) => {
    const ok = await updateBackupRequestStatus(id, status);
    if (ok) setBackupRequests((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
  };

  const handleRecoveryRequest = async (req: UnitDataRecoveryRequest, action: 'approved' | 'rejected') => {
    if (!user) return;
    if (action === 'approved') {
      const restored = req.item_type === 'category'
        ? await restoreCategory(req.item_id)
        : await restoreField(req.item_id);
      if (!restored) return;
    }
    const ok = await resolveRecoveryRequest(req.id, action, user.id);
    if (ok) setRecoveryRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: action, resolved_at: new Date().toISOString(), resolved_by: user.id } : r));
  };

  const selectClass = 'border border-input rounded px-2 py-1 bg-background text-foreground text-xs';

  // Not admin — show access denied
  if (isAdmin === false) {
    return (
      <main className="bg-background text-foreground min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md">
          <ShieldAlert className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            Only the AdminJon account can access the Admin Panel. Contact your administrator for access.
          </p>
        </div>
      </main>
    );
  }

  // Still checking
  if (isAdmin === null) {
    return (
      <main className="bg-background text-foreground min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking access...
        </div>
      </main>
    );
  }

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Admin Header */}
        <div className="flex items-center gap-3 mb-6">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <span className="text-xs bg-primary text-accent-foreground px-2 py-1 rounded-full font-semibold">AdminJon</span>
        </div>

        {/* BROWSE ALL USER'S PROJECTS SECTION */}
        <section className="mb-8 sm:mb-12">
          <h2 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6 pb-4 border-b border-border">
            BROWSE ALL USER&apos;S PROJECTS
          </h2>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No projects found.</p>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border/50">
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Project Name</th>
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Project Owner</th>
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Status</th>
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Units</th>
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">State</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                      {/* Project Name */}
                      <td className="px-4 py-3 font-medium">{project.name}</td>

                      {/* Owner */}
                      <td className="px-4 py-3">
                        <div>
                          <span>{project.owner_name}</span>
                          {project.owner_email && (
                            <span className="text-xs text-muted-foreground ml-2">
                              ({project.owner_email})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status dropdown */}
                      <td className="px-4 py-3">
                        <select
                          className={`${selectClass} ${STATUS_COLORS[project.status] || ''}`}
                          value={project.status}
                          onChange={(e) => updateProjectField(project.id, 'status', e.target.value)}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Units */}
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={0}
                          value={project.units}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            updateProjectField(project.id, 'units', val);
                          }}
                          className="w-20 px-2 py-1 border border-input rounded bg-background text-foreground text-xs"
                        />
                      </td>

                      {/* State */}
                      <td className="px-4 py-3">
                        <select
                          className={selectClass}
                          value={project.state || ''}
                          onChange={(e) =>
                            updateProjectField(project.id, 'state', e.target.value || null)
                          }
                        >
                          {US_STATES.map((s) => (
                            <option key={s} value={s}>
                              {s || '—'}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ADD NEW TEMPLATES SECTION */}
        <section className="mb-12">
          <h2 className="text-lg font-bold mb-6 pb-3 border-b border-border">ADD NEW TEMPLATES</h2>

          <div className="ml-6 space-y-6">
            {/* Project Selector */}
            <div>
              <label className="block text-sm font-semibold mb-2">Select Project</label>
              <select
                className={selectClass}
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                <option value="">— Select a project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* File Upload Area */}
            <div className="border-2 border-dashed border-input rounded-lg p-8 hover:bg-muted/50 transition-colors cursor-pointer">
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="font-semibold text-foreground">File free here</p>
              </div>
            </div>

            {/* Tasker Name AI Prompt */}
            <div>
              <label className="block text-sm font-semibold mb-2">Tasker name AI prompt</label>
              <textarea
                className="w-full border border-input rounded-md p-3 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                placeholder="Enter AI prompt for tasker name..."
                value={taskerNamePrompt}
                onChange={(e) => setTaskerNamePrompt(e.target.value)}
                disabled={!selectedProjectId}
              />
            </div>

            {/* Status AI Prompt */}
            <div>
              <label className="block text-sm font-semibold mb-2">Status AI prompt</label>
              <textarea
                className="w-full border border-input rounded-md p-3 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                placeholder="Enter AI prompt for status..."
                value={statusPrompt}
                onChange={(e) => setStatusPrompt(e.target.value)}
                disabled={!selectedProjectId}
              />
              <p className="text-xs text-muted-foreground mt-1">10 words max</p>
            </div>

            {/* Save Prompts Button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSavePrompts}
                disabled={!selectedProjectId || savingPrompts}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {savingPrompts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Prompts
              </button>
              {promptSaveMsg && (
                <span className={`text-xs font-semibold ${promptSaveMsg === 'Saved!' ? 'text-primary' : 'text-red-600'}`}>
                  {promptSaveMsg}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* REPORT TYPES SECTION */}
        <section className="mb-12">
          <h2 className="text-lg font-bold mb-6 pb-3 border-b border-border">
            REPORT TYPES
            {bankTypes.filter((b) => b.status === 'pending').length > 0 && (
              <span className="ml-2 text-xs bg-amber-500 text-white px-2 py-0.5 rounded-full font-semibold">
                {bankTypes.filter((b) => b.status === 'pending').length} pending
              </span>
            )}
          </h2>

          <div className="ml-6 space-y-4">
            {!selectedProjectId ? (
              <p className="text-sm text-muted-foreground py-4">Select a project above to manage report types.</p>
            ) : (
              <>
                {/* Pending requests */}
                {bankTypes.filter((b) => b.status === 'pending').length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <h4 className="text-xs font-bold tracking-wider uppercase text-amber-500 mb-3">Pending Requests</h4>
                    <div className="space-y-2">
                      {bankTypes.filter((b) => b.status === 'pending').map((bt) => (
                        <div key={bt.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-background/50 border border-border/50">
                          <span className="text-xs font-medium">{bt.name}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleApproveBankType(bt.id)}
                              title="Approve"
                              className="p-1.5 text-muted-foreground hover:text-green-500 transition-colors"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleRejectBankType(bt.id)}
                              title="Reject"
                              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Approved types table */}
                {bankTypes.filter((b) => !b.status || b.status === 'approved').length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No bank types found for this project.</p>
                ) : (
                  <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30 border-b border-border/50">
                          <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Type</th>
                          <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">AI Prompt</th>
                          <th className="px-4 py-4 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bankTypes.filter((b) => !b.status || b.status === 'approved').map((bt) => (
                          <tr key={bt.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
                            <td className="px-4 py-3">
                              <span className="text-xs font-medium">{bt.name}</span>
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs w-full"
                                placeholder="Enter AI prompt..."
                                value={bt.ai_prompt}
                                onChange={(e) => handleBankTypePromptChange(bt.id, e.target.value)}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleSaveBankTypePrompt(bt.id)}
                                  title="Save prompt"
                                  className="p-1 text-muted-foreground hover:text-accent transition-colors"
                                >
                                  <Save className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteBankType(bt.id)}
                                  title="Delete type"
                                  className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Add new type */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newBankTypeName}
                    onChange={(e) => setNewBankTypeName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddBankType(); }}
                    placeholder="New report type name..."
                    className="px-3 py-2 bg-background/50 border border-input rounded-lg text-xs w-64 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <button
                    onClick={handleAddBankType}
                    disabled={!newBankTypeName.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold tracking-wider uppercase bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-all"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Type
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* REQUESTS SECTION */}
        <section>
          <h2 className="text-lg font-bold mb-6 pb-3 border-b border-border">
            Requests
            {(requests.filter((r) => r.status === 'pending').length + backupRequests.filter((r) => r.status === 'pending').length + recoveryRequests.filter((r) => r.status === 'pending').length) > 0 && (
              <span className="ml-2 text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-semibold">
                {requests.filter((r) => r.status === 'pending').length + backupRequests.filter((r) => r.status === 'pending').length + recoveryRequests.filter((r) => r.status === 'pending').length} new
              </span>
            )}
          </h2>

          <div className="ml-6 space-y-3">
            {loadingRequests ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading requests...
              </div>
            ) : requests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No requests yet.</p>
            ) : (
              requests.map((request) => (
                <div
                  key={request.id}
                  className={`border rounded-lg p-4 transition-colors ${
                    request.status === 'resolved'
                      ? 'border-input bg-muted/20 opacity-60'
                      : 'border-input hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-semibold text-foreground">{request.user_name || 'Unknown'}</span>
                        {request.user_email && (
                          <span className="text-xs text-muted-foreground">({request.user_email})</span>
                        )}
                        {request.status === 'resolved' && (
                          <span className="text-[10px] bg-green-500/20 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded font-semibold">
                            Resolved
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {new Date(request.created_at).toLocaleString()}
                      </p>
                      <p className="text-sm text-foreground">{request.message}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {request.status === 'pending' && (
                        <button
                          onClick={() => handleResolveRequest(request.id)}
                          title="Mark as resolved"
                          className="p-1.5 text-muted-foreground hover:text-green-600 dark:hover:text-green-400 transition-colors"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteRequest(request.id)}
                        title="Delete request"
                        className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Backup Requests subsection */}
          <div className="mt-8">
            <h3 className="text-base font-semibold mb-4 pb-2 border-b border-border flex items-center gap-2">
              Backup Requests
              {backupRequests.filter((r) => r.status === 'pending').length > 0 && (
                <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full font-semibold">
                  {backupRequests.filter((r) => r.status === 'pending').length} pending
                </span>
              )}
            </h3>
            <div className="ml-6 space-y-3">
              {loadingBackupRequests ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading backup requests...
                </div>
              ) : backupRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No backup requests yet.</p>
              ) : (
                backupRequests.map((req) => {
                  const statusColors: Record<string, string> = {
                    pending:   'bg-orange-500/10 text-orange-600 dark:text-orange-400',
                    approved:  'bg-blue-500/10 text-blue-600 dark:text-blue-400',
                    fulfilled: 'bg-green-500/10 text-green-600 dark:text-green-400',
                    rejected:  'bg-red-500/10 text-red-600 dark:text-red-400',
                  };
                  return (
                    <div key={req.id} className={`border border-input rounded-lg p-4 ${req.status !== 'pending' ? 'opacity-60' : 'hover:bg-muted/30'} transition-colors`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-semibold text-foreground">{req.project_name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${statusColors[req.status]}`}>
                              {req.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">
                            {new Date(req.created_at).toLocaleString()}
                          </p>
                          <p className="text-sm text-foreground">{req.reason ?? '(no reason provided)'}</p>
                        </div>
                        {req.status === 'pending' && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleBackupRequestStatus(req.id, 'fulfilled')}
                              title="Mark as fulfilled"
                              className="p-1.5 text-muted-foreground hover:text-green-600 dark:hover:text-green-400 transition-colors"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleBackupRequestStatus(req.id, 'rejected')}
                              title="Reject"
                              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          {/* Unit Data Recovery Requests subsection */}
          <div className="mt-8">
            <h3 className="text-base font-semibold mb-4 pb-2 border-b border-border flex items-center gap-2">
              Unit Data Recovery Requests
              {recoveryRequests.filter((r) => r.status === 'pending').length > 0 && (
                <span className="text-xs bg-purple-500 text-white px-2 py-0.5 rounded-full font-semibold">
                  {recoveryRequests.filter((r) => r.status === 'pending').length} pending
                </span>
              )}
            </h3>
            <div className="ml-6 space-y-3">
              {loadingRecoveryRequests ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading recovery requests...
                </div>
              ) : recoveryRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No recovery requests yet.</p>
              ) : (
                recoveryRequests.map((req) => {
                  const statusColors: Record<string, string> = {
                    pending:  'bg-purple-500/10 text-purple-600 dark:text-purple-400',
                    approved: 'bg-green-500/10 text-green-600 dark:text-green-400',
                    rejected: 'bg-red-500/10 text-red-600 dark:text-red-400',
                  };
                  return (
                    <div key={req.id} className={`border border-input rounded-lg p-4 transition-colors ${req.status !== 'pending' ? 'opacity-60' : 'hover:bg-muted/30'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-semibold text-foreground">{req.requester_name || 'Unknown'}</span>
                            <span className="text-xs text-muted-foreground capitalize">{req.item_type}:</span>
                            <span className="text-xs font-medium text-accent">{req.item_name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${statusColors[req.status]}`}>
                              {req.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(req.created_at).toLocaleString()}
                          </p>
                        </div>
                        {req.status === 'pending' && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleRecoveryRequest(req, 'approved')}
                              title="Approve & restore"
                              className="p-1.5 text-muted-foreground hover:text-green-600 dark:hover:text-green-400 transition-colors"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleRecoveryRequest(req, 'rejected')}
                              title="Reject"
                              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
