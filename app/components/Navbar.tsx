'use client';

import { useState, useRef, useEffect } from 'react';
import NavLogo from './NavLogo';
import NavTabs from './NavTabs';
import NavActions from './NavActions';
import NavUserProfile from './NavUserProfile';
import { ThemeToggle } from './ThemeToggle';
import { ArrowLeft, ChevronDown, Bell, Loader2 } from 'lucide-react';
import { Project } from '../../lib/types/project';
import { ProjectPermission } from '../../lib/types/project';
import { Notification } from '../../lib/types/notification';
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead } from '../../lib/db/notifications';
import { useAuth } from '../../lib/auth-context';
import { supabase } from '../../lib/supabase';

interface NavbarProps {
  projects: Project[];
  selectedProject: Project | null;
  onProjectChange: (project: Project) => void;
  onTabChange?: (tabId: string) => void;
  userPermission?: ProjectPermission | null;
}

export default function Navbar({ projects, selectedProject, onProjectChange, onTabChange, userPermission }: NavbarProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const notifDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('accounts')
      .select('is_admin')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(data?.is_admin === true));
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

  // Tab definitions with their corresponding permission key
  const allTabs = [
    { id: 'overview',   label: 'OVERVIEW',              permKey: null },
    { id: 'taskers',    label: 'TASKERS',               permKey: 'perm_taskers',   badge: '2 due soon' },
    { id: 'unitdata',   label: 'UNIT DATA',             permKey: 'perm_unit_data', badge: '2 Issues' },
    { id: 'files',      label: 'FILES',                 permKey: 'perm_files' },
    ...(isAdmin ? [{ id: 'accounts', label: 'ACCOUNTS', permKey: null }] : []),
    { id: 'financial',  label: 'FINANCIAL',             permKey: 'perm_reports',   badge: '2 Issues' },
    { id: 'templates',  label: 'TEMPLATES',             permKey: 'perm_templates' },
    { id: 'meetings',   label: 'MEETINGS & AVAILABILITY', permKey: 'perm_meetings' },
    { id: 'issues',     label: 'TENANT ISSUES',         permKey: null },
    { id: 'logs',       label: 'USER LOGS',             permKey: 'perm_user_logs' },
    ...(isAdmin ? [{ id: 'admin', label: 'ADMIN PANEL', permKey: null }] : []),
    { id: 'settings',   label: 'SETTINGS',              permKey: null },
  ];

  // If the user is a member (not owner), hide tabs where their permission is not granted
  const HIDDEN_PERM_VALUES = new Set(["View / Don't view", 'None', '']);
  const tabs = userPermission
    ? allTabs.filter((tab) => {
        if (!tab.permKey) return true; // always show non-permission tabs
        const val = (userPermission as unknown as Record<string, string>)[tab.permKey];
        return val && !HIDDEN_PERM_VALUES.has(val);
      })
    : allTabs;

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    onTabChange?.(tabId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <nav className="sticky top-0 z-50 w-full bg-background border-b border-border dark:border-border">
      {/* Back Button */}
      <div className="px-3 sm:px-6 py-2 border-b border-border">
        <a
          href="https://presaling.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-foreground hover:text-accent transition-colors"
        >
          <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">Back to PRESALING</span>
          <span className="sm:hidden">Back</span>
        </a>
      </div>

      {/* Top Navigation Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-border gap-3 sm:gap-0">
        <NavLogo />

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8 w-full sm:w-auto">
          {/* Project and Projects Dropdowns */}
          <div className="flex gap-4 sm:gap-8 items-center">
            {/* Project Label */}
            <span className="text-xs sm:text-sm font-semibold text-foreground whitespace-nowrap">Project</span>

            {/* Projects Dropdown */}
            <div className="relative" ref={projectDropdownRef}>
              <button
                onClick={() =>
                  setOpenDropdown(openDropdown === 'project' ? null : 'project')
                }
                className="text-xs sm:text-sm font-semibold text-foreground hover:text-accent transition-colors flex items-center gap-2"
              >
                {selectedProject?.name ?? 'Select Project'}
                <ChevronDown
                  className={`h-3 w-3 sm:h-4 sm:w-4 transition-transform ${
                    openDropdown === 'project' ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {openDropdown === 'project' && (
                <div className="absolute top-full left-0 mt-2 w-32 sm:w-48 bg-background border border-input rounded-lg shadow-lg z-50">
                  {projects.length === 0 ? (
                    <div className="px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-muted-foreground">
                      No projects yet
                    </div>
                  ) : (
                    projects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => {
                          onProjectChange(project);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm hover:bg-muted transition-colors ${
                          selectedProject?.id === project.id
                            ? 'bg-muted font-semibold text-accent'
                            : ''
                        }`}
                      >
                        {project.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Status and Actions */}
          <div className="hidden sm:block">
            <NavActions projectStatus={selectedProject?.status} />
          </div>
        </div>

        {/* Right Section: Notifications, Theme Toggle and User Profile */}
        <div className="flex items-center gap-2 sm:gap-4 ml-auto sm:ml-0 sm:border-l sm:border-border sm:pl-6">
          {/* Notification Bell */}
          <div className="relative" ref={notifDropdownRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 hover:bg-muted rounded-lg transition-colors"
              title="Notifications"
            >
              <Bell className="h-5 w-5 text-foreground" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute top-full right-0 mt-2 w-80 max-h-96 bg-background border border-input rounded-lg shadow-lg z-50 overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted">
                  <h3 className="font-semibold text-sm">Notifications</h3>
                  {unreadCount > 0 && (
                    <button onClick={handleMarkAllRead} className="text-xs text-accent hover:underline">
                      Mark all as read
                    </button>
                  )}
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
                      <button
                        key={n.id}
                        onClick={() => handleNotifClick(n)}
                        className={`w-full text-left px-4 py-3 border-b border-border hover:bg-muted transition-colors ${
                          !n.is_read ? 'bg-blue-50 dark:bg-blue-950/20' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {!n.is_read && (
                            <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0" />
                          )}
                          <div className={`flex-1 min-w-0 ${n.is_read ? 'ml-4' : ''}`}>
                            <p className="font-semibold text-xs text-foreground">{n.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {new Date(n.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <ThemeToggle />
          <NavUserProfile />
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="px-6 py-4 border-b border-border">
        <NavTabs tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />
      </div>
    </nav>
  );
}
