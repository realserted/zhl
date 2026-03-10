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
  ChevronLeft, ChevronRight, Plus, Trash2, MapPin, X, Calendar,
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
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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

  const oooMap = useMemo(() => {
    const m = new Map<string, OutOfOffice>();
    for (const e of oooEntries) m.set(`${e.user_id}-${e.ooo_date}`, e);
    return m;
  }, [oooEntries]);

  const formatDateShort = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const oooForDate = useCallback((dateStr: string) => {
    return oooEntries.filter((e) => e.ooo_date === dateStr);
  }, [oooEntries]);

  const handleOooModalToggle = async (userId: string, userName: string, date: string) => {
    if (!selectedProjectId || !user) return;
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
      {/* ═══════ UNIFIED CALENDAR ═══════ */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight">Meetings & Availability</h2>
          </div>
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

          {/* Calendar grid — meetings + OOO combined */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} className="min-h-[90px]" />;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
                  <div className={`text-xs font-bold mb-1 ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {/* Meetings */}
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
                    {/* OOO entries */}
                    {dayOoo.map((entry) => (
                      <div
                        key={entry.id}
                        className="px-1.5 py-0.5 rounded bg-yellow-400/20 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300 text-[10px] font-medium truncate"
                        title={`${entry.user_name}: ${entry.note}`}
                      >
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

      {/* ═══════ DAY DETAIL MODAL ═══════ */}
      <Modal
        isOpen={!!selectedDay}
        onClose={() => setSelectedDay(null)}
        title={selectedDay ? formatDateShort(selectedDay) : ''}
        maxWidth="sm"
      >
        {selectedDay && (() => {
          const dayEvents = events.filter((e) => e.event_date === selectedDay);
          const dayOoo = oooForDate(selectedDay);
          return (
            <div className="space-y-4">
              {/* ── Meetings section ── */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Meetings</p>
                {dayEvents.length > 0 ? (
                  dayEvents.map((ev) => (
                    <div key={ev.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-primary/5 border border-primary/10">
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-semibold">{ev.title}</span>
                        {ev.location && (
                          <span className="text-xs text-muted-foreground ml-2">
                            <MapPin className="h-3 w-3 inline -mt-0.5 mr-0.5" />{ev.location}
                          </span>
                        )}
                      </div>
                      {canEdit && (
                        <button
                          onClick={() => { setSelectedDay(null); openEditEvent(ev); }}
                          className="text-[10px] font-bold text-primary hover:underline ml-2 shrink-0"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground px-1">No meetings</p>
                )}
                {canEdit && (
                  <button
                    onClick={() => { setSelectedDay(null); openCreateEvent(parseInt(selectedDay.split('-')[2])); }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-primary/5 transition-colors text-left border border-dashed border-primary/20"
                  >
                    <Plus className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-primary">Add Meeting</span>
                  </button>
                )}
              </div>

              {/* ── Out of Office section ── */}
              <div className="space-y-2 pt-3 border-t border-border/50">
                <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Out of Office</p>
                {dayOoo.length > 0 && dayOoo.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-yellow-400/10 border border-yellow-400/20">
                    <div>
                      <span className="text-sm font-semibold">{entry.user_name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{entry.note}</span>
                    </div>
                    {(canEdit || entry.user_id === user?.id) && (
                      <button
                        onClick={async () => {
                          const ok = await removeOutOfOffice(entry.id);
                          if (ok) setOooEntries((prev) => prev.filter((e) => e.id !== entry.id));
                        }}
                        className="p-1 hover:bg-destructive/10 rounded-lg transition-colors"
                        title="Remove"
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </button>
                    )}
                  </div>
                ))}
                {/* Add OOO for users not already out */}
                {projectUsers
                  .filter((pu) => !oooMap.get(`${pu.user_id}-${selectedDay}`))
                  .filter((pu) => canEdit || pu.user_id === user?.id)
                  .length > 0 && (
                  <div className="space-y-1 mt-1">
                    <p className="text-[10px] text-muted-foreground px-1">Mark as out:</p>
                    {projectUsers
                      .filter((pu) => !oooMap.get(`${pu.user_id}-${selectedDay}`))
                      .filter((pu) => canEdit || pu.user_id === user?.id)
                      .map((pu) => (
                        <button
                          key={pu.user_id}
                          onClick={() => handleOooModalToggle(pu.user_id, pu.user_name, selectedDay)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-yellow-400/10 transition-colors text-left"
                        >
                          <Plus className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
                          <span className="text-xs font-medium">{pu.user_name}{pu.user_id === user?.id ? ' (You)' : ''}</span>
                        </button>
                      ))}
                  </div>
                )}
                {dayOoo.length === 0 && projectUsers
                  .filter((pu) => !oooMap.get(`${pu.user_id}-${selectedDay}`))
                  .filter((pu) => canEdit || pu.user_id === user?.id)
                  .length === 0 && (
                  <p className="text-xs text-muted-foreground px-1">No one is out</p>
                )}
              </div>

              <div className="pt-3 border-t border-border/50">
                <Button
                  variant="outline"
                  onClick={() => setSelectedDay(null)}
                  className="w-full py-3 text-xs font-black tracking-widest"
                >
                  Close
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

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
