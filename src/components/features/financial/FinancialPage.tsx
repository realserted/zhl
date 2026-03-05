'use client';

import { useRouter } from 'next/navigation';
import { ProjectPermission } from '@/lib/types/project';
import FinancialOverview from './FinancialOverview';
import FinancialAutoBooks from './FinancialAutoBooks';
import FinancialDebtSchedule from './FinancialDebtSchedule';
import FinancialReports from './FinancialReports';

interface FinancialPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null;
  subTab?: string;
}

type SubTab = 'overview' | 'autobooks' | 'debtschedule' | 'reports';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'autobooks', label: 'AutoBooks' },
  { id: 'debtschedule', label: 'Debt Schedule' },
  { id: 'reports', label: 'Reports' },
];

const VALID_SUB_TABS = new Set<string>(SUB_TABS.map((t) => t.id));

export default function FinancialPage({ selectedProjectId, userPermission, subTab }: FinancialPageProps) {
  const router = useRouter();
  const activeSubTab: SubTab = subTab && VALID_SUB_TABS.has(subTab) ? (subTab as SubTab) : 'overview';

  if (!selectedProjectId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Select a project to view financials.
      </div>
    );
  }

  const handleSubTabChange = (tabId: SubTab) => {
    router.push(`/financial/${tabId}`, { scroll: false });
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1800px] mx-auto">
      {/* Sub-tab navigation */}
      <div className="glass-card bg-background/80 backdrop-blur-md border border-white/10 rounded-2xl p-1.5 w-fit flex flex-wrap gap-1 mb-8 shadow-xl">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleSubTabChange(tab.id)}
            className={`px-5 py-2 text-sm font-bold tracking-wider uppercase rounded-xl transition-all ${
              activeSubTab === tab.id
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-100'
                : 'text-foreground hover:bg-muted/50 scale-95 hover:scale-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'overview' && (
        <FinancialOverview selectedProjectId={selectedProjectId} userPermission={userPermission} />
      )}
      {activeSubTab === 'autobooks' && (
        <FinancialAutoBooks selectedProjectId={selectedProjectId} userPermission={userPermission} />
      )}
      {activeSubTab === 'debtschedule' && (
        <FinancialDebtSchedule selectedProjectId={selectedProjectId} userPermission={userPermission} />
      )}
      {activeSubTab === 'reports' && (
        <FinancialReports selectedProjectId={selectedProjectId} userPermission={userPermission} />
      )}
    </div>
  );
}
