'use client';

import { useState } from 'react';
import { ProjectPermission } from '../../lib/types/project';
import FinancialOverview from './financial/FinancialOverview';
import FinancialAutoBooks from './financial/FinancialAutoBooks';
import FinancialDebtSchedule from './financial/FinancialDebtSchedule';
import FinancialReports from './financial/FinancialReports';

interface FinancialPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null;
}

type SubTab = 'overview' | 'autobooks' | 'debtschedule' | 'reports';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'autobooks', label: 'AutoBooks' },
  { id: 'debtschedule', label: 'Debt Schedule' },
  { id: 'reports', label: 'Reports' },
];

export default function FinancialPage({ selectedProjectId, userPermission }: FinancialPageProps) {
  const [subTab, setSubTab] = useState<SubTab>('overview');

  if (!selectedProjectId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Select a project to view financials.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Sub-tab navigation */}
      <div className="flex flex-wrap gap-1 mb-6 border border-border rounded-lg p-1 w-fit bg-muted/30">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
              subTab === tab.id
                ? 'bg-green-500 text-black'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'overview' && (
        <FinancialOverview selectedProjectId={selectedProjectId} userPermission={userPermission} />
      )}
      {subTab === 'autobooks' && (
        <FinancialAutoBooks selectedProjectId={selectedProjectId} userPermission={userPermission} />
      )}
      {subTab === 'debtschedule' && (
        <FinancialDebtSchedule selectedProjectId={selectedProjectId} userPermission={userPermission} />
      )}
      {subTab === 'reports' && (
        <FinancialReports selectedProjectId={selectedProjectId} userPermission={userPermission} />
      )}
    </div>
  );
}
