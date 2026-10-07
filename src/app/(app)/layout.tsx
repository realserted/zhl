'use client';

import { ReactNode, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { AppStateProvider, useAppState } from './AppStateContext';
import Navbar, { NavTab } from '@/components/shared/Navbar';
import AppSidebar from '@/components/shared/AppSidebar';

interface TabData {
  tabs: NavTab[];
  activeTab: string;
  handleTabChange: (tabId: string) => void;
}

function LayoutContent({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { projects, selectedProject, setSelectedProject, userPermission } = useAppState();
  const router = useRouter();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const tabDataRef = useRef<TabData>({ tabs: [], activeTab: '', handleTabChange: () => {} });
  const [tabData, setTabData] = useState<TabData>(tabDataRef.current);

  const handleTabsComputed = useCallback((data: TabData) => {
    tabDataRef.current = data;
    setTabData(data);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar
        tabs={tabData.tabs}
        activeTab={tabData.activeTab}
        onTabChange={tabData.handleTabChange}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        projectStatus={selectedProject?.status}
        selectedProjectId={selectedProject?.id ?? null}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar
          projects={projects}
          selectedProject={selectedProject}
          onProjectChange={setSelectedProject}
          userPermission={userPermission}
          onTabsComputed={handleTabsComputed}
        />
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}


export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppStateProvider>
      <LayoutContent>{children}</LayoutContent>
    </AppStateProvider>
  );
}
