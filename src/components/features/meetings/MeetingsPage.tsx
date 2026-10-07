'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { CalendarEvent, OutOfOffice } from '@/lib/types/calendar-event';
import { ProjectPermission } from '@/lib/types/project';
import {
  getCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  getOutOfOffice, setOutOfOffice, removeOutOfOffice,
} from '@/lib/db/calendar-events';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, MapPin, X, Calendar, Users,
} from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';

interface MeetingsPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null;
}

export default function MeetingsPage({ selectedProjectId, userPermission }: MeetingsPageProps) {
  const { user } = useAuth();
  const permLevel = userPermission?.perm_meetings ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;

  // ── Calendar state ──────────────────────────────────────────────────────────
  const [calendarDate, setCalendarDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [eventForm, setEventForm] = useState({ title: '', date: '', location: '' });

  // ── OOO state ───────────────────────────────────────────────────────────────
  const [oooEntries, setOooEntries] = useState<OutOfOffice[]>([]);
  const [projectUsers, setProjectUsers] = useState<{ user_id: string; user_name: string }[]>([]);

  // Display name
  const [displayName, setDisplayName] = useState('');
  useEffect(() => {
    if (!user) return;
    supabase.from('zhl_accounts').select('display_name').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || user.email || ''));
  }, [user]);

  // Load project users
  useEffect(() => {
    if (!selectedProjectId) return;
    supabase
      .from('zhl_project_permissions')
      .select('user_id, user_name')
      .eq('project_id', selectedProjectId)
      .then(({ data }) => {
        const users = (data ?? []).filter((u): u is { user_id: string; user_name: string } => !!u.user_id);
        setProjectUsers(users);
      });
  }, [selectedProjectId]);

  // Load events
  useEffect(() => {
    if (!selectedProjectId) return;
    getCalendarEvents(selectedProjectId).then(setEvents);
  }, [selectedProjectId]);

  // Derive OOO date range from calendar month — first Monday on or before the 1st, through end of month
  const oooWeekStart = useMemo(() => {
    const first = new Date(calendarDate.year, calendarDate.month, 1);
    const day = first.getDay();
    const offset = day === 0 ? 6 : day - 1; // days back to Monday
    first.setDate(first.getDate() - offset);
    return first.toISOString().slice(0, 10);
  }, [calendarDate.year, calendarDate.month]);

  // Number of weeks to show: enough to cover the full calendar month grid
  const oooWeekCount = useMemo(() => {
    const daysInMonth = new Date(calendarDate.year, calendarDate.month + 1, 0).getDate();
    const first = new Date(calendarDate.year, calendarDate.month, 1);
    const day = first.getDay();
    const offset = day === 0 ? 6 : day - 1;
    return Math.ceil((offset + daysInMonth) / 7);
  }, [calendarDate.year, calendarDate.month]);

  const oooEndDate = useMemo(() => {
    const d = new Date(oooWeekStart);
    d.setDate(d.getDate() + oooWeekCount * 7 - 1);
    return d.toISOString().slice(0, 10);
  }, [oooWeekStart, oooWeekCount]);

  useEffect(() => {
    if (!selectedProjectId) return;
    getOutOfOffice(selectedProjectId, oooWeekStart, oooEndDate).then(setOooEntries);
  }, [selectedProjectId, oooWeekStart, oooEndDate]);

  // ── Calendar helpers ────────────────────────────────────────────────────────
  const { year, month } = calendarDate;
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const calendarDays = useMemo(() => {
    const days: (number | null)[] = [];
    for (let i = 0; i < startOffset; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  }, [startOffset, daysInMonth]);

  const eventsForDate = useCallback((day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter((e) => e.event_date === dateStr);
  }, [events, year, month]);

  const handlePrevMonth = () => setCalendarDate((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
  const handleNextMonth = () => setCalendarDate((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });

  const openCreateEvent = (day?: number) => {
    const dateStr = day
      ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : '';
    setEditingEvent(null);
    setEventForm({ title: '', date: dateStr, location: '' });
    setShowEventModal(true);
  };

  const openEditEvent = (ev: CalendarEvent) => {
    setEditingEvent(ev);
    setEventForm({ title: ev.title, date: ev.event_date, location: ev.location ?? '' });
    setShowEventModal(true);
  };

  const handleSaveEvent = async () => {
    if (!eventForm.title.trim() || !eventForm.date || !selectedProjectId || !user) return;
    if (editingEvent) {
      const ok = await updateCalendarEvent(editingEvent.id, {
        title: eventForm.title.trim(),
        event_date: eventForm.date,
        location: eventForm.location.trim() || null,
      });
      if (ok) {
        setEvents((prev) => prev.map((e) => e.id === editingEvent.id
          ? { ...e, title: eventForm.title.trim(), event_date: eventForm.date, location: eventForm.location.trim() || null }
          : e
        ));
      }
    } else {
      const ev = await createCalendarEvent(selectedProjectId, eventForm.title.trim(), eventForm.date, user.id, eventForm.location.trim() || null);
      if (ev) setEvents((prev) => [...prev, ev]);
    }
    setShowEventModal(false);
  };

  const handleDeleteEvent = async (id: string) => {
    const ok = await deleteCalendarEvent(id);
    if (ok) setEvents((prev) => prev.filter((e) => e.id !== id));
    setShowEventModal(false);
  };

  // ── OOO helpers ─────────────────────────────────────────────────────────────
  const oooWeeks = useMemo(() => {
    const weeks: string[][] = [];
    const start = new Date(oooWeekStart);
    for (let w = 0; w < oooWeekCount; w++) {
      const week: string[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        week.push(date.toISOString().slice(0, 10));
      }
      weeks.push(week);
    }
    return weeks;
  }, [oooWeekStart, oooWeekCount]);

  const oooMap = useMemo(() => {
    const m = new Map<string, OutOfOffice>();
    for (const e of oooEntries) m.set(`${e.user_id}-${e.ooo_date}`, e);
    return m;
  }, [oooEntries]);

  const handleOooCellClick = async (userId: string, userName: string, date: string) => {
    if (!selectedProjectId || !user) return;
    // Users can edit their own row; editors/admins can edit anyone's
    const isOwnRow = userId === user.id;
    if (!isOwnRow && !canEdit) return;

    const key = `${userId}-${date}`;
    const existing = oooMap.get(key);
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

  const formatDateShort = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  if (!selectedProjectId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Select a project to view meetings and availability.
      </div>
    );
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div className="p-4 sm:p-6 max-w-[1800px] mx-auto space-y-8">
      {/* ═══════ OUT-OF-OFFICE TRACKER ═══════ */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Availability</h2>
        </div>

        <div className="glass-card rounded-2xl border border-border/50 shadow-sm overflow-x-auto">
          {/* Month navigation — synced with meetings calendar */}
          <div className="flex items-center justify-between p-3 border-b border-border/50">
            <button onClick={handlePrevMonth} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-bold tracking-tight">{monthName}</span>
            <button onClick={handleNextMonth} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50">
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap sticky left-0 bg-muted/30 z-10 min-w-[120px]">
                  Name
                </th>
                {oooWeeks.flat().map((date) => {
                  const d = new Date(date + 'T00:00:00');
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const isToday2 = date === todayStr;
                  const isCurrentMonth = d.getMonth() === month && d.getFullYear() === year;
                  return (
                    <th
                      key={date}
                      className={`px-1 py-2 text-center text-[9px] font-bold uppercase tracking-wider whitespace-nowrap min-w-[40px] ${
                        isToday2 ? 'text-primary bg-primary/5' : !isCurrentMonth ? 'text-muted-foreground/30 bg-muted/5' : isWeekend ? 'text-muted-foreground/50 bg-muted/10' : 'text-muted-foreground'
                      }`}
                    >
                      <div>{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                      <div className="text-[10px]">{d.getDate()}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {projectUsers.length === 0 ? (
                <tr>
                  <td colSpan={oooWeekCount * 7 + 1} className="px-3 py-6 text-center text-muted-foreground text-sm">
                    No project members found.
                  </td>
                </tr>
              ) : (
                projectUsers.map((pu) => (
                  <tr key={pu.user_id} className={`border-b border-border/30 hover:bg-muted/10 transition-colors ${pu.user_id === user?.id ? 'bg-primary/[0.03]' : ''}`}>
                    <td className={`px-3 py-2 text-xs font-medium whitespace-nowrap sticky left-0 z-10 ${pu.user_id === user?.id ? 'bg-primary/5 text-primary font-semibold' : 'bg-background'}`}>
                      {pu.user_name}{pu.user_id === user?.id ? ' (You)' : ''}
                    </td>
                    {oooWeeks.flat().map((date) => {
                      const key = `${pu.user_id}-${date}`;
                      const entry = oooMap.get(key);
                      const d = new Date(date + 'T00:00:00');
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const canClickCell = canEdit || pu.user_id === user?.id;

                      return (
                        <td
                          key={date}
                          onClick={() => handleOooCellClick(pu.user_id, pu.user_name, date)}
                          className={`px-1 py-2 text-center text-[10px] font-bold transition-colors ${
                            canClickCell ? 'cursor-pointer' : ''
                          } ${
                            entry
                              ? 'bg-yellow-400/80 text-yellow-900 dark:bg-yellow-500/30 dark:text-yellow-300'
                              : isWeekend
                                ? 'bg-muted/10'
                                : ''
                          } ${canClickCell && !entry ? 'hover:bg-muted/30' : ''}`}
                          title={entry ? `${pu.user_name}: ${entry.note}` : canClickCell ? `Click to mark ${pu.user_name} as out` : ''}
                        >
                          {entry ? entry.note : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ═══════ MEETINGS CALENDAR ═══════ */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight">Meetings</h2>
          </div>
          {canEdit && (
            <button
              onClick={() => openCreateEvent()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold tracking-wider uppercase bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90 transition-all"
            >
              <Plus className="h-4 w-4" /> Add Meeting
            </button>
          )}
        </div>

        <div className="glass-card rounded-2xl border border-border/50 shadow-sm p-4">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={handlePrevMonth} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h3 className="text-sm font-bold tracking-tight">{monthName}</h3>
            <button onClick={handleNextMonth} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} className="min-h-[80px]" />;
              const dayEvents = eventsForDate(day);
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isToday = dateStr === todayStr;

              return (
                <div
                  key={day}
                  onClick={canEdit ? () => openCreateEvent(day) : undefined}
                  className={`min-h-[80px] rounded-lg border p-1.5 transition-colors ${
                    isToday ? 'border-primary/50 bg-primary/5' : 'border-border/30 hover:border-border/60'
                  } ${canEdit ? 'cursor-pointer' : ''}`}
                >
                  <div className={`text-xs font-bold mb-1 ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.map((ev) => (
                      <div
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); openEditEvent(ev); }}
                        className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium truncate cursor-pointer hover:bg-primary/20 transition-colors"
                        title={ev.location ? `${ev.title} @ ${ev.location}` : ev.title}
                      >
                        {ev.title}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════ EVENT MODAL ═══════ */}
      <Modal
        isOpen={showEventModal}
        onClose={() => setShowEventModal(false)}
        title={editingEvent ? 'Edit Meeting' : 'New Meeting'}
        maxWidth="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
              Title
            </label>
            <input
              autoFocus
              value={eventForm.title}
              onChange={(e) => setEventForm((p) => ({ ...p, title: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEvent(); }}
              placeholder="Meeting title..."
              className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
              Date
            </label>
            <input
              type="date"
              value={eventForm.date}
              onChange={(e) => setEventForm((p) => ({ ...p, date: e.target.value }))}
              className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
              Location
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <input
                value={eventForm.location}
                onChange={(e) => setEventForm((p) => ({ ...p, location: e.target.value }))}
                placeholder="Location (optional)"
                className="w-full pl-9 pr-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-6 pt-6 border-t border-border/50">
          <Button
            onClick={handleSaveEvent}
            disabled={!eventForm.title.trim() || !eventForm.date}
            className="w-full py-4 text-xs font-black tracking-widest shadow-xl shadow-primary/20"
          >
            {editingEvent ? 'Update' : 'Create'}
          </Button>
          {editingEvent && (
            <Button
              variant="outline"
              onClick={() => handleDeleteEvent(editingEvent.id)}
              leftIcon={<Trash2 className="h-4 w-4" />}
              className="w-full py-4 text-xs font-black tracking-widest text-destructive hover:text-destructive"
            >
              Delete Meeting
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setShowEventModal(false)}
            className="w-full py-4 text-xs font-black tracking-widest"
          >
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}
