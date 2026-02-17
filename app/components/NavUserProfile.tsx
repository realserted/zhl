'use client';

import { useAuth } from '../../lib/auth-context';
import { LogOut } from 'lucide-react';

export default function NavUserProfile() {
  const { user, signOut } = useAuth();

  const displayName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'User';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-2 border-l border-border pl-6">
      {/* Welcome Message */}
      <p className="text-sm font-semibold text-foreground">Welcome {displayName}</p>

      {/* User Avatar & Sign Out */}
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 bg-accent text-accent-foreground rounded-full flex items-center justify-center font-semibold text-sm">
          {initial}
        </div>
        <button
          onClick={signOut}
          title="Sign out"
          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
