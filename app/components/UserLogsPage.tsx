'use client';

import { ArrowUpDown, Filter } from 'lucide-react';

export default function UserLogsPage() {
  const logs: any[] = [];

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="max-w-full px-4 sm:px-6 py-6 sm:py-8">
        {/* Title and Description */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">User Logs</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Shows for all projects that the user has permissions for
          </p>
        </div>

        {/* Sort and Filter Section */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 mb-6 sm:mb-8">
          <button className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 border border-input rounded hover:bg-muted transition-colors font-medium text-xs sm:text-sm">
            <ArrowUpDown className="h-3 w-3 sm:h-4 sm:w-4" />
            SORT
          </button>
          <button className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 border border-input rounded hover:bg-muted transition-colors font-medium text-xs sm:text-sm">
            <Filter className="h-3 w-3 sm:h-4 sm:w-4" />
            FILTER
          </button>
        </div>

        {/* User Logs Table */}
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
              {logs.map((log, index) => (
                <tr
                  key={index}
                  className="border-b border-input hover:bg-muted/50 transition-colors"
                >
                  <td className="px-4 py-3 whitespace-nowrap">{log.timestamp}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{log.user}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{log.project}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{log.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
