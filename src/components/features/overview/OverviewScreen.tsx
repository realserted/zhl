'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { getTaskers } from '@/lib/db/taskers';
import { Tasker } from '@/lib/types/tasker';
import OverviewCalendar from './OverviewCalendar';

interface OverviewScreenProps {
  selectedProjectId?: string | null;
}

// Day-range columns: each label is the upper bound of its bucket (days from today)
const DAY_COLUMNS = [-14, -7, 0, 7, 14, 21];
const COL_COLORS = [
  'bg-red-600 text-white',
  'bg-orange-500 text-white',
  'bg-yellow-400 text-black',
  'bg-green-500 text-white',
  'bg-cyan-400 text-black',
  'bg-cyan-300 text-black',
];
const COL_LABELS = [
  '> 14 days overdue',
  '7–14 days overdue',
  '0–7 days overdue / due today',
  'Due in 1–7 days',
  'Due in 8–14 days',
  'Due in 15–21 days',
];

/** Return the bucket index (0–5) for a due date, or -1 if no due date. */
function getDueDateBucket(dueDateStr: string | null): number {
  if (!dueDateStr) return -1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00');
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < -14) return 0;
  if (days < -7)  return 1;
  if (days <= 0)  return 2;
  if (days <= 7)  return 3;
  if (days <= 14) return 4;
  return 5;
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May'];
const alerts = [
  { text: 'Winter Weather Alerts', href: '#' },
  { text: 'Law changes', href: '#' },
  { text: 'Etc', href: '#' },
];

