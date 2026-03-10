'use client';

import { ArrowUpDown, X } from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAppState } from '@/app/(app)/AppStateContext';
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

interface UserLogsPageProps {
  selectedProjectId?: string | null;
}

export default function UserLogsPage({ selectedProjectId }: UserLogsPageProps) {
  const { user } = useAuth();
  const { isAdmin } = useAppState();
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [filterAction, setFilterAction] = useState<string>('');
  const [filterUsers, setFilterUsers] = useState<string[]>([]);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data: allProjects } = await supabase.from('zhl_projects').select('id, name');
      const projectMap = new Map(allProjects?.map((p: any) => [p.id, p.name]) ?? []);

      // Fetch display names via SECURITY DEFINER RPC (bypasses RLS)
      const { data: accountNames } = await supabase.rpc('get_account_display_names');
      const displayNameMap = new Map((accountNames ?? []).map((a: any) => [a.user_id, a.display_name]));

      // Fetch admin user IDs via SECURITY DEFINER RPC (bypasses RLS)
      const { data: adminUserIds } = await supabase.rpc('get_admin_user_ids');
      const adminIds = new Set((adminUserIds ?? []) as string[]);

      let query = supabase
        .from('zhl_user_logs')
        .select('*')
        .order('created_at', { ascending: sortOrder === 'asc' });

      // Scope to selected project if provided
      if (selectedProjectId) {
        query = query.eq('project_id', selectedProjectId);
      }

      const { data, error } = await query;

      if (error) {
        setLogs([]);
      } else {
        const filtered = (data ?? [])
          // Hide admin logs from non-admin viewers
          .filter((log: any) => isAdmin || !adminIds.has(log.user_id))
          .map((log: any) => {
            const storedName = log.user_name ?? '';
            const displayName = displayNameMap.get(log.user_id);
            const resolvedName = (storedName.includes('@') && displayName) ? displayName : storedName;
            return {
              id: log.id,
              project_id: log.project_id,
              user_name: resolvedName || log.user_email,
              user_email: log.user_email,
              action: log.action,
              created_at: log.created_at,
              project_name: projectMap.get(log.project_id) || 'Unknown',
            };
          });
        setLogs(filtered);
      }
    } catch {
      setLogs([]);
    }
    setLoading(false);
  }, [sortOrder, selectedProjectId, isAdmin]);

  const filteredLogs = logs.filter((log) => {
    if (filterAction && !log.action.toLowerCase().includes(filterAction.toLowerCase())) return false;
    if (filterUsers.length > 0 && !filterUsers.includes(log.user_email)) return false;
    return true;
  });

  const uniqueUsers = Array.from(new Set(logs.map((l) => l.user_email))).sort();

  useEffect(() => {
    if (!user) return;
    loadLogs();
  }, [user, loadLogs]);

  // Close user dropdown on outside click
  useEffect(() => {
    if (!showUserDropdown) return;
    const handler = (e: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUserDropdown]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: '2-digit', day: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const hasFilters = filterAction || filterUsers.length > 0;

  const selectClass = 'px-2 py-1 bg-background/50 border border-border/50 rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/30';

  const toggleUserFilter = (email: string) => {
    setFilterUsers((prev) =>
      prev.includes(email) ? prev.filter((u) => u !== email) : [...prev, email]
    );
  };

  return (
    <div className="max-w-full px-4 sm:px-6 py-4 flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      {/* Header + inline filters */}
      <div className="flex flex-wrap items-end gap-3 mb-3 shrink-0">
        <h1 className="text-lg font-bold mr-4">User Logs</h1>

        {/* Sort */}
        <button
          onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors border border-border/50"
        >
          <ArrowUpDown className="h-3 w-3" />
          {sortOrder === 'desc' ? 'Newest' : 'Oldest'}
        </button>

        {/* Action search */}
        <input
          type="text"
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          placeholder="Search actions..."
          className={`${selectClass} w-40`}
        />

        {/* User filter - multi-select dropdown */}
        {uniqueUsers.length > 1 && (
          <div className="relative" ref={userDropdownRef}>
            <button
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              className={`${selectClass} inline-flex items-center gap-1 cursor-pointer`}
            >
              {filterUsers.length === 0
                ? 'All Users'
                : `${filterUsers.length} user${filterUsers.length !== 1 ? 's' : ''} selected`}
            </button>
            {showUserDropdown && (
              <div className="absolute top-full left-0 mt-1 w-56 max-h-48 overflow-y-auto bg-background border border-border rounded-lg shadow-lg z-50">
                {uniqueUsers.map((email) => (
                  <label
                    key={email}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={filterUsers.includes(email)}
                      onChange={() => toggleUserFilter(email)}
                      className="rounded border-border"
                    />
                    <span className="truncate">{email}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Reset filters */}
        {hasFilters && (
          <button
            onClick={() => { setFilterAction(''); setFilterUsers([]); }}
            className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors px-2 py-1"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {filterUsers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2 shrink-0">
          {filterUsers.map((email) => (
            <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
              {email}
              <button onClick={() => toggleUserFilter(email)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Scrollable table with sticky header */}
      <div className="glass-card rounded-xl border border-border/50 shadow-sm flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
            <tr className="border-b border-border/50">
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Timestamp</th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Username</th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Email</th>
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
                  <td className="px-3 py-2"><div className="h-3 w-40 bg-muted/50 rounded animate-pulse" /></td>
                </tr>
              ))
            ) : filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground text-xs">
                  {logs.length === 0 ? 'No logs found.' : 'No logs match your filters.'}
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{formatDate(log.created_at)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap font-medium">{log.user_name}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{log.user_email}</td>
                  <td className="px-3 py-1.5">{log.action}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
