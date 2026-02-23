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
          .from('accounts')
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
      const { data: allProjects } = await supabase.from('projects').select('id, name');
      const projectMap = new Map(allProjects?.map((p: any) => [p.id, p.name]) ?? []);

      // Fetch logs - RLS will only return logs for current user
      // (or all logs if user is admin)
      const { data, error } = await supabase
        .from('user_logs')
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
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 mb-6 sm:mb-8">
          <button
            onClick={() => {
              setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
            }}
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 border border-input rounded hover:bg-muted transition-colors font-medium text-xs sm:text-sm"
          >
            <ArrowUpDown className="h-3 w-3 sm:h-4 sm:w-4" />
            SORT {sortOrder === 'desc' ? '(Newest)' : '(Oldest)'}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 border border-input rounded hover:bg-muted transition-colors font-medium text-xs sm:text-sm"
          >
            <Filter className="h-3 w-3 sm:h-4 sm:w-4" />
            FILTER
          </button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="mb-6 p-4 border border-input rounded-lg bg-muted/30 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Project Filter */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold mb-2">Project</label>
                <select
                  value={filterProject}
                  onChange={(e) => setFilterProject(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded bg-background text-foreground text-xs"
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
              <div>
                <label className="block text-xs sm:text-sm font-semibold mb-2">Action</label>
                <input
                  type="text"
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                  placeholder="Search actions..."
                  className="w-full px-3 py-2 border border-input rounded bg-background text-foreground text-xs"
                />
              </div>

              {/* User Filter (Admin only) */}
              {isAdmin && (
                <div>
                  <label className="block text-xs sm:text-sm font-semibold mb-2">User</label>
                  <select
                    value={filterUser}
                    onChange={(e) => setFilterUser(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded bg-background text-foreground text-xs"
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
              <button
                onClick={() => {
                  setFilterProject('');
                  setFilterAction('');
                  setFilterUser('');
                }}
                className="text-xs sm:text-sm text-accent hover:underline font-medium"
              >
                Reset Filters
              </button>
            )}
          </div>
        )}

        {/* User Logs Table */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading logs...
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
          <div className="overflow-x-auto border border-input rounded-lg">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted border-b border-input">
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Timestamp</th>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">User</th>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Project</th>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-input hover:bg-muted/50 transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-xs">{formatDate(log.created_at)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div>
                        <p className="font-medium">{log.user_name}</p>
                        <p className="text-xs text-muted-foreground">{log.user_email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{log.project_name}</td>
                    <td className="px-4 py-3">{log.action}</td>
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
