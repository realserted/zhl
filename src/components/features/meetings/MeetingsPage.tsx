'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { CalendarEvent, OutOfOffice } from '@/lib/types/calendar-event';
import { ProjectPermission } from '@/lib/types/project';
import { usePermission } from '@/lib/hooks/usePermission';
import {
  getCalendarEvents, getOutOfOffice, setOutOfOffice, removeOutOfOffice,
} from '@/lib/db/calendar-events';
import { getProjectSettings } from '@/lib/db/project-settings';
import {
  toDateStr, formatTime12, todayDateStr, getMonthLabel,
  buildCalendarDays, getOooDateRange, prevMonth, nextMonth, YearMonth,
} from '@/lib/calendar-utils';
import { ChevronLeft, ChevronRight, Plus, Calendar, Video } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { DayDetailModal } from './DayDetailModal';
import { ScheduleWizard } from './ScheduleWizard';

interface MeetingsPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null;
}

export default function MeetingsPage({ selectedProjectId, userPermission }: MeetingsPageProps) {
  const { user } = useAuth();
  const { canEdit } = usePermission(userPermission, 'perm_meetings');

  // ── Core state ──────────────────────────────────────────────────────────────
  const [calMonth, setCalMonth] = useState<YearMonth>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [oooEntries, setOooEntries] = useState<OutOfOffice[]>([]);
  const [projectUsers, setProjectUsers] = useState<{ user_id: string; user_name: string; user_email: string }[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // ── Project settings ────────────────────────────────────────────────────────
  const [defaultLocation, setDefaultLocation] = useState('');
  const [googleCalendarId, setGoogleCalendarId] = useState('');

  const [displayName, setDisplayName] = useState('');
  useEffect(() => {
    if (!user) return;
    supabase.from('zhl_accounts').select('display_name').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || user.email || ''));
  }, [user]);

  useEffect(() => {
    if (!selectedProjectId) return;
    getProjectSettings(selectedProjectId).then((s) => {
      setDefaultLocation(s.default_meeting_location || '');
      setGoogleCalendarId(s.google_calendar_id || '');
    });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    supabase.from('zhl_project_permissions').select('user_id, user_name, user_email').eq('project_id', selectedProjectId)
      .then(({ data }) => {
        setProjectUsers((data ?? []).filter((u): u is { user_id: string; user_name: string; user_email: string } => !!u.user_id));
      });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    getCalendarEvents(selectedProjectId).then(setEvents);
  }, [selectedProjectId]);

  // ── OOO ─────────────────────────────────────────────────────────────────────
  const oooRange = useMemo(() => getOooDateRange(calMonth.year, calMonth.month), [calMonth]);

  useEffect(() => {
    if (!selectedProjectId) return;
    getOutOfOffice(selectedProjectId, oooRange.start, oooRange.end).then(setOooEntries);
  }, [selectedProjectId, oooRange]);

  const oooMap = useMemo(() => {
    const m = new Map<string, OutOfOffice>();
    for (const e of oooEntries) m.set(`${e.user_id}-${e.ooo_date}`, e);
    return m;
  }, [oooEntries]);

  const oooForDate = useCallback((dateStr: string) => oooEntries.filter((e) => e.ooo_date === dateStr), [oooEntries]);

  const handleOooToggle = async (userId: string, userName: string, date: string) => {
    if (!selectedProjectId || !user) return;
    if (userId !== user.id && !canEdit) return;
    const existing = oooMap.get(`${userId}-${date}`);
    if (existing) {
      const ok = await removeOutOfOffice(existing.id);
      if (ok) setOooEntries((prev) => prev.filter((e) => e.id !== existing.id));
    } else {
      const note = prompt('Out-of-office note (e.g., Vacation, WFH, Doctor):', 'Out');
      if (note === null) return;
      const entry = await setOutOfOffice(selectedProjectId, userId, userName, date, note || 'Out');
      if (entry) setOooEntries((prev) => [...prev, entry]);
    }
  };

  const handleRemoveOoo = async (id: string) => {
    const ok = await removeOutOfOffice(id);
    if (ok) setOooEntries((prev) => prev.filter((e) => e.id !== id));
    return ok;
  };

  // ── Calendar grid ───────────────────────────────────────────────────────────
  const { year, month } = calMonth;
  const calendarDays = useMemo(() => buildCalendarDays(year, month), [year, month]);
  const monthLabel = getMonthLabel(year, month);
  const todayStr = todayDateStr();

  const eventsForDate = useCallback((day: number) => {
    const dateStr = toDateStr(year, month, day);
    return events.filter((e) => e.event_date === dateStr);
  }, [events, year, month]);

  // ── Schedule wizard state ───────────────────────────────────────────────────
  const [showWizard, setShowWizard] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [wizardInitialDate, setWizardInitialDate] = useState<string | undefined>();

  const openCreate = (day?: number) => {
    setEditEvent(null);
    setWizardInitialDate(day ? toDateStr(year, month, day) : undefined);
    setShowWizard(true);
  };

  const openEdit = (ev: CalendarEvent) => {
    setEditEvent(ev);
    setWizardInitialDate(undefined);
    setShowWizard(true);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!selectedProjectId) {
    return <div className="p-8 text-center text-muted-foreground">Select a project to view meetings and availability.</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1800px] mx-auto space-y-8">
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight">Meetings & Availability</h2>
          </div>
          {canEdit && (
            <Button onClick={() => openCreate()} leftIcon={<Plus className="h-4 w-4" />} size="sm">
              Schedule Meeting
            </Button>
          )}
        </div>

        <div className="glass-card rounded-2xl border border-border/50 shadow-sm p-4">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCalMonth(prevMonth)} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"><ChevronLeft className="h-5 w-5" /></button>
            <h3 className="text-sm font-bold tracking-tight">{monthLabel}</h3>
            <button onClick={() => setCalMonth(nextMonth)} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"><ChevronRight className="h-5 w-5" /></button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground py-1">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} className="min-h-[90px]" />;
              const dateStr = toDateStr(year, month, day);
              const dayEvents = eventsForDate(day);
              const dayOoo = oooForDate(dateStr);
              const isToday = dateStr === todayStr;
              const dd = new Date(dateStr + 'T00:00:00');
              const isWeekend = dd.getDay() === 0 || dd.getDay() === 6;

              return (
                <div
                  key={day}
                  onClick={() => setSelectedDay(dateStr)}
                  className={`min-h-[90px] rounded-lg border p-1.5 transition-colors cursor-pointer ${
                    isToday ? 'border-primary/50 bg-primary/5' : isWeekend ? 'border-border/20 bg-muted/5' : 'border-border/30 hover:border-border/60'
                  }`}
                >
                  <div className={`text-xs font-bold mb-1 ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>{day}</div>
                  <div className="space-y-0.5">
                    {dayEvents.map((ev) => (
                      <div
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); canEdit ? openEdit(ev) : setSelectedDay(dateStr); }}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium truncate cursor-pointer hover:bg-primary/20 transition-colors"
                        title={`${ev.title}${ev.event_time ? ' @ ' + formatTime12(ev.event_time) : ''}${ev.location ? ' — ' + ev.location : ''}`}
                      >
                        {ev.meet_link && <Video className="h-2.5 w-2.5 shrink-0 text-blue-500" />}
                        {ev.event_time && <span className="shrink-0 text-[9px] opacity-70">{formatTime12(ev.event_time)}</span>}
                        <span className="truncate">{ev.title}</span>
                      </div>
                    ))}
                    {dayOoo.map((entry) => (
                      <div key={entry.id} className="px-1.5 py-0.5 rounded bg-yellow-400/20 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300 text-[10px] font-medium truncate" title={`${entry.user_name}: ${entry.note}`}>
                        {entry.user_name.split(' ')[0]}{entry.note !== 'Out' ? ` · ${entry.note}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-primary/10 border border-primary/20" />
              <span className="text-[10px] text-muted-foreground font-medium">Meeting</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-yellow-400/20 border border-yellow-400/30" />
              <span className="text-[10px] text-muted-foreground font-medium">Out of Office</span>
            </div>
          </div>
        </div>
      </section>

      <DayDetailModal
        selectedDay={selectedDay}
        onClose={() => setSelectedDay(null)}
        events={events}
        oooEntries={oooEntries}
        canEdit={canEdit}
        userId={user?.id}
        projectUsers={projectUsers}
        oooMap={oooMap}
        onSchedule={openCreate}
        onEditEvent={openEdit}
        onRemoveOoo={handleRemoveOoo}
        onToggleOoo={handleOooToggle}
      />

      <ScheduleWizard
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        editEvent={editEvent}
        initialDate={wizardInitialDate}
        projectId={selectedProjectId}
        userId={user?.id ?? ''}
        displayName={displayName}
        projectUsers={projectUsers}
        events={events}
        defaultLocation={defaultLocation}
        googleCalendarId={googleCalendarId}
        onEventCreated={(ev) => setEvents((prev) => [...prev, ev])}
        onEventUpdated={(ev) => setEvents((prev) => prev.map((e) => e.id === ev.id ? ev : e))}
        onEventDeleted={(id) => setEvents((prev) => prev.filter((e) => e.id !== id))}
      />
    </div>
  );
}
