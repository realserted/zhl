'use client';

import { useTheme } from 'next-themes';
import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import NavActions from './NavActions';
import { ThemeToggle } from './ThemeToggle';
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
  ArrowLeft,
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
  projectStatus?: string;
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

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 400;
const SIDEBAR_DEFAULT_WIDTH = 240; // w-60 = 15rem = 240px
const SIDEBAR_COLLAPSED_WIDTH = 64; // w-16 = 4rem = 64px

export default function AppSidebar({
  tabs,
  activeTab,
  onTabChange,
  isCollapsed,
  onToggleCollapse,
  projectStatus,
}: AppSidebarProps) {
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();
  const { user, signOut } = useAuth();
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const isResizing = useRef(false);

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

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + (ev.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  const width = isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  return (
    <aside
      className="sticky top-0 h-screen bg-background border-r border-border z-40 flex flex-col flex-none shrink-0 relative"
      style={{ width, transition: isResizing.current ? 'none' : 'width 300ms ease-in-out' }}
    >
      {/* Back to PRESAILING */}
      {!isCollapsed && (
        <div className="px-3 py-2 border-b border-border">
          <a
            href="https://presaling.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs font-semibold text-foreground hover:text-accent transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            <span>Back to PRESAILING</span>
          </a>
        </div>
      )}

      {/* Header — Logo + Collapse toggle */}
      <div className={`flex items-center border-b border-border px-3 py-4 ${isCollapsed ? 'justify-center py-10' : 'justify-between'}`}>
        {!isCollapsed && (
          <Image
            src={logoSrc}
            alt="Zero Hassle Landlord"
            width={120}
            height={36}
            priority
            className="h-20 w-auto"
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

      {/* Status + Add Files (below logo, above nav) */}
      {!isCollapsed && (
        <div className="px-3 py-3 border-b border-border">
          <NavActions projectStatus={projectStatus} vertical />
        </div>
      )}

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
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
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

      {/* Dark Mode Toggle */}
      <div className={`border-t border-border px-3 py-3 ${isCollapsed ? 'flex justify-center' : ''}`}>
        <ThemeToggle />
      </div>

      {/* Footer — User Profile & Logout */}
      <div className="border-t border-border px-3 py-4 flex flex-col gap-4">
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-primary text-accent-foreground flex items-center justify-center text-sm font-semibold shrink-0">
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
          className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-primary hover:text-white transition-colors ${
            isCollapsed ? 'justify-center' : ''
          }`}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span>Sign Out</span>}
        </button>
      </div>

      {/* Resize handle on right edge */}
      {!isCollapsed && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 transition-colors z-50"
        />
      )}
    </aside>
  );
}
