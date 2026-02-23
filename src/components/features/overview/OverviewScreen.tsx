'use client';

import { AlertTriangle } from 'lucide-react';

// Taskers by User data - days columns: -14, -7, 0, 7, 14, 21
const taskerUsers = [
  { name: 'User 1', values: [1, 3, 2, 1, 6, 4] },
  { name: 'User 2', values: [1, 3, 2, 1, 6, 4] },
  { name: 'User 3', values: [1, 3, 2, 1, 6, 4] },
];

const dayColumns = [-14, -7, 0, 7, 14, 21];

// Color for each day column (red → orange → yellow → green → cyan)
const colColors = [
  'bg-red-600 text-white',
  'bg-orange-500 text-white',
  'bg-yellow-400 text-black',
  'bg-green-500 text-white',
  'bg-cyan-400 text-black',
  'bg-cyan-300 text-black',
];

const alerts = [
  { text: 'Winter Weather Alerts', href: '#' },
  { text: 'Law changes', href: '#' },
  { text: 'Etc', href: '#' },
];

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May'];

export default function OverviewScreen() {
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

          {/* Taskers by User */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3">Taskers by User</h2>
            <div className="flex flex-col sm:flex-row gap-6">
              {/* Heat-map table */}
              <div className="overflow-x-auto">
                <table className="border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="pr-3" />
                      {dayColumns.map((d) => (
                        <th key={d} className="px-2 py-1 text-center font-bold text-foreground">
                          {d}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {taskerUsers.map((user) => (
                      <tr key={user.name}>
                        <td className="pr-3 py-1 text-foreground whitespace-nowrap">{user.name}</td>
                        {user.values.map((val, i) => (
                          <td key={i} className={`px-2 py-1 text-center font-bold ${colColors[i]}`}>
                            {val}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Historical Tracking */}
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-foreground mb-1">Historical Tracking by User</p>
                {taskerUsers.map((user) => (
                  <p key={user.name} className="text-muted-foreground">% of time they are late</p>
                ))}
              </div>
            </div>
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

          {/* Taskers Due Soon */}
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-sm text-foreground">
              <span className="font-bold">4</span> Taskers due{' '}
              <span className="text-muted-foreground">soon</span>
            </p>
            <p className="text-xs text-muted-foreground">etdc</p>
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
