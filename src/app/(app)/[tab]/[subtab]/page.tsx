'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';
import { useAppState } from '../../AppStateContext';

function TabSpinner() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </main>
  );
}

const FinancialPage = dynamic(
  () => import('@/components/features/financial/FinancialPage'),
  { ssr: false, loading: () => <TabSpinner /> }
);

export default function SubTabPage({ params }: { params: Promise<{ tab: string; subtab: string }> }) {
  const { tab, subtab } = use(params);
  const { selectedProject, userPermission } = useAppState();
  const projectId = selectedProject?.id ?? null;

  if (tab === 'financial') {
    return (
      <FinancialPage
        selectedProjectId={projectId}
        userPermission={userPermission}
        subTab={subtab}
      />
    );
  }

  // For non-financial tabs with subtabs, fallback
  return null;
}