export default function OverviewScreen({ selectedProjectId }: OverviewScreenProps) {
  const [taskers, setTaskers] = useState<Tasker[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedProjectId) { setTaskers([]); return; }
    setLoading(true);
    getTaskers(selectedProjectId).then((data) => {
      setTaskers(data);
      setLoading(false);
    });
  }, [selectedProjectId]);

  // Active (non-archived, non-complete) tasks only for the heatmap
  const activeTasks = useMemo(
    () => taskers.filter((t) => t.status !== 'Archived' && t.status !== 'Complete'),
    [taskers]
  );

  // Per-responsible-user bucket counts
  const userHeatmap = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const task of activeTasks) {
      const name = task.responsible_name;
      if (!name) continue;
      if (!map.has(name)) map.set(name, [0, 0, 0, 0, 0, 0]);
      const b = getDueDateBucket(task.due_date);
      if (b >= 0) map.get(name)![b]++;
    }
    return Array.from(map.entries())
      .map(([name, values]) => ({ name, values }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeTasks]);

  // Historical: % of completed tasks that were finished late (updated_at > due_date)
  const userLatePercent = useMemo(() => {
    const map = new Map<string, { total: number; late: number }>();
    for (const task of taskers) {
      if (task.status !== 'Complete' || !task.due_date || !task.responsible_name) continue;
      const name = task.responsible_name;
      if (!map.has(name)) map.set(name, { total: 0, late: 0 });
      const s = map.get(name)!;
      s.total++;
      // updated_at as a proxy for completion time
      if (task.updated_at.slice(0, 10) > task.due_date) s.late++;
    }
    return new Map(
      Array.from(map.entries()).map(([name, s]) => [
        name,
        s.total > 0 ? Math.round((s.late / s.total) * 100) : 0,
      ])
    );
  }, [taskers]);

  const latePct = (name: string) => {
    const pct = userLatePercent.get(name);
    return pct !== undefined ? pct : null;
  };

  const tasksDueSoon = activeTasks.filter((t) => getDueDateBucket(t.due_date) === 3).length;
  const tasksOverdue  = activeTasks.filter((t) => getDueDateBucket(t.due_date) <= 2 && getDueDateBucket(t.due_date) >= 0).length;

  return (
    <main className="min-h-screen bg-muted/30 dark:bg-background/50 p-4 sm:p-8">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8">

        {/* ===== LEFT COLUMN ===== */}
        <div className="space-y-6">

          {/* Property Devalued By */}
          <div className="glass-card rounded-2xl p-6">
            <p className="text-[11px] font-bold text-green-600 dark:text-green-400 uppercase tracking-widest opacity-80">
              Property Devalued By
            </p>
            <p className="text-4xl sm:text-5xl font-black text-green-600 dark:text-green-400 mt-2 tracking-tight">
              $181,280.23
            </p>
            <button className="text-xs font-medium text-green-600/70 dark:text-green-400/70 hover:text-green-600 dark:hover:text-green-400 transition-colors mt-3 flex items-center gap-1 group">
              View Summary
              <span className="group-hover:translate-x-0.5 transition-transform">→</span>
            </button>
          </div>

          {/* Unit Data & Tenant Delinquencies Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest opacity-80 mb-1">Unit Data Issues</h2>
              <p className="text-2xl font-bold text-foreground">12 Items</p>
            </div>
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-[11px] font-bold text-red-600 dark:text-red-400 uppercase tracking-widest opacity-80 mb-1">Tenant Delinquencies</h2>
              <p className="text-2xl font-bold text-foreground">4 Active</p>
            </div>
          </div>

          {/* ===== TASKERS BY USER ===== */}
          <div className="glass-card rounded-2xl p-6">
            <h2 className="text-sm font-bold text-foreground mb-6 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              Taskers by User
            </h2>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : !selectedProjectId ? (
              <p className="text-xs text-muted-foreground py-2">Select a project to view tasker data.</p>
            ) : userHeatmap.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No active taskers with assigned responsible users.</p>
            ) : (
              <div className="flex flex-col sm:flex-row gap-6">
                {/* Heat-map table */}
                <div className="overflow-x-auto">
                  <table className="border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="pr-6 pb-4" />
                        {DAY_COLUMNS.map((d, i) => (
                          <th
                            key={d}
                            className="px-3 pb-4 text-center text-[10px] font-black text-muted-foreground uppercase tracking-widest"
                            title={COL_LABELS[i]}
                          >
                            {d > 0 ? `+${d}d` : `${d}d`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {userHeatmap.map((u) => (
                        <tr key={u.name} className="group/row">
                          <td className="pr-6 py-2 text-foreground whitespace-nowrap font-bold text-xs group-hover/row:text-primary transition-colors">{u.name}</td>
                          {u.values.map((val, i) => (
                            <td
                              key={i}
                              className={`px-3 py-2 text-center font-black transition-all ${val > 0 ? `${COL_COLORS[i]} rounded-md shadow-sm scale-95 hover:scale-105` : 'text-muted-foreground/20'}`}
                              title={`${val} task${val !== 1 ? 's' : ''} — ${COL_LABELS[i]}`}
                            >
                              {val > 0 ? val : '·'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Column legend */}
                  <div className="mt-6 flex flex-wrap gap-3">
                    {DAY_COLUMNS.map((d, i) => (
                      <div
                        key={d}
                        className="flex items-center gap-2 group cursor-help transition-opacity hover:opacity-100 opacity-70"
                        title={COL_LABELS[i]}
                      >
                        <span className={`w-2 h-2 rounded-full ${COL_COLORS[i].split(' ')[0]}`} />
                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                          {d > 0 ? `+${d}d` : `${d}d`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Historical Tracking */}
                <div className="space-y-4 text-xs min-w-[220px] lg:border-l lg:border-border/50 lg:pl-8">
                  <div className="flex flex-col gap-1 mb-4">
                    <p className="font-bold text-foreground uppercase tracking-widest text-[10px]">Historical Tracking</p>
                    <p className="text-[10px] text-muted-foreground">Late completion average</p>
                  </div>
                  {userHeatmap.map((u) => {
                    const pct = latePct(u.name);
                    return (
                      <div key={u.name} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-muted-foreground font-medium truncate">{u.name}</span>
                          <span className={`font-black tabular-nums ${pct === null ? 'text-muted-foreground/20' : pct >= 50 ? 'text-red-500' : pct >= 25 ? 'text-orange-500' : 'text-green-500'}`}>
                            {pct === null ? 'N/A' : `${pct}%`}
                          </span>
                        </div>
                        {pct !== null && (
                          <div className="w-full h-1 bg-muted/50 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-1000 ${pct >= 50 ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]' : pct >= 25 ? 'bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.4)]' : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Alert Feed */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1.5 rounded-lg bg-yellow-500/10 dark:bg-yellow-500/20">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
              </div>
              <h2 className="text-xs font-black text-foreground uppercase tracking-widest">Alert Feed</h2>
            </div>
            <ul className="space-y-1">
              {alerts.map((alert) => (
                <li key={alert.text}>
                  <a href={alert.href} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                    {alert.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Taskers Summary */}
          <div className="glass-card rounded-2xl p-6 flex flex-wrap gap-8">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
              <p className="text-sm text-foreground">
                <span className="font-bold text-orange-500">{tasksOverdue}</span>{' '}
                <span className="text-muted-foreground font-medium">overdue taskers</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
              <p className="text-sm text-foreground">
                <span className="font-bold">{tasksDueSoon}</span>{' '}
                <span className="text-muted-foreground font-medium">due within 7 days</span>
              </p>
            </div>
          </div>
        </div>

        {/* ===== RIGHT COLUMN ===== */}
        <div className="space-y-6">

          {/* Map of Properties */}
          <div className="glass-card rounded-2xl p-6">
            <h2 className="text-sm font-bold text-foreground mb-4">Map of properties</h2>
            <div className="w-full h-48 bg-muted/30 rounded-xl border border-border/50 flex flex-col items-center justify-center gap-2 group cursor-pointer hover:bg-muted/40 transition-colors">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Interactive Map</span>
            </div>
          </div>

          {/* Collection by Month */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-sm font-bold text-foreground">Collection by Month</h2>
                <p className="text-[10px] text-red-500 font-bold uppercase tracking-wider mt-1">Delinquency</p>
              </div>
              <button className="text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-widest bg-muted/50 px-2 py-1 rounded">View Report</button>
            </div>
            <div className="w-full h-40 flex items-end justify-around px-2 pb-2">
              {months.map((m, i) => (
                <div key={m} className="flex flex-col items-center gap-1">
                  <div
                    className="w-8 bg-blue-500/20 dark:bg-blue-400/20 border border-blue-500/40 rounded-sm"
                    style={{ height: `${30 + i * 18}px` }}
                  />
                  <span className="text-[10px] text-muted-foreground">{m}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Calendar */}
          <OverviewCalendar projectId={selectedProjectId ?? null} taskers={taskers} />
        </div>
      </div>
    </main>
  );
}
