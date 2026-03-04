'use client';

import { useTheme } from 'next-themes';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import {
  LayoutDashboard,
  ListTodo,
  Database,
  FolderOpen,
  Users,
  DollarSign,
  FileText,
  Calendar,
  AlertTriangle,
  ScrollText,
  Shield,
  Settings,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';

interface Tab {
  id: string;
  label: string;
  badge?: string;
}

interface AppSidebarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const TAB_ICONS: Record<string, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  taskers: ListTodo,
  unitdata: Database,
  files: FolderOpen,
  accounts: Users,
  financial: DollarSign,
  templates: FileText,
  meetings: Calendar,
  issues: AlertTriangle,
  logs: ScrollText,
  admin: Shield,
  settings: Settings,
};

const SIDEBAR_WIDTH_EXPANDED = 'w-60';
const SIDEBAR_WIDTH_COLLAPSED = 'w-16';

export default function AppSidebar({
  tabs,
  activeTab,
  onTabChange,
  isCollapsed,
  onToggleCollapse,
}: AppSidebarProps) {
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();
  const { user, signOut } = useAuth();

  const displayName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'User';
  const initial = displayName.charAt(0).toUpperCase();

  useEffect(() => {
    setMounted(true);
  }, []);

  const logoSrc = mounted
    ? theme === 'dark' ? '/zhl-logo-light.png' : '/zhl-logo-dark.png'
    : '/zhl-logo-dark.png';

  const handleNavClick = (tabId: string) => {
    onTabChange(tabId);
  };

  return (
    <aside
      className={`sticky top-0 h-screen bg-background border-r border-border z-40 flex flex-col transition-[width,padding] duration-300 ease-in-out flex-none shrink-0 ${
        isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED
      }`}
    >
      {/* Header — Logo + Collapse toggle */}
      <div className={`flex items-center border-b border-border px-3 py-4 ${isCollapsed ? 'justify-center py-8' : 'justify-between'}`}>
        {!isCollapsed && (
          <Image
            src={logoSrc}
            alt="Zero Hassle Landlord"
            width={120}
            height={36}
            priority
            className="h-16 w-auto"
          />
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronsRight className="h-5 w-5" />
          ) : (
            <ChevronsLeft className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab.id] || LayoutDashboard;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => handleNavClick(tab.id)}
              title={isCollapsed ? tab.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5 ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-muted'
              } ${isCollapsed ? 'justify-center' : ''}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
              {!isCollapsed && (
                <>
                  <span className="flex-1 text-left truncate">{tab.label}</span>
                  {tab.badge && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      isActive
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer — User Profile & Logout */}
      <div className="border-t border-border px-3 py-4 flex flex-col gap-4">
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-sm font-semibold shrink-0">
            {initial}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          )}
        </div>

        <button
          onClick={signOut}
          title={isCollapsed ? 'Sign Out' : undefined}
          className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors ${
            isCollapsed ? 'justify-center' : ''
          }`}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
