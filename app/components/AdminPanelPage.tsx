'use client';

import { Plus, Upload, Loader2, ShieldAlert } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '../../lib/auth-context';
import { supabase } from '../../lib/supabase';
import { Project } from '../../lib/types/project';

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

export default function AdminPanelPage() {
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

  const [requests] = useState([
    { date: '2/15/2028 16:19:02', message: 'I want Chase bank statements!' },
  ]);

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

  // Load all projects with owner info
  useEffect(() => {
    if (!isAdmin) return;
    loadProjects();
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

    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, [field]: value } : p))
    );
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
          <h2 className="text-lg font-bold mb-6 pb-3 border-b border-border">Requests</h2>

          <div className="ml-6 space-y-4">
            {requests.map((request, index) => (
              <div key={index} className="border border-input rounded-lg p-4 hover:bg-muted/30 transition-colors">
                <p className="text-xs text-muted-foreground mb-2">{request.date}</p>
                <p className="text-sm font-medium text-foreground">{request.message}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
