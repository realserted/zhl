'use client';

import { AlertCircle, CheckCircle, AlertTriangle, Plus } from 'lucide-react';

const STATUS_CONFIG: Record<string, { icon: typeof AlertCircle; colorClass: string }> = {
  Critical: { icon: AlertCircle, colorClass: 'border-red-500 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950' },
  Problematic: { icon: AlertTriangle, colorClass: 'border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950' },
  'Needs Attention': { icon: AlertTriangle, colorClass: 'border-yellow-500 text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950' },
  Good: { icon: CheckCircle, colorClass: 'border-green-500 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950' },
  Excellent: { icon: CheckCircle, colorClass: 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950' },
};

interface NavActionsProps {
  projectStatus?: string;
}

export default function NavActions({ projectStatus }: NavActionsProps) {
  const status = projectStatus || 'Good';
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG['Good'];
  const Icon = config.icon;

  return (
    <div className="flex gap-3 items-center">
      {/* Status Display */}
      <div
        className={`inline-flex items-center gap-2 border rounded-md px-4 py-2 text-sm font-semibold ${config.colorClass}`}
      >
        <Icon className="h-4 w-4" />
        Status: {status.toUpperCase()}
      </div>

      {/* Add Files Button */}
      <button className="inline-flex items-center gap-2 border border-input rounded-md px-4 py-2 text-sm font-semibold bg-background hover:bg-primary hover:text-primary-foreground text-foreground transition-colors">
        <Plus className="h-4 w-4" />
        ADD FILES
      </button>
    </div>
  );
}
