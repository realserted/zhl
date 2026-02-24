'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';
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
const FinancialPage = dynamic(
  () => import('@/components/features/financial/FinancialPage'),
  { ssr: false, loading: () => <TabSpinner /> }
);
const FilesPage = dynamic(
  () => import('@/components/features/files/FilesPage'),
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
      return (
        <FinancialPage
          selectedProjectId={projectId}
          userPermission={userPermission}
        />
      );

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
      return <UserLogsPage />;

    default:
      // Unknown tab — redirect to overview
      return <OverviewScreen selectedProjectId={projectId} />;
  }
}
