'use client';

import { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AppStateProvider, useAppState } from './AppStateContext';
import Navbar from '@/components/shared/Navbar';
import LoginPage from '@/components/auth/LoginPage';

function LayoutContent({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { projects, selectedProject, setSelectedProject, userPermission } = useAppState();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <>
      <Navbar
        projects={projects}
        selectedProject={selectedProject}
        onProjectChange={setSelectedProject}
        userPermission={userPermission}
      />
      {children}
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppStateProvider>
      <LayoutContent>{children}</LayoutContent>
    </AppStateProvider>
  );
}
