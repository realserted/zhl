'use client';

import { useState, useEffect } from 'react';
import { ProjectPermission } from '@/lib/types/project';
import { usePermission } from '@/lib/hooks/usePermission';
import { useUserLogger } from '@/lib/hooks/useUserLogger';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';

interface Props {
  selectedProjectId: string;
  userPermission?: ProjectPermission | null;
}

interface ReportSection {
  id: string;
  title: string;
  iconColor: string;
  iconBg: string;
}

const REPORT_SECTIONS: ReportSection[] = [
  { id: 'partner', title: 'Partner Reports', iconColor: 'text-red-500', iconBg: 'bg-red-500/10' },
  { id: 'pnl', title: 'Profit Loss Statements', iconColor: 'text-blue-500', iconBg: 'bg-blue-500/10' },
  { id: 'costseg', title: 'Cost Segregation Report', iconColor: 'text-green-500', iconBg: 'bg-green-500/10' },
  { id: 'tax', title: 'Estimated Tax Liability', iconColor: 'text-orange-500', iconBg: 'bg-orange-500/10' },
  { id: 'sellerfi', title: 'Draft update for seller fi sellers', iconColor: 'text-rose-500', iconBg: 'bg-rose-500/10' },
  { id: 'trips', title: 'Trips', iconColor: 'text-purple-500', iconBg: 'bg-purple-500/10' },
];

// Report notes are stored in localStorage per project for now
function getStorageKey(projectId: string, sectionId: string) {
  return `financial_report_${projectId}_${sectionId}`;
}

export default function FinancialReports({ selectedProjectId, userPermission }: Props) {
  const { canEdit } = usePermission(userPermission, 'perm_reports');
  const { log } = useUserLogger(selectedProjectId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['partner']));
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Load notes from localStorage
  useEffect(() => {
    const loaded: Record<string, string> = {};
    REPORT_SECTIONS.forEach((s) => {
      const val = localStorage.getItem(getStorageKey(selectedProjectId, s.id));
      if (val) loaded[s.id] = val;
    });
    setNotes(loaded);
  }, [selectedProjectId]);

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
      <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm">
        {REPORT_SECTIONS.map((section, index) => {
          const isExpanded = expanded.has(section.id);
          const isLast = index === REPORT_SECTIONS.length - 1;

          return (
            <div key={section.id} className={`transition-colors ${!isLast ? 'border-b border-border/50' : ''}`}>
              <button
                onClick={() => toggleSection(section.id)}
                className={`flex items-center gap-3 w-full text-left p-4 hover:bg-muted/30 transition-colors ${isExpanded ? 'bg-muted/10' : ''}`}
              >
                <div className={`p-1.5 rounded-lg shrink-0 ${section.iconBg}`}>
                  <FileText className={`h-4 w-4 ${section.iconColor}`} />
                </div>
                <span className="text-[13px] font-bold uppercase tracking-widest flex-1 text-foreground/90">{section.title}</span>
                <div className="shrink-0 text-muted-foreground p-1 rounded-md hover:bg-muted/50 transition-colors">
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 pt-2">
                  <div className="ml-[42px]">
                    {canEdit ? (
                      <textarea
                        value={notes[section.id] ?? ''}
                        onChange={(e) => handleNoteChange(section.id, e.target.value)}
                        onBlur={() => handleNoteBlur(section.id)}
                        placeholder={`Add notes for ${section.title}...`}
                        rows={4}
                        className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-xl text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
                      />
                    ) : (
                      <div className="px-4 py-3 bg-background/50 border border-border/50 rounded-xl text-sm text-foreground font-medium min-h-[100px]">
                        {notes[section.id] || <span className="text-muted-foreground italic">No notes yet.</span>}
                      </div>
                    )}

                    {section.id === 'sellerfi' && (
                      <div className="mt-4 p-4 rounded-xl bg-muted/20 border border-border/50 space-y-3">
                        <p className="text-xs font-semibold tracking-wide text-muted-foreground flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                          Creates tasker if no message in a minute
                        </p>
                        <p className="text-xs font-semibold tracking-wide text-blue-500 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                          Create dashboard for seller to log in for automated interest reports at year end
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
