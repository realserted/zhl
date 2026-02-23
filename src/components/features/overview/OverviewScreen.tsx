'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { getTaskers } from '@/lib/db/taskers';
import { Tasker } from '@/lib/types/tasker';

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
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6">

        {/* ===== LEFT COLUMN ===== */}
        <div className="space-y-6">

          {/* Property Devalued By */}
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">
              Property Devalued By
            </p>
            <p className="text-3xl sm:text-4xl font-bold text-green-600 dark:text-green-400 mt-1">
              $181,280.23
            </p>
            <button className="text-xs text-green-600 dark:text-green-400 hover:underline mt-1">
              Click for Summary
            </button>
          </div>

          {/* Unit Data Issues */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-blue-600 dark:text-blue-400">Unit data Issues</h2>
          </div>

          {/* Tenant Delinquencies */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">Tenant Delinquencies</h2>
          </div>

          {/* ===== TASKERS BY USER ===== */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3">Taskers by User</h2>

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
                        <th className="pr-4 pb-1" />
                        {DAY_COLUMNS.map((d, i) => (
                          <th
                            key={d}
                            className="px-2 py-1 text-center font-bold text-foreground"
                            title={COL_LABELS[i]}
                          >
                            {d}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {userHeatmap.map((u) => (
                        <tr key={u.name}>
                          <td className="pr-4 py-1 text-foreground whitespace-nowrap font-medium">{u.name}</td>
                          {u.values.map((val, i) => (
                            <td
                              key={i}
                              className={`px-2 py-1 text-center font-bold ${val > 0 ? COL_COLORS[i] : 'text-muted-foreground/40'}`}
                              title={`${val} task${val !== 1 ? 's' : ''} — ${COL_LABELS[i]}`}
                            >
                              {val}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Column legend */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {DAY_COLUMNS.map((d, i) => (
                      <span
                        key={d}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${COL_COLORS[i]}`}
                        title={COL_LABELS[i]}
                      >
                        {d > 0 ? `+${d}d` : `${d}d`}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Historical Tracking */}
                <div className="space-y-1.5 text-xs min-w-[180px]">
                  <p className="font-semibold text-foreground mb-2">Historical Tracking by User</p>
                  {userHeatmap.map((u) => {
                    const pct = latePct(u.name);
                    return (
                      <div key={u.name} className="space-y-0.5">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-muted-foreground truncate">{u.name}</span>
                          <span className={`font-semibold tabular-nums ${pct === null ? 'text-muted-foreground/40' : pct >= 50 ? 'text-red-500' : pct >= 25 ? 'text-orange-500' : 'text-green-500'}`}>
                            {pct === null ? 'n/a' : `${pct}% late`}
                          </span>
                        </div>
                        {pct !== null && (
                          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${pct >= 50 ? 'bg-red-500' : pct >= 25 ? 'bg-orange-400' : 'bg-green-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-muted-foreground/60 mt-2 leading-tight">
                    Based on completed tasks where finish date exceeded due date.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Alert Feed */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <h2 className="text-sm font-bold text-foreground uppercase">Alert Feed</h2>
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
          <div className="bg-card border border-border rounded-xl p-5 flex flex-wrap gap-6">
            <div>
              <p className="text-sm text-foreground">
                <span className="font-bold text-orange-500">{tasksOverdue}</span>{' '}
                <span className="text-muted-foreground">overdue tasker{tasksOverdue !== 1 ? 's' : ''}</span>
              </p>
            </div>
            <div>
              <p className="text-sm text-foreground">
                <span className="font-bold">{tasksDueSoon}</span>{' '}
                <span className="text-muted-foreground">due within 7 days</span>
              </p>
            </div>
          </div>
        </div>

        {/* ===== RIGHT COLUMN ===== */}
        <div className="space-y-6">

          {/* Map of Properties */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3">Map of properties</h2>
            <div className="w-full h-48 bg-green-200/40 dark:bg-green-900/30 rounded-lg border border-border flex items-center justify-center">
              <span className="text-xs text-muted-foreground">Map placeholder</span>
            </div>
          </div>

          {/* Collection by Month */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">Collection by Month</h2>
            <p className="text-xs text-red-500 font-medium mb-3">Deliquency</p>
            <div className="w-full h-40 border border-border rounded-lg flex items-end justify-around px-4 pb-3 pt-2">
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
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3">Calendar</h2>
            <div className="w-full h-44 border border-border rounded-lg flex items-center justify-center">
              <span className="text-xs text-muted-foreground">Calendar placeholder</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
