'use client';

import { ArrowUpDown } from 'lucide-react';
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
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from('zhl_accounts').select('is_admin').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setIsAdmin(data?.is_admin === true));
  }, [user]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data: allProjects } = await supabase.from('zhl_projects').select('id, name');
      const projectMap = new Map(allProjects?.map((p: any) => [p.id, p.name]) ?? []);

      const { data, error } = await supabase
        .from('zhl_user_logs')
        .select('*')
        .order('created_at', { ascending: sortOrder === 'asc' });

      if (error) {
        setLogs([]);
      } else {
        setLogs((data ?? []).map((log: any) => ({
          id: log.id,
          project_id: log.project_id,
          user_name: log.user_name,
          user_email: log.user_email,
          action: log.action,
          created_at: log.created_at,
          project_name: projectMap.get(log.project_id) || 'Unknown',
        })));
      }
    } catch {
      setLogs([]);
    }
    setLoading(false);
  }, [sortOrder]);

  const filteredLogs = logs.filter((log) => {
    if (filterProject && log.project_name !== filterProject) return false;
    if (filterAction && !log.action.toLowerCase().includes(filterAction.toLowerCase())) return false;
    if (filterUser && !log.user_email.toLowerCase().includes(filterUser.toLowerCase()) && !log.user_name.toLowerCase().includes(filterUser.toLowerCase())) return false;
    return true;
  });

  const uniqueProjects = Array.from(new Set(logs.map((l) => l.project_name))).sort();
  const uniqueUsers = Array.from(new Set(logs.map((l) => l.user_email))).sort();

  useEffect(() => {
    if (!user) return;
    loadLogs();
  }, [user, loadLogs]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: '2-digit', day: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const selectClass = 'px-2 py-1 bg-background/50 border border-border/50 rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/30';

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="max-w-full px-4 sm:px-6 py-4">
        {/* Header + inline filters */}
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <h1 className="text-lg font-bold mr-4">User Logs</h1>

          {/* Sort */}
          <button
            onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors border border-border/50"
          >
            <ArrowUpDown className="h-3 w-3" />
            {sortOrder === 'desc' ? 'Newest' : 'Oldest'}
          </button>

          {/* Project filter */}
          <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className={selectClass}>
            <option value="">All Projects</option>
            {uniqueProjects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          {/* Action filter */}
          <input
            type="text"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            placeholder="Filter action..."
            className={`${selectClass} w-36`}
          />

          {/* User filter (admin only) */}
          {isAdmin && (
            <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className={selectClass}>
              <option value="">All Users</option>
              {uniqueUsers.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          )}

          {/* Reset */}
          {(filterProject || filterAction || filterUser) && (
            <button
              onClick={() => { setFilterProject(''); setFilterAction(''); setFilterUser(''); }}
              className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors px-2 py-1"
            >
              Reset
            </button>
          )}
        </div>

        {/* Table */}
        <div className="glass-card rounded-xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50">
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Timestamp</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Username</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Email</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Project</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-3 py-2"><div className="h-3 w-20 bg-muted/50 rounded animate-pulse" /></td>
                    <td className="px-3 py-2"><div className="h-3 w-24 bg-muted/50 rounded animate-pulse" /></td>
                    <td className="px-3 py-2"><div className="h-3 w-32 bg-muted/50 rounded animate-pulse" /></td>
                    <td className="px-3 py-2"><div className="h-3 w-20 bg-muted/50 rounded animate-pulse" /></td>
                    <td className="px-3 py-2"><div className="h-3 w-40 bg-muted/50 rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-xs">
                    {logs.length === 0 ? 'No logs found.' : 'No logs match your filters.'}
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{formatDate(log.created_at)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-medium">{log.user_name}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{log.user_email}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{log.project_name}</td>
                    <td className="px-3 py-1.5">{log.action}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
