'use client';

import { AlertCircle, Plus } from 'lucide-react';

export default function NavActions() {
  return (
    <div className="flex gap-3 items-center">
      {/* Status Display */}
      <button className="inline-flex items-center gap-2 border border-input rounded-md px-4 py-2 text-sm font-semibold bg-background hover:bg-accent text-foreground hover:text-accent-foreground transition-colors">
        <AlertCircle className="h-4 w-4" />
        Status: CRITICAL
      </button>

      {/* Add Files Button */}
      <button className="inline-flex items-center gap-2 border border-input rounded-md px-4 py-2 text-sm font-semibold bg-background hover:bg-primary hover:text-primary-foreground text-foreground transition-colors">
        <Plus className="h-4 w-4" />
        ADD FILES
      </button>
    </div>
  );
}
