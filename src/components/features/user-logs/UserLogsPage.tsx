'use client';

import { ArrowUpDown, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
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

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS = ['12am', '1am', '2am', '3am', '4am', '5am', '6am', '7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm'];

function getHeatmapColor(count: number, max: number): string {
  if (count === 0) return 'bg-muted/30';
  const ratio = count / max;
  if (ratio <= 0.25) return 'bg-emerald-900/60';
  if (ratio <= 0.5) return 'bg-emerald-700/70';
  if (ratio <= 0.75) return 'bg-emerald-500/80';
  return 'bg-emerald-400';
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
  const [heatmapTimezone, setHeatmapTimezone] = useState<'local' | 'utc'>('local');
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [hoveredCell, setHoveredCell] = useState<{ day: number; hour: number } | null>(null);
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

  // Build heatmap data: 7 days × 24 hours grid from filtered logs
  const heatmapData = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const usersGrid: Set<string>[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => new Set<string>()));
    let max = 0;

    for (const log of filteredLogs) {
      const date = new Date(log.created_at);
      const day = heatmapTimezone === 'utc' ? date.getUTCDay() : date.getDay();
      const hour = heatmapTimezone === 'utc' ? date.getUTCHours() : date.getHours();
      grid[day][hour]++;
      usersGrid[day][hour].add(log.user_email);
      if (grid[day][hour] > max) max = grid[day][hour];
    }

    return { grid, usersGrid, max };
  }, [filteredLogs, heatmapTimezone]);

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

  const localTzAbbr = Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || 'Local';

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

      {/* Activity Heatmap */}
      <div className="glass-card rounded-xl border border-border/50 shadow-sm mb-3 shrink-0">
        <button
          onClick={() => setShowHeatmap(!showHeatmap)}
          className="w-full flex items-center justify-between px-4 py-2.5"
        >
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Activity Heatmap</span>
          {showHeatmap ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>

        {showHeatmap && (
          <div className="px-4 pb-4">
            {/* Timezone toggle */}
            <div className="flex justify-end mb-3">
              <div className="inline-flex rounded-md border border-border/50 overflow-hidden text-[10px] font-bold uppercase tracking-wider">
                <button
                  onClick={() => setHeatmapTimezone('utc')}
                  className={`px-2.5 py-1 transition-colors ${heatmapTimezone === 'utc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                >
                  UTC
                </button>
                <button
                  onClick={() => setHeatmapTimezone('local')}
                  className={`px-2.5 py-1 transition-colors ${heatmapTimezone === 'local' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                >
                  {localTzAbbr}
                </button>
              </div>
            </div>

            {/* Heatmap grid */}
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                {/* Hour labels */}
                <div className="flex ml-10 mb-1">
                  {HOUR_LABELS.map((label, i) => (
                    <div key={i} className="flex-1 text-center text-[9px] text-muted-foreground">
                      {i % 3 === 0 ? label : ''}
                    </div>
                  ))}
                </div>

                {/* Grid rows */}
                {DAY_LABELS.map((day, dayIdx) => (
                  <div key={day} className="flex items-center gap-1 mb-0.5">
                    <span className="w-9 text-right text-[10px] text-muted-foreground font-medium shrink-0">{day}</span>
                    <div className="flex flex-1 gap-0.5">
                      {Array.from({ length: 24 }, (_, hourIdx) => {
                        const count = heatmapData.grid[dayIdx][hourIdx];
                        const userCount = heatmapData.usersGrid[dayIdx][hourIdx].size;
                        const isHovered = hoveredCell?.day === dayIdx && hoveredCell?.hour === hourIdx;
                        return (
                          <div
                            key={hourIdx}
                            className={`relative flex-1 aspect-square rounded-sm ${getHeatmapColor(count, heatmapData.max)} transition-all duration-150 cursor-default ${isHovered ? 'ring-1 ring-primary scale-110 z-10' : ''}`}
                            onMouseEnter={() => setHoveredCell({ day: dayIdx, hour: hourIdx })}
                            onMouseLeave={() => setHoveredCell(null)}
                          >
                            {isHovered && count > 0 && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-popover border border-border rounded-md shadow-lg whitespace-nowrap z-50 pointer-events-none">
                                <div className="text-[10px] font-semibold text-foreground">
                                  {day} {HOUR_LABELS[hourIdx]} {heatmapTimezone === 'utc' ? 'UTC' : localTzAbbr}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {count} action{count !== 1 ? 's' : ''} · {userCount} user{userCount !== 1 ? 's' : ''}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Legend */}
                <div className="flex items-center justify-end gap-1.5 mt-2">
                  <span className="text-[9px] text-muted-foreground">Less</span>
                  <div className="w-3 h-3 rounded-sm bg-muted/30" />
                  <div className="w-3 h-3 rounded-sm bg-emerald-900/60" />
                  <div className="w-3 h-3 rounded-sm bg-emerald-700/70" />
                  <div className="w-3 h-3 rounded-sm bg-emerald-500/80" />
                  <div className="w-3 h-3 rounded-sm bg-emerald-400" />
                  <span className="text-[9px] text-muted-foreground">More</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

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
