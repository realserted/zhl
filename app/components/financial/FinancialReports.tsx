'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { supabase } from '../../../lib/supabase';
import { ProjectPermission } from '../../../lib/types/project';
import { logUserAction } from '../../../lib/db/user-logs';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  selectedProjectId: string;
  userPermission?: ProjectPermission | null;
}

interface ReportSection {
  id: string;
  title: string;
  color: string;
}

const REPORT_SECTIONS: ReportSection[] = [
  { id: 'partner', title: 'Partner Reports', color: 'text-red-700 dark:text-red-400' },
  { id: 'pnl', title: 'Profit Loss Statements', color: 'text-blue-700 dark:text-blue-400' },
  { id: 'costseg', title: 'Cost Segregation Report', color: 'text-green-700 dark:text-green-400' },
  { id: 'tax', title: 'estimated tax liability', color: 'text-orange-700 dark:text-orange-400' },
  { id: 'sellerfi', title: 'Draft update for seller fi sellers', color: 'text-red-700 dark:text-red-400' },
  { id: 'trips', title: 'Trips', color: 'text-purple-700 dark:text-purple-400' },
];

// Report notes are stored in localStorage per project for now
function getStorageKey(projectId: string, sectionId: string) {
  return `financial_report_${projectId}_${sectionId}`;
}

export default function FinancialReports({ selectedProjectId, userPermission }: Props) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['partner']));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const displayNameRef = useRef('Unknown');
  const userEmailRef = useRef('');

  const permLevel = userPermission?.perm_reports ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;

  useEffect(() => {
    if (!user) return;
    userEmailRef.current = user.email || '';
    supabase.from('accounts').select('display_name').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { displayNameRef.current = data?.display_name || user.email || 'Unknown'; });
  }, [user]);

  // Load notes from localStorage
  useEffect(() => {
    const loaded: Record<string, string> = {};
    REPORT_SECTIONS.forEach((s) => {
      const val = localStorage.getItem(getStorageKey(selectedProjectId, s.id));
      if (val) loaded[s.id] = val;
    });
    setNotes(loaded);
  }, [selectedProjectId]);

  const log = (action: string) => {
    if (!user) return;
    logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action });
  };

  const toggleSection = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNoteChange = (sectionId: string, value: string) => {
    setNotes((prev) => ({ ...prev, [sectionId]: value }));
    localStorage.setItem(getStorageKey(selectedProjectId, sectionId), value);
  };

  const handleNoteBlur = (sectionId: string) => {
    const section = REPORT_SECTIONS.find((s) => s.id === sectionId);
    if (section && notes[sectionId]) {
      log(`Updated ${section.title} notes`);
    }
  };

  return (
    <div className="max-w-4xl">
      {REPORT_SECTIONS.map((section) => {
        const isExpanded = expanded.has(section.id);

        return (
          <div key={section.id} className="mb-4">
            <button
              onClick={() => toggleSection(section.id)}
              className="flex items-center gap-2 w-full text-left py-3 hover:bg-muted/30 rounded px-2 transition-colors"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <span className={`text-sm font-bold ${section.color}`}>{section.title}</span>
            </button>

            {isExpanded && (
              <div className="ml-8 mt-1 mb-4">
                {canEdit ? (
                  <textarea
                    value={notes[section.id] ?? ''}
                    onChange={(e) => handleNoteChange(section.id, e.target.value)}
                    onBlur={() => handleNoteBlur(section.id)}
                    placeholder={`Add notes for ${section.title}...`}
                    rows={4}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {notes[section.id] || 'No notes yet.'}
                  </div>
                )}

                {section.id === 'sellerfi' && (
                  <p className="text-xs text-muted-foreground mt-2 ml-4">
                    creates tasker if no message in a minute
                  </p>
                )}
                {section.id === 'sellerfi' && (
                  <p className="text-xs text-blue-500 mt-1 ml-4">
                    create dashboard for seller to log in for automated interest reports at year end
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
