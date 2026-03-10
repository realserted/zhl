'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';
import { useAppState } from '../AppStateContext';

// ── Lazy-loaded tab components ────────────────────────────────────────────────
// Each bundle only downloads the first time its tab is visited.

function TabSpinner() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </main>
  );
}

const OverviewScreen = dynamic(
  () => import('@/components/features/overview/OverviewScreen'),
  { ssr: false, loading: () => <TabSpinner /> }
);
const SettingsPage = dynamic(
  () => import('@/components/features/settings/SettingsPage'),
  { ssr: false, loading: () => <TabSpinner /> }
);
const AdminPanelPage = dynamic(
  () => import('@/components/admin/AdminPanelPage'),
  { ssr: false, loading: () => <TabSpinner /> }
);
const TaskersPage = dynamic(
  () => import('@/components/features/taskers/TaskersPage'),
  { ssr: false, loading: () => <TabSpinner /> }
);
const UserLogsPage = dynamic(
  () => import('@/components/features/user-logs/UserLogsPage'),
  { ssr: false, loading: () => <TabSpinner /> }
);
const UnitDataPage = dynamic(
  () => import('@/components/features/unit-data/UnitDataPage'),
  { ssr: false, loading: () => <TabSpinner /> }
);
const AccountsPage = dynamic(
  () => import('@/components/features/accounts/AccountsPage'),
  { ssr: false, loading: () => <TabSpinner /> }
);
const FilesPage = dynamic(
  () => import('@/components/features/files/FilesPage'),
  { ssr: false, loading: () => <TabSpinner /> }
);
const MeetingsPage = dynamic(
  () => import('@/components/features/meetings/MeetingsPage'),
  { ssr: false, loading: () => <TabSpinner /> }
);

// ── Page component ────────────────────────────────────────────────────────────

export default function TabPage({ params }: { params: Promise<{ tab: string }> }) {
  // Next.js 15+ / React 19: params is a Promise — unwrap with use()
  const { tab } = use(params);

  const {
    selectedProject,
    isAdmin,
    userPermission,
    handleProjectStatusChange,
    handleProjectCreated,
    handleProjectDeleted,
  } = useAppState();

  const projectId = selectedProject?.id ?? null;

  switch (tab) {
    case 'overview':
      return <OverviewScreen selectedProjectId={projectId} />;

    case 'taskers':
      return (
        <TaskersPage
          selectedProjectId={projectId}
          selectedProjectName={selectedProject?.name ?? null}
          userPermission={userPermission}
        />
      );

    case 'unitdata':
      return (
        <UnitDataPage
          selectedProjectId={projectId}
          userPermission={userPermission}
          isAdmin={isAdmin}
        />
      );

    case 'files':
      return (
        <FilesPage
          selectedProjectId={projectId}
          userPermission={userPermission}
        />
      );

    case 'accounts':
      return (
        <AccountsPage
          selectedProjectId={projectId}
          userPermission={userPermission}
        />
      );

    case 'financial':
      redirect('/financial/overview');

    case 'settings':
      return (
        <SettingsPage
          selectedProjectId={projectId}
          selectedProjectName={selectedProject?.name ?? null}
          selectedProjectStatus={selectedProject?.status ?? null}
          onProjectCreated={handleProjectCreated}
          onProjectDeleted={handleProjectDeleted}
          onProjectStatusChange={handleProjectStatusChange}
          userPermission={userPermission}
        />
      );

    case 'admin':
      return <AdminPanelPage onProjectStatusChange={handleProjectStatusChange} />;

    case 'logs':
      return <UserLogsPage selectedProjectId={projectId} />;

    case 'meetings':
      return (
        <MeetingsPage
          selectedProjectId={projectId}
          userPermission={userPermission}
        />
      );

    case 'templates':
    case 'issues':
      return (
        <main className="flex min-h-[60vh] items-center justify-center p-4">
          <div className="glass-card bg-background/80 backdrop-blur-md border border-white/10 rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6 shadow-sm shadow-primary/5">
              <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.049.58.025 1.193-.14 1.743" />
              </svg>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-foreground mb-3">Under Development</h2>
            <p className="text-sm text-muted-foreground/80 leading-relaxed">
              This feature is currently being built and will be available soon. Stay tuned!
            </p>
          </div>
        </main>
      );

    default:
      // Unknown tab — redirect to overview
      return <OverviewScreen selectedProjectId={projectId} />;
  }
}
