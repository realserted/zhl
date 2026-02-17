'use client';

import { ArrowUpDown, Filter, Loader2 } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../lib/auth-context';
import { supabase } from '../../lib/supabase';

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
  const [isAdmin, setIsAdmin] = useState(false);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

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

  // Load user logs
  useEffect(() => {
    if (!user) return;
    loadLogs();
  }, [user, isAdmin, sortOrder]);

  const loadLogs = useCallback(async () => {
    setLoading(true);

    try {
      // Fetch all projects first
      const { data: allProjects } = await supabase.from('projects').select('id, name');
      const projectMap = new Map(allProjects?.map((p: any) => [p.id, p.name]) ?? []);

      let query = supabase
        .from('user_logs')
        .select('*')
        .order('created_at', { ascending: sortOrder === 'asc' });

      // If not admin, only get logs for projects user has access to
      if (!isAdmin) {
        const { data: projectIds } = await supabase
          .from('project_permissions')
          .select('project_id')
          .eq('user_id', user!.id);

        const ownedProjects = await supabase
          .from('projects')
          .select('id')
          .eq('owner_id', user!.id);

        const allProjectIds = [
          ...(projectIds?.map((p: any) => p.project_id) ?? []),
          ...(ownedProjects.data?.map((p: any) => p.id) ?? []),
        ];

        if (allProjectIds.length === 0) {
          setLogs([]);
          setLoading(false);
          return;
        }

        query = query.in('project_id', allProjectIds);
      }

      const { data, error } = await query;

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
  }, [user, isAdmin, sortOrder]);

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
            {isAdmin
              ? 'Shows all user activity across all projects'
              : 'Shows activity for all projects that you have permissions for'}
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
        </div>

        {/* User Logs Table */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground border border-input rounded-lg">
            No logs found
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
                {logs.map((log) => (
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
