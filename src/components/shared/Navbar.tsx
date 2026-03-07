'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import NavLogo from './NavLogo';
import { ChevronDown, Bell, Loader2 } from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { Project } from '@/lib/types/project';
import { ProjectPermission } from '@/lib/types/project';
import { Notification } from '@/lib/types/notification';
import { Tasker } from '@/lib/types/tasker';
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteAllNotifications } from '@/lib/db/notifications';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';

export interface NavTab {
  id: string;
  label: string;
  permKey: string | null;
  badge?: string;
}

interface NavbarProps {
  projects: Project[];
  selectedProject: Project | null;
  onProjectChange: (project: Project) => void;
  userPermission?: ProjectPermission | null;
  onTabsComputed?: (data: { tabs: NavTab[]; activeTab: string; handleTabChange: (tabId: string) => void }) => void;
}

export default function Navbar({ projects, selectedProject, onProjectChange, userPermission, onTabsComputed }: NavbarProps) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Derive active tab from the current pathname: /taskers → 'taskers', / → 'overview'
  const rawTab = pathname === '/' ? 'overview' : pathname.replace(/^\//, '');
  // For nested routes like /financial/overview, extract the top-level tab
  const activeTab = rawTab.includes('/') ? rawTab.split('/')[0] : rawTab;
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [displayName, setDisplayName] = useState<string>('');
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  // Tasker alert counts for the TASKERS badge
  const [taskerAlerts, setTaskerAlerts] = useState({ dueSoon: 0, overdue: 0, issues: 0, help: 0 });

  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const notifDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('zhl_accounts')
      .select('is_admin, display_name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setIsAdmin(data?.is_admin === true);
        setDisplayName(data?.display_name ?? '');
      });
  }, [user]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        projectDropdownRef.current &&
        !projectDropdownRef.current.contains(event.target as Node)
      ) {
        if (openDropdown === 'project') setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown]);

  // Poll unread count every 30s
  useEffect(() => {
    if (!user) return;
    const fetch = () => getUnreadCount(user.id).then(setUnreadCount);
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Compute tasker alert counts for badge whenever the selected project changes
  useEffect(() => {
    if (!user || !selectedProject) {
      setTaskerAlerts({ dueSoon: 0, overdue: 0, issues: 0, help: 0 });
      return;
    }
    supabase
      .from('zhl_taskers')
      .select('*')
      .eq('project_id', selectedProject.id)
      .not('status', 'in', '("Archived","Complete")')
      .then(({ data }) => {
        if (!data) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const isAssigned = (t: Tasker) =>
          t.responsible === user.id ||
          t.cc === user.id ||
          t.got_the_ball === user.id ||
          t.help_request_user === user.id ||
          t.responsible_name === displayName ||
          t.cc_name === displayName ||
          t.got_the_ball_name === displayName;

        const getDays = (dueDateStr: string | null) => {
          if (!dueDateStr) return null;
          const due = new Date(dueDateStr + 'T00:00:00');
          return Math.round((due.getTime() - today.getTime()) / 86_400_000);
        };

        let dueSoon = 0, overdue = 0, issues = 0, help = 0;
        for (const t of data as Tasker[]) {
          const days = getDays(t.due_date);
          const assigned = isAssigned(t);

          if (assigned) {
            if (days !== null && days >= 1 && days <= 7) dueSoon++;
            if (days !== null && days < 0) overdue++;
            if (t.issues && t.issues.trim()) issues++;
          }

          // Help: tasks where this user is on help (regardless of other roles)
          if (
            t.help_request_user === user.id ||
            t.help_request_user_name === displayName
          ) help++;
        }
        setTaskerAlerts({ dueSoon, overdue, issues, help });
      });
  }, [user, selectedProject, displayName]);

  // Load full list when dropdown opens
  useEffect(() => {
    if (!user || !showNotifications) return;
    setLoadingNotifications(true);
    getNotifications(user.id).then((data) => {
      setNotifications(data);
      setLoadingNotifications(false);
    });
  }, [user, showNotifications]);

  // Close notification dropdown on outside click
  useEffect(() => {
    if (!showNotifications) return;
    const handler = (e: MouseEvent) => {
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNotifications]);

  const handleNotifClick = async (n: Notification) => {
    if (!n.is_read) {
      const ok = await markAsRead(n.id);
      if (ok) {
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    }
    setShowNotifications(false);
  };

  const handleMarkAllRead = async () => {
    if (!user) return;
    const ok = await markAllAsRead(user.id);
    if (ok) {
      setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
      setUnreadCount(0);
    }
  };

  const handleClearAll = async () => {
    if (!user) return;
    const ok = await deleteAllNotifications(user.id);
    if (ok) {
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  // Build dynamic TASKERS badge from alert counts
  const taskerBadgeParts: string[] = [];
  if (taskerAlerts.overdue > 0)  taskerBadgeParts.push(`${taskerAlerts.overdue} overdue`);
  if (taskerAlerts.dueSoon > 0)  taskerBadgeParts.push(`${taskerAlerts.dueSoon} due soon`);
  if (taskerAlerts.issues > 0)   taskerBadgeParts.push(`${taskerAlerts.issues} issue${taskerAlerts.issues !== 1 ? 's' : ''}`);
  if (taskerAlerts.help > 0)     taskerBadgeParts.push(`${taskerAlerts.help} help`);
  const taskerBadge = taskerBadgeParts.length > 0 ? taskerBadgeParts.join(' · ') : undefined;

  // Tab definitions with their corresponding permission key
  const allTabs = [
    { id: 'overview',   label: 'OVERVIEW',              permKey: null },
    { id: 'taskers',    label: 'TASKERS',               permKey: 'perm_taskers',   badge: taskerBadge },
    { id: 'unitdata',   label: 'UNIT DATA',             permKey: 'perm_unit_data', badge: '2 Issues' },
    { id: 'files',      label: 'FILES',                 permKey: 'perm_files' },
    ...(isAdmin || selectedProject?.owner_id === user?.id ? [{ id: 'accounts', label: 'ACCOUNTS', permKey: null }] : []),
    { id: 'financial',  label: 'FINANCIAL',             permKey: 'perm_reports',   badge: '2 Issues' },
    { id: 'templates',  label: 'TEMPLATES',             permKey: 'perm_templates' },
    { id: 'meetings',   label: 'MEETINGS & AVAILABILITY', permKey: 'perm_meetings' },
    { id: 'issues',     label: 'TENANT ISSUES',         permKey: null },
    { id: 'logs',       label: 'USER LOGS',             permKey: 'perm_user_logs' },
    ...(isAdmin ? [{ id: 'admin', label: 'ADMIN PANEL', permKey: null }] : []),
    { id: 'settings',   label: 'SETTINGS',              permKey: null },
  ];

  // Admins and project owners see all tabs; members are filtered by their permission row
  const HIDDEN_PERM_VALUES = new Set(["View / Don't view", 'None', '']);
  const isAccountant = userPermission?.project_role?.includes('Accountant') ?? false;
  const ACCOUNTANT_TABS = new Set(['overview', 'financial', 'settings']);
  const tabs = (isAdmin || !userPermission)
    ? allTabs
    : allTabs.filter((tab) => {
        // Accountants can only see financial-related tabs
        if (isAccountant) return ACCOUNTANT_TABS.has(tab.id);
        if (!tab.permKey) return true; // always show non-permission tabs
        const val = (userPermission as unknown as Record<string, string>)[tab.permKey];
        return val && !HIDDEN_PERM_VALUES.has(val);
      });

  const handleTabChange = (tabId: string) => {
    const path = tabId === 'financial' ? '/financial/overview' : `/${tabId}`;
    router.push(path, { scroll: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Expose computed tabs to parent for sidebar
  useEffect(() => {
    onTabsComputed?.({ tabs, activeTab, handleTabChange });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length, activeTab]);

  return (
    <nav className="sticky top-0 z-50 w-full bg-background border-b border-border dark:border-border">
      {/* Top Navigation Bar */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4">
        {/* Project Dropdown */}
        <div className="flex gap-4 sm:gap-8 items-center">
          <span className="text-xs sm:text-sm font-semibold text-foreground whitespace-nowrap">Project</span>

          <div className="relative" ref={projectDropdownRef}>
            <Button
              variant="ghost"
              onClick={() =>
                setOpenDropdown(openDropdown === 'project' ? null : 'project')
              }
              className="text-xs sm:text-sm font-semibold text-foreground hover:text-accent transition-colors flex items-center gap-2 h-auto py-1 px-2 shadow-none"
            >
              {selectedProject?.name ?? 'Select Project'}
              <ChevronDown
                className={`h-3 w-3 sm:h-4 sm:w-4 transition-transform ${
                  openDropdown === 'project' ? 'rotate-180' : ''
                }`}
              />
            </Button>
            {openDropdown === 'project' && (
              <div className="absolute top-full left-0 mt-2 w-32 sm:w-48 bg-background border border-input rounded-lg shadow-lg z-50">
                {projects.length === 0 ? (
                  <div className="px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-muted-foreground">
                    No projects yet
                  </div>
                ) : (
                  projects.map((project) => (
                    <Button
                      key={project.id}
                      variant="ghost"
                      onClick={() => {
                        onProjectChange(project);
                        setOpenDropdown(null);
                      }}
                      className={`w-full justify-start rounded-none px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm hover:bg-muted transition-colors h-auto shadow-none ${
                        selectedProject?.id === project.id
                          ? 'bg-muted font-semibold text-accent'
                          : ''
                      }`}
                    >
                      {project.name}
                    </Button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Section: Notifications */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="relative" ref={notifDropdownRef}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 hover:bg-muted rounded-lg transition-colors h-9 w-9 shadow-none"
              title="Notifications"
            >
              <Bell className="h-5 w-5 text-foreground" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>

            {showNotifications && (
              <div className="absolute top-full right-0 mt-2 w-80 max-h-96 bg-background border border-input rounded-lg shadow-lg z-50 overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted">
                  <h3 className="font-semibold text-sm">Notifications</h3>
                  <div className="flex items-center gap-3">
                    {unreadCount > 0 && (
                      <Button onClick={handleMarkAllRead} variant="ghost" className="text-xs text-accent hover:underline p-0 h-auto font-normal shadow-none">
                        Mark all as read
                      </Button>
                    )}
                    {notifications.length > 0 && (
                      <Button onClick={handleClearAll} variant="ghost" className="text-xs text-muted-foreground hover:text-destructive transition-colors p-0 h-auto font-normal shadow-none">
                        Clear all
                      </Button>
                    )}
                  </div>
                </div>

                {/* List */}
                <div className="overflow-y-auto flex-1">
                  {loadingNotifications ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                      Loading...
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No notifications yet
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <Button
                        key={n.id}
                        variant="ghost"
                        onClick={() => handleNotifClick(n)}
                        className={`w-full justify-start rounded-none px-4 py-3 border-b border-border hover:bg-muted transition-colors h-auto shadow-none font-normal ${
                          !n.is_read ? 'bg-blue-50 dark:bg-blue-950/20' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2 w-full">
                          {!n.is_read && (
                            <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0" />
                          )}
                          <div className={`flex-1 min-w-0 ${n.is_read ? 'ml-4' : ''}`}>
                            <p className="font-semibold text-xs text-foreground text-left">{n.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 text-left">{n.message}</p>
                            <p className="text-[10px] text-muted-foreground mt-1 text-left">
                              {new Date(n.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </Button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </nav>
  );
}

/** Expose computed tabs, activeTab, and handleTabChange for the sidebar */
export { type NavbarProps };
