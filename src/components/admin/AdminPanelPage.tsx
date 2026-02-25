'use client';

import { Plus, Upload, Loader2, ShieldAlert, Check, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Project } from '@/lib/types/project';
import { logUserAction } from '@/lib/db/user-logs';
import { AdminRequest, getAdminRequests, resolveAdminRequest, deleteAdminRequest } from '@/lib/db/admin-requests';
import { getAllBackupRequests, updateBackupRequestStatus } from '@/lib/db/files';
import { ProjectFileBackupRequest } from '@/lib/types/files';

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
  const [reportTypes, setReportTypes] = useState([
    'Wells Fargo Checki...',
    'Wells Fargo Checki...',
    'Bank of America Ch...',
    'Rent Vine Report',
    'Buildium Report',
    'Yardi Breeze Report',
    'Appfolio Report',
  ]);

  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [backupRequests, setBackupRequests] = useState<(ProjectFileBackupRequest & { project_name: string })[]>([]);
  const [loadingBackupRequests, setLoadingBackupRequests] = useState(false);

  // Check if user is admin
  useEffect(() => {
    if (!user) return;
    supabase
      .from('accounts')
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
  }, [isAdmin]);

  const loadProjects = async () => {
    setLoading(true);

    // Fetch all projects
    const { data: projectsData, error: projErr } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: true });

    if (projErr || !projectsData) {
      console.error('Error loading projects:', projErr);
      setLoading(false);
      return;
    }

    // Fetch all project_permissions to find the "Project Owner" for each project
    const { data: permsData } = await supabase
      .from('project_permissions')
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
      .from('accounts')
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

  // Update project field
  const updateProjectField = async (projectId: string, field: string, value: string | number | null) => {
    const { error } = await supabase
      .from('projects')
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
          <ShieldAlert className="h-6 w-6 text-accent" />
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <span className="text-xs bg-accent text-accent-foreground px-2 py-1 rounded-full font-semibold">AdminJon</span>
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
            <div className="overflow-x-auto border border-input rounded-lg">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-muted border-b border-input">
                    <th className="px-4 py-3 text-left font-semibold">Project Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Project Owner</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Units</th>
                    <th className="px-4 py-3 text-left font-semibold">State</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id} className="border-b border-input hover:bg-muted/50">
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
              />
            </div>

            {/* Status AI Prompt */}
            <div>
              <label className="block text-sm font-semibold mb-2">Status AI prompt</label>
              <textarea
                className="w-full border border-input rounded-md p-3 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                placeholder="Enter AI prompt for status..."
              />
              <p className="text-xs text-muted-foreground mt-1">10 words max</p>
            </div>
          </div>
        </section>

        {/* REPORT TYPES SECTION */}
        <section className="mb-12">
          <h2 className="text-lg font-bold mb-6 pb-3 border-b border-border">REPORT TYPES</h2>

          <div className="ml-6 space-y-4">
            <div className="overflow-x-auto border border-input rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-input">
                    <th className="px-4 py-3 text-left font-semibold">Type</th>
                    <th className="px-4 py-3 text-left font-semibold">AI Prompt</th>
                  </tr>
                </thead>
                <tbody>
                  {reportTypes.map((type, index) => (
                    <tr key={index} className="border-b border-input hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                          <option>{type}</option>
                          <option>Wells Fargo Checki...</option>
                          <option>Bank of America Ch...</option>
                          <option>Rent Vine Report</option>
                          <option>Buildium Report</option>
                          <option>Yardi Breeze Report</option>
                          <option>Appfolio Report</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs w-full"
                          placeholder="Enter AI prompt..."
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add New Type Button */}
            <button className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 transition-colors">
              <Plus className="h-4 w-4" />
              Add new type
            </button>
          </div>
        </section>

        {/* REQUESTS SECTION */}
        <section>
          <h2 className="text-lg font-bold mb-6 pb-3 border-b border-border">
            Requests
            {(requests.filter((r) => r.status === 'pending').length + backupRequests.filter((r) => r.status === 'pending').length) > 0 && (
              <span className="ml-2 text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-semibold">
                {requests.filter((r) => r.status === 'pending').length + backupRequests.filter((r) => r.status === 'pending').length} new
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
                    <div className="flex items-center gap-1 flex-shrink-0">
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
                          <div className="flex items-center gap-1 flex-shrink-0">
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
        </section>
      </div>
    </main>
  );
}
