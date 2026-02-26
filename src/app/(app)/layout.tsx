'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { AppStateProvider, useAppState } from './AppStateContext';
import Navbar from '@/components/shared/Navbar';

function LayoutContent({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { projects, selectedProject, setSelectedProject, userPermission } = useAppState();
  const router = useRouter();

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
