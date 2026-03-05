'use client';

import { ArrowUpDown, Filter, Loader2 } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';

interface UserLog {
  id: string;
  project_id: string;
  user_name: string;
  user_email: string;
  action: string;
  created_at: string;
  project_name?: string;
}

export default function UserLogsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [filterProject, setFilterProject] = useState<string>('');
  const [filterAction, setFilterAction] = useState<string>('');
  const [filterUser, setFilterUser] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check if user is admin
  useEffect(() => {
    if (!user) return;
    const checkAdmin = async () => {
      try {
        const { data } = await supabase
          .from('zhl_accounts')
          .select('is_admin')
          .eq('user_id', user.id)
          .maybeSingle();
        setIsAdmin(data?.is_admin === true);
      } catch (err) {
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, [user]);

  // Load user logs
  const loadLogs = useCallback(async () => {
    setLoading(true);

    try {
      // Fetch all projects for project name mapping
      const { data: allProjects } = await supabase.from('zhl_projects').select('id, name');
      const projectMap = new Map(allProjects?.map((p: any) => [p.id, p.name]) ?? []);

      // Fetch logs - RLS will only return logs for current user
      // (or all logs if user is admin)
      const { data, error } = await supabase
        .from('zhl_user_logs')
        .select('*')
        .order('created_at', { ascending: sortOrder === 'asc' });

      if (error) {
        console.error('Error loading logs:', error);
        setLogs([]);
      } else {
        const formattedLogs = (data ?? []).map((log: any) => ({
          id: log.id,
          project_id: log.project_id,
          user_name: log.user_name,
          user_email: log.user_email,
          action: log.action,
          created_at: log.created_at,
          project_name: projectMap.get(log.project_id) || 'Unknown Project',
        }));
        setLogs(formattedLogs);
      }
    } catch (err) {
      console.error('Unexpected error loading logs:', err);
      setLogs([]);
    }

    setLoading(false);
  }, [sortOrder]);

  // Apply filters to logs
  const filteredLogs = logs.filter((log) => {
    if (filterProject && log.project_name !== filterProject) return false;
    if (filterAction && !log.action.toLowerCase().includes(filterAction.toLowerCase())) return false;
    if (filterUser && !log.user_email.toLowerCase().includes(filterUser.toLowerCase())) return false;
    return true;
  });

  // Get unique values for filter dropdowns
  const uniqueProjects = Array.from(new Set(logs.map((l) => l.project_name))).sort();
  const uniqueUsers = Array.from(new Set(logs.map((l) => l.user_email))).sort();

  // Load user logs when user changes or sortOrder changes
  useEffect(() => {
    if (!user) return;
    loadLogs();
  }, [user, loadLogs]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="max-w-full px-4 sm:px-6 py-6 sm:py-8">
        {/* Title and Description */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">User Logs</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Shows all your activity across projects. Admins can see all user activity.
          </p>
        </div>

        {/* Sort and Filter Section */}
        <div className="glass-card rounded-2xl p-4 mb-6 sm:mb-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-sm border border-border/50">
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider hidden sm:block">Actions:</span>
            <div className="flex w-full sm:w-auto bg-muted/50 p-1 rounded-xl border border-input">
              <button
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all text-muted-foreground hover:text-primary hover:bg-primary/10"
              >
                <ArrowUpDown className="h-4 w-4" />
                <span>SORT {sortOrder === 'desc' ? '(NEWEST)' : '(OLDEST)'}</span>
              </button>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  showFilters
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                }`}
              >
                <Filter className="h-4 w-4" />
                <span>FILTER</span>
              </button>
            </div>
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="glass-card mb-6 p-6 border border-border/50 rounded-2xl bg-muted/30 shadow-sm space-y-6 animate-in slide-in-from-top-2 fade-in duration-300">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {/* Project Filter */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Project</label>
                <select
                  value={filterProject}
                  onChange={(e) => setFilterProject(e.target.value)}
                  className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                >
                  <option value="">All Projects</option>
                  {uniqueProjects.map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
              </div>

              {/* Action Filter */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Action</label>
                <input
                  type="text"
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                  placeholder="Search actions..."
                  className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50"
                />
              </div>

              {/* User Filter (Admin only) */}
              {isAdmin && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground">User</label>
                  <select
                    value={filterUser}
                    onChange={(e) => setFilterUser(e.target.value)}
                    className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  >
                    <option value="">All Users</option>
                    {uniqueUsers.map((userEmail) => (
                      <option key={userEmail} value={userEmail}>
                        {userEmail}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Reset Filters Button */}
            {(filterProject || filterAction || filterUser) && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => {
                    setFilterProject('');
                    setFilterAction('');
                    setFilterUser('');
                  }}
                  className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground hover:text-primary transition-colors px-3 py-1.5 rounded-lg hover:bg-primary/10"
                >
                  Reset Filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* User Logs Table */}
        {loading ? (
          <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50">
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Timestamp</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">User</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Project</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody>
                {[...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="h-4 w-24 bg-muted/50 rounded animate-pulse" />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="space-y-2">
                        <div className="h-4 w-32 bg-muted/50 rounded animate-pulse" />
                        <div className="h-3 w-40 bg-muted/30 rounded animate-pulse" />
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="h-4 w-28 bg-muted/50 rounded animate-pulse" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-4 w-48 bg-muted/50 rounded animate-pulse" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-sm border border-input rounded-lg bg-muted/30">
            <p className="text-muted-foreground mb-2">No logs found</p>
            <p className="text-xs text-muted-foreground">
              Start performing actions to see your activity tracked here
            </p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-sm border border-input rounded-lg bg-muted/30">
            <p className="text-muted-foreground mb-2">No logs match your filters</p>
            <p className="text-xs text-muted-foreground">
              Try adjusting your filter criteria
            </p>
          </div>
        ) : (
          <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50">
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Timestamp</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">User</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Project</th>
                  <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors group"
                  >
                    <td className="px-4 py-4 whitespace-nowrap text-xs">{formatDate(log.created_at)}</td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div>
                        <p className="font-medium">{log.user_name}</p>
                        <p className="text-xs text-muted-foreground">{log.user_email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">{log.project_name}</td>
                    <td className="px-4 py-4">{log.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
