'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { CalendarEvent, OutOfOffice } from '@/lib/types/calendar-event';
import { ProjectPermission } from '@/lib/types/project';
import {
  getCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  getOutOfOffice, setOutOfOffice, removeOutOfOffice,
  addMeetingAttendees, getMeetingAttendees,
} from '@/lib/db/calendar-events';
import { getProjectSettings } from '@/lib/db/project-settings';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, MapPin, X, Calendar, ExternalLink, Video, Clock,
  Users, Mail, UserPlus, Check, ArrowRight, ArrowLeft, Globe,
} from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';

interface MeetingsPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null;
}

// ── Time slot generation ────────────────────────────────────────────────────
const DURATIONS = [15, 30, 45, 60, 90] as const;

function generateTimeSlots(duration: number): string[] {
  const slots: string[] = [];
  // 9:00 AM to 5:00 PM
  const startHour = 9;
  const endHour = 17;
  const startMinutes = startHour * 60;
  const endMinutes = endHour * 60;

  for (let m = startMinutes; m + duration <= endMinutes; m += 30) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return slots;
}

function formatTime12(time: string): string {
  const d = new Date(`2000-01-01T${time}`);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Build a Google Calendar "Add event" URL that opens in a new tab. */
function getGoogleCalendarUrl(event: { title: string; date: string; time?: string | null; duration?: number; location?: string | null }): string {
  const dateOnly = event.date.replace(/-/g, '');
  const dur = event.duration || 60;

  let dates: string;
  if (event.time) {
    const timeStr = event.time.replace(/:/g, '') + '00';
    const start = `${dateOnly}T${timeStr}`;
    const endDt = new Date(`${event.date}T${event.time}:00`);
    endDt.setMinutes(endDt.getMinutes() + dur);
    const endDateStr = `${endDt.getFullYear()}${String(endDt.getMonth() + 1).padStart(2, '0')}${String(endDt.getDate()).padStart(2, '0')}`;
    const endTimeStr = `${String(endDt.getHours()).padStart(2, '0')}${String(endDt.getMinutes()).padStart(2, '0')}00`;
    dates = `${start}/${endDateStr}T${endTimeStr}`;
  } else {
    const endDate = new Date(event.date + 'T00:00:00');
    endDate.setDate(endDate.getDate() + 1);
    const endStr = `${endDate.getFullYear()}${String(endDate.getMonth() + 1).padStart(2, '0')}${String(endDate.getDate()).padStart(2, '0')}`;
    dates = `${dateOnly}/${endStr}`;
  }

  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates });
  if (event.location) params.set('location', event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ── Scheduling step type ────────────────────────────────────────────────────
type ScheduleStep = 'details' | 'attendees' | 'datetime' | 'review';

interface AttendeeEntry {
  user_id: string | null;
  email: string;
  display_name: string;
  is_guest: boolean;
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
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // ── OOO state ───────────────────────────────────────────────────────────────
  const [oooEntries, setOooEntries] = useState<OutOfOffice[]>([]);
  const [projectUsers, setProjectUsers] = useState<{ user_id: string; user_name: string; user_email: string }[]>([]);

  // ── Default location & Google Calendar ID from project settings ─────────────
  const [defaultLocation, setDefaultLocation] = useState('');
  const [googleCalendarId, setGoogleCalendarId] = useState('');

  // Display name
  const [displayName, setDisplayName] = useState('');
  useEffect(() => {
    if (!user) return;
    supabase.from('zhl_accounts').select('display_name').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || user.email || ''));
  }, [user]);

  // Load project settings (for default location)
  useEffect(() => {
    if (!selectedProjectId) return;
    getProjectSettings(selectedProjectId).then((s) => {
      setDefaultLocation(s.default_meeting_location || '');
      setGoogleCalendarId(s.google_calendar_id || '');
    });
  }, [selectedProjectId]);

  // Load project users
  useEffect(() => {
    if (!selectedProjectId) return;
    supabase
      .from('zhl_project_permissions')
      .select('user_id, user_name, user_email')
      .eq('project_id', selectedProjectId)
      .then(({ data }) => {
        const users = (data ?? []).filter((u): u is { user_id: string; user_name: string; user_email: string } => !!u.user_id);
        setProjectUsers(users);
      });
  }, [selectedProjectId]);

  // Load events
  useEffect(() => {
    if (!selectedProjectId) return;
    getCalendarEvents(selectedProjectId).then(setEvents);
  }, [selectedProjectId]);

  // ── OOO date range ────────────────────────────────────────────────────────
  const oooWeekStart = useMemo(() => {
    const first = new Date(calendarDate.year, calendarDate.month, 1);
    const day = first.getDay();
    const offset = day === 0 ? 6 : day - 1;
    first.setDate(first.getDate() - offset);
    return first.toISOString().slice(0, 10);
  }, [calendarDate.year, calendarDate.month]);

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
  const startOffset = (firstDay.getDay() + 6) % 7;
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

  // ══════════════════════════════════════════════════════════════════════════
  //  SCHEDULING MODAL STATE
  // ══════════════════════════════════════════════════════════════════════════
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleStep, setScheduleStep] = useState<ScheduleStep>('details');
  const [isSaving, setIsSaving] = useState(false);

  // Step 1: Details
  const [schedTitle, setSchedTitle] = useState('');
  const [schedDuration, setSchedDuration] = useState<number>(30);
  const [schedLocation, setSchedLocation] = useState('');
  const [schedMeetLink, setSchedMeetLink] = useState('');

  // Step 2: Attendees
  const [schedAttendees, setSchedAttendees] = useState<AttendeeEntry[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestName, setGuestName] = useState('');

  // Step 3: Date & Time
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [schedCalMonth, setSchedCalMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // ── Edit mode ───────────────────────────────────────────────────────────────
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  // ── Generate Google Meet link ─────────────────────────────────────────────
  const [isGeneratingMeet, setIsGeneratingMeet] = useState(false);

  const handleGenerateMeetLink = async () => {
    if (!googleCalendarId || isGeneratingMeet) return;
    setIsGeneratingMeet(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'create-meet',
          calendarId: googleCalendarId,
          event: {
            title: schedTitle.trim() || 'Meeting',
            date: schedDate || new Date().toISOString().slice(0, 10),
            time: schedTime || null,
            duration: schedDuration,
            location: schedLocation.trim() || null,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.meetLink) {
          setSchedMeetLink(data.meetLink);
        }
      }
    } catch (err) {
      console.error('Failed to generate Meet link:', err);
    } finally {
      setIsGeneratingMeet(false);
    }
  };

  // ── Schedule modal helpers ────────────────────────────────────────────────
  const resetScheduleModal = () => {
    setScheduleStep('details');
    setSchedTitle('');
    setSchedDuration(30);
    setSchedLocation(defaultLocation);
    setSchedMeetLink('');
    setSchedAttendees([]);
    setMemberSearch('');
    setGuestEmail('');
    setGuestName('');
    setSchedDate('');
    setSchedTime('');
    setEditingEvent(null);
    setIsSaving(false);
    setIsGeneratingMeet(false);
    const now = new Date();
    setSchedCalMonth({ year: now.getFullYear(), month: now.getMonth() });
  };

  const openCreateSchedule = (day?: number) => {
    resetScheduleModal();
    if (day) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      setSchedDate(dateStr);
    }
    setSchedLocation(defaultLocation);
    setShowScheduleModal(true);
  };

  const openEditSchedule = async (ev: CalendarEvent) => {
    resetScheduleModal();
    setEditingEvent(ev);
    setSchedTitle(ev.title);
    setSchedDuration(ev.duration || 30);
    setSchedLocation(ev.location ?? '');
    setSchedMeetLink(ev.meet_link ?? '');
    setSchedDate(ev.event_date);
    setSchedTime(ev.event_time ?? '');
    // Load existing attendees
    const att = await getMeetingAttendees(ev.id);
    setSchedAttendees(att.map((a) => ({
      user_id: a.user_id,
      email: a.email,
      display_name: a.display_name,
      is_guest: a.is_guest,
    })));
    setShowScheduleModal(true);
  };

  // ── Add member attendee ───────────────────────────────────────────────────
  const filteredMembers = useMemo(() => {
    const search = memberSearch.toLowerCase();
    return projectUsers.filter((pu) => {
      if (schedAttendees.some((a) => a.user_id === pu.user_id)) return false;
      if (pu.user_id === user?.id) return false; // organizer is implicit
      if (!search) return true;
      return pu.user_name.toLowerCase().includes(search) || pu.user_email?.toLowerCase().includes(search);
    });
  }, [projectUsers, memberSearch, schedAttendees, user?.id]);

  const addMemberAttendee = (pu: { user_id: string; user_name: string; user_email: string }) => {
    setSchedAttendees((prev) => [...prev, {
      user_id: pu.user_id,
      email: pu.user_email,
      display_name: pu.user_name,
      is_guest: false,
    }]);
    setMemberSearch('');
  };

  const addGuestAttendee = () => {
    const email = guestEmail.trim();
    const name = guestName.trim() || email;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    if (schedAttendees.some((a) => a.email === email)) return;
    setSchedAttendees((prev) => [...prev, { user_id: null, email, display_name: name, is_guest: true }]);
    setGuestEmail('');
    setGuestName('');
  };

  const removeAttendee = (email: string) => {
    setSchedAttendees((prev) => prev.filter((a) => a.email !== email));
  };

  // ── Mini calendar for date picker in step 3 ──────────────────────────────
  const schedCalDays = useMemo(() => {
    const first = new Date(schedCalMonth.year, schedCalMonth.month, 1);
    const offset = (first.getDay() + 6) % 7;
    const dim = new Date(schedCalMonth.year, schedCalMonth.month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < offset; i++) days.push(null);
    for (let d = 1; d <= dim; d++) days.push(d);
    return days;
  }, [schedCalMonth]);

  const schedMonthName = new Date(schedCalMonth.year, schedCalMonth.month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const timeSlots = useMemo(() => generateTimeSlots(schedDuration), [schedDuration]);

  // Check if a time slot conflicts with existing events on the selected date
  const isSlotTaken = useCallback((slot: string) => {
    if (!schedDate) return false;
    const dayEvents = events.filter((e) => e.event_date === schedDate && e.event_time);
    const slotStart = parseInt(slot.split(':')[0]) * 60 + parseInt(slot.split(':')[1]);
    const slotEnd = slotStart + schedDuration;

    for (const ev of dayEvents) {
      if (editingEvent && ev.id === editingEvent.id) continue;
      const evStart = parseInt(ev.event_time!.split(':')[0]) * 60 + parseInt(ev.event_time!.split(':')[1]);
      const evEnd = evStart + (ev.duration || 30);
      if (slotStart < evEnd && slotEnd > evStart) return true;
    }
    return false;
  }, [schedDate, events, schedDuration, editingEvent]);

  // ── Save meeting ──────────────────────────────────────────────────────────
  const handleSaveMeeting = async () => {
    if (!schedTitle.trim() || !schedDate || !selectedProjectId || !user) return;
    setIsSaving(true);

    try {
      let eventId: string;

      if (editingEvent) {
        const ok = await updateCalendarEvent(editingEvent.id, {
          title: schedTitle.trim(),
          event_date: schedDate,
          event_time: schedTime || null,
          duration: schedDuration,
          location: schedLocation.trim() || null,
          meet_link: schedMeetLink.trim() || null,
        });
        if (!ok) { setIsSaving(false); return; }
        eventId = editingEvent.id;
        setEvents((prev) => prev.map((e) => e.id === editingEvent.id
          ? { ...e, title: schedTitle.trim(), event_date: schedDate, event_time: schedTime || null, duration: schedDuration, location: schedLocation.trim() || null, meet_link: schedMeetLink.trim() || null }
          : e
        ));
      } else {
        const ev = await createCalendarEvent(selectedProjectId, schedTitle.trim(), schedDate, user.id, schedLocation.trim() || null, schedMeetLink.trim() || null, schedTime || null, schedDuration);
        if (!ev) { setIsSaving(false); return; }
        eventId = ev.id;
        setEvents((prev) => [...prev, ev]);
      }

      // Save attendees
      if (schedAttendees.length > 0) {
        await addMeetingAttendees(eventId, schedAttendees);
      }

      // Send email invitations (fire and forget)
      if (schedAttendees.length > 0) {
        fetch('/api/meetings/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attendees: schedAttendees.map((a) => ({ email: a.email, display_name: a.display_name })),
            meeting: {
              title: schedTitle.trim(),
              date: schedDate,
              time: schedTime || null,
              duration: schedDuration,
              location: schedLocation.trim() || null,
              meet_link: schedMeetLink.trim() || null,
              organizer_name: displayName,
            },
          }),
        }).catch(() => {});
      }

      setShowScheduleModal(false);
      resetScheduleModal();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    const ok = await deleteCalendarEvent(id);
    if (ok) setEvents((prev) => prev.filter((e) => e.id !== id));
    setShowScheduleModal(false);
    resetScheduleModal();
  };

  // ── Step validation ───────────────────────────────────────────────────────
  const canGoToStep = (step: ScheduleStep): boolean => {
    switch (step) {
      case 'details': return true;
      case 'attendees': return !!schedTitle.trim();
      case 'datetime': return !!schedTitle.trim();
      case 'review': return !!schedTitle.trim() && !!schedDate;
      default: return false;
    }
  };

  const stepOrder: ScheduleStep[] = ['details', 'attendees', 'datetime', 'review'];
  const currentStepIndex = stepOrder.indexOf(scheduleStep);

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
          {canEdit && (
            <Button onClick={() => openCreateSchedule()} leftIcon={<Plus className="h-4 w-4" />} size="sm">
              Schedule Meeting
            </Button>
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
                    {dayEvents.map((ev) => (
                      <div
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); canEdit ? openEditSchedule(ev) : setSelectedDay(dateStr); }}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium truncate cursor-pointer hover:bg-primary/20 transition-colors"
                        title={`${ev.title}${ev.event_time ? ' @ ' + formatTime12(ev.event_time) : ''}${ev.location ? ' — ' + ev.location : ''}`}
                      >
                        {ev.meet_link && <Video className="h-2.5 w-2.5 shrink-0 text-blue-500" />}
                        {ev.event_time && <span className="shrink-0 text-[9px] opacity-70">{formatTime12(ev.event_time)}</span>}
                        <span className="truncate">{ev.title}</span>
                      </div>
                    ))}
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
              {/* Meetings section */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Meetings</p>
                {dayEvents.length > 0 ? (
                  dayEvents.map((ev) => (
                    <div key={ev.id} className="px-3 py-2 rounded-xl bg-primary/5 border border-primary/10 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-semibold">{ev.title}</span>
                          {ev.event_time && (
                            <span className="text-xs text-muted-foreground ml-2">
                              <Clock className="h-3 w-3 inline -mt-0.5 mr-0.5" />
                              {formatTime12(ev.event_time)}
                              <span className="ml-1 opacity-60">({ev.duration || 30}m)</span>
                            </span>
                          )}
                          {ev.location && (
                            <span className="text-xs text-muted-foreground ml-2">
                              <MapPin className="h-3 w-3 inline -mt-0.5 mr-0.5" />{ev.location}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 ml-2 shrink-0">
                          <a
                            href={getGoogleCalendarUrl({ title: ev.title, date: ev.event_date, time: ev.event_time, duration: ev.duration, location: ev.location })}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                            title="Add to Google Calendar"
                          >
                            GCal
                          </a>
                          {canEdit && (
                            <button
                              onClick={() => { setSelectedDay(null); openEditSchedule(ev); }}
                              className="text-[10px] font-bold text-primary hover:underline"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                      {ev.meet_link && (
                        <a
                          href={ev.meet_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
                        >
                          <Video className="h-3 w-3" />
                          Join Meeting
                          <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                        </a>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground px-1">No meetings</p>
                )}
                {canEdit && (
                  <button
                    onClick={() => { setSelectedDay(null); openCreateSchedule(parseInt(selectedDay.split('-')[2])); }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-primary/5 transition-colors text-left border border-dashed border-primary/20"
                  >
                    <Plus className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-primary">Schedule Meeting</span>
                  </button>
                )}
              </div>

              {/* Out of Office section */}
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
                <Button variant="outline" onClick={() => setSelectedDay(null)} className="w-full py-3 text-xs font-black tracking-widest">
                  Close
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════
          SCHEDULE MEETING MODAL — Multi-step wizard
          ═══════════════════════════════════════════════════════════════════════ */}
      <Modal
        isOpen={showScheduleModal}
        onClose={() => { setShowScheduleModal(false); resetScheduleModal(); }}
        title={editingEvent ? 'Edit Meeting' : 'Schedule Meeting'}
        maxWidth="lg"
      >
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {stepOrder.map((step, idx) => {
            const labels = { details: 'Details', attendees: 'Attendees', datetime: 'Date & Time', review: 'Review' };
            const icons = { details: Calendar, attendees: Users, datetime: Clock, review: Check };
            const Icon = icons[step];
            const isActive = idx === currentStepIndex;
            const isDone = idx < currentStepIndex;
            return (
              <button
                key={step}
                onClick={() => canGoToStep(step) && setScheduleStep(step)}
                disabled={!canGoToStep(step)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : isDone
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted/50 text-muted-foreground'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{labels[step]}</span>
                <span className="sm:hidden">{idx + 1}</span>
              </button>
            );
          })}
        </div>

        {/* ── Step 1: Details ── */}
        {scheduleStep === 'details' && (
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
                Meeting Title
              </label>
              <input
                autoFocus
                value={schedTitle}
                onChange={(e) => setSchedTitle(e.target.value)}
                placeholder="Weekly standup, Client review..."
                className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
                Duration
              </label>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setSchedDuration(d)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                      schedDuration === d
                        ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {d} min
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
                Location
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={schedLocation}
                  onChange={(e) => setSchedLocation(e.target.value)}
                  placeholder="Conference Room A, Office, etc."
                  className="w-full pl-9 pr-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
                Meeting Link
              </label>
              <div className="relative">
                <Video className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={schedMeetLink}
                  onChange={(e) => setSchedMeetLink(e.target.value)}
                  placeholder="Google Meet, Zoom, or Teams link..."
                  className="w-full pl-9 pr-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
                />
              </div>
              {googleCalendarId ? (
                <button
                  type="button"
                  onClick={handleGenerateMeetLink}
                  disabled={isGeneratingMeet}
                  className="inline-flex items-center gap-1.5 mt-2 ml-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  <Video className="h-3.5 w-3.5" />
                  {isGeneratingMeet ? 'Generating...' : 'Generate Google Meet link'}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 mt-2 ml-1 text-[11px] text-muted-foreground">
                  <Video className="h-3.5 w-3.5" />
                  Connect Google Calendar in settings to auto-generate Meet links
                </span>
              )}
            </div>

            <div className="pt-4 border-t border-border/50">
              <Button
                onClick={() => setScheduleStep('attendees')}
                disabled={!schedTitle.trim()}
                className="w-full py-4 text-xs font-black tracking-widest"
                rightIcon={<ArrowRight className="h-4 w-4" />}
              >
                Next: Add Attendees
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Attendees ── */}
        {scheduleStep === 'attendees' && (
          <div className="space-y-4">
            {/* Project Members */}
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
                <Users className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />
                Project Members
              </label>
              <div className="relative">
                <input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Search members by name or email..."
                  className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
                />
                {memberSearch && filteredMembers.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-background border border-border rounded-xl shadow-xl max-h-48 overflow-y-auto">
                    {filteredMembers.map((pu) => (
                      <button
                        key={pu.user_id}
                        onClick={() => addMemberAttendee(pu)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
                      >
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-primary">{pu.user_name.charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{pu.user_name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{pu.user_email}</p>
                        </div>
                        <UserPlus className="h-4 w-4 text-primary ml-auto shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Quick-add buttons for all available members */}
              {!memberSearch && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {projectUsers
                    .filter((pu) => pu.user_id !== user?.id && !schedAttendees.some((a) => a.user_id === pu.user_id))
                    .map((pu) => (
                      <button
                        key={pu.user_id}
                        onClick={() => addMemberAttendee(pu)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/50 hover:bg-primary/10 text-xs font-medium transition-colors"
                      >
                        <Plus className="h-3 w-3 text-primary" />
                        {pu.user_name}
                      </button>
                    ))}
                </div>
              )}
            </div>

            {/* Guest Emails */}
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
                <Mail className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />
                Guest Emails
              </label>
              <div className="flex gap-2">
                <div className="flex-1 space-y-2">
                  <input
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Guest name (optional)"
                    className="w-full px-4 py-2.5 bg-background/50 border border-border/30 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
                  />
                  <input
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addGuestAttendee(); }}
                    placeholder="guest@example.com"
                    className="w-full px-4 py-2.5 bg-background/50 border border-border/30 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={addGuestAttendee}
                  disabled={!guestEmail.trim()}
                  className="self-end"
                  size="sm"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Current attendees list */}
            {schedAttendees.length > 0 && (
              <div>
                <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
                  Attendees ({schedAttendees.length})
                </label>
                <div className="space-y-1.5">
                  {schedAttendees.map((a) => (
                    <div key={a.email} className="flex items-center justify-between px-3 py-2 rounded-xl bg-muted/30 border border-border/30">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${a.is_guest ? 'bg-blue-500/10' : 'bg-primary/10'}`}>
                          {a.is_guest
                            ? <Globe className="h-3.5 w-3.5 text-blue-500" />
                            : <span className="text-xs font-bold text-primary">{a.display_name.charAt(0).toUpperCase()}</span>
                          }
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{a.display_name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{a.email}</p>
                        </div>
                        {a.is_guest && <span className="text-[9px] font-bold uppercase tracking-widest text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded-md shrink-0">Guest</span>}
                      </div>
                      <button
                        onClick={() => removeAttendee(a.email)}
                        className="p-1 hover:bg-destructive/10 rounded-lg transition-colors shrink-0 ml-2"
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-border/50">
              <Button variant="outline" onClick={() => setScheduleStep('details')} className="flex-1 py-4 text-xs font-black tracking-widest" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                Back
              </Button>
              <Button onClick={() => setScheduleStep('datetime')} className="flex-1 py-4 text-xs font-black tracking-widest" rightIcon={<ArrowRight className="h-4 w-4" />}>
                Next: Date & Time
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Date & Time ── */}
        {scheduleStep === 'datetime' && (
          <div className="space-y-4">
            {/* Mini calendar for date selection */}
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
                Select Date
              </label>
              <div className="border border-border/30 rounded-xl p-3">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setSchedCalMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 })}
                    className="p-1 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-bold">{schedMonthName}</span>
                  <button
                    onClick={() => setSchedCalMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 })}
                    className="p-1 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                    <div key={d} className="text-center text-[9px] font-bold uppercase tracking-widest text-muted-foreground py-0.5">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {schedCalDays.map((day, i) => {
                    if (day === null) return <div key={`e-${i}`} className="h-8" />;
                    const dateStr = `${schedCalMonth.year}-${String(schedCalMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isSelected = dateStr === schedDate;
                    const isPast = dateStr < todayStr;
                    const isToday2 = dateStr === todayStr;
                    return (
                      <button
                        key={day}
                        onClick={() => !isPast && setSchedDate(dateStr)}
                        disabled={isPast}
                        className={`h-8 rounded-lg text-xs font-medium transition-all ${
                          isSelected
                            ? 'bg-primary text-primary-foreground shadow-md'
                            : isPast
                              ? 'text-muted-foreground/30 cursor-not-allowed'
                              : isToday2
                                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                                : 'hover:bg-muted/50'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Available time slots */}
            {schedDate && (
              <div>
                <div className="flex items-center justify-between mb-2 ml-1">
                  <label className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
                    <Globe className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />
                    Available Times
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDateShort(schedDate)} · {schedDuration} min slots
                  </span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {timeSlots.map((slot) => {
                    const taken = isSlotTaken(slot);
                    const isSelected = slot === schedTime;
                    return (
                      <button
                        key={slot}
                        onClick={() => !taken && setSchedTime(isSelected ? '' : slot)}
                        disabled={taken}
                        className={`px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                          isSelected
                            ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                            : taken
                              ? 'bg-muted/20 text-muted-foreground/30 line-through cursor-not-allowed'
                              : 'bg-muted/40 text-foreground hover:bg-primary/10 hover:text-primary border border-border/30 hover:border-primary/30'
                        }`}
                      >
                        {formatTime12(slot)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-border/50">
              <Button variant="outline" onClick={() => setScheduleStep('attendees')} className="flex-1 py-4 text-xs font-black tracking-widest" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                Back
              </Button>
              <Button
                onClick={() => setScheduleStep('review')}
                disabled={!schedDate}
                className="flex-1 py-4 text-xs font-black tracking-widest"
                rightIcon={<ArrowRight className="h-4 w-4" />}
              >
                Next: Review
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Review ── */}
        {scheduleStep === 'review' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/30 bg-muted/20 p-4 space-y-3">
              <h3 className="text-lg font-bold">{schedTitle}</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4 shrink-0" />
                  <span>{schedDate ? formatDateShort(schedDate) : 'No date'}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4 shrink-0" />
                  <span>{schedTime ? formatTime12(schedTime) : 'All day'} · {schedDuration}m</span>
                </div>
                {schedLocation && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span className="truncate">{schedLocation}</span>
                  </div>
                )}
                {schedMeetLink && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Video className="h-4 w-4 shrink-0" />
                    <span className="truncate text-blue-500">Meeting link attached</span>
                  </div>
                )}
              </div>
            </div>

            {schedAttendees.length > 0 && (
              <div>
                <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
                  Attendees ({schedAttendees.length}) — invitations will be emailed
                </p>
                <div className="space-y-1">
                  {schedAttendees.map((a) => (
                    <div key={a.email} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/20">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${a.is_guest ? 'bg-blue-500/10' : 'bg-primary/10'}`}>
                        {a.is_guest
                          ? <Globe className="h-2.5 w-2.5 text-blue-500" />
                          : <span className="text-[9px] font-bold text-primary">{a.display_name.charAt(0).toUpperCase()}</span>
                        }
                      </div>
                      <span className="text-sm font-medium">{a.display_name}</span>
                      <span className="text-[11px] text-muted-foreground">({a.email})</span>
                      {a.is_guest && <span className="text-[9px] font-bold uppercase text-blue-500">Guest</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {schedAttendees.length === 0 && (
              <p className="text-xs text-muted-foreground px-1">No attendees added. The meeting will be created without sending invitations.</p>
            )}

            <div className="flex flex-col gap-3 pt-4 border-t border-border/50">
              <Button
                onClick={handleSaveMeeting}
                disabled={isSaving}
                isLoading={isSaving}
                className="w-full py-4 text-xs font-black tracking-widest shadow-xl shadow-primary/20"
              >
                {editingEvent ? 'Update Meeting' : schedAttendees.length > 0 ? 'Schedule & Send Invites' : 'Create Meeting'}
              </Button>

              {schedTitle.trim() && schedDate && (
                <a
                  href={getGoogleCalendarUrl({ title: schedTitle.trim(), date: schedDate, time: schedTime || null, duration: schedDuration, location: schedLocation.trim() || null })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full block"
                >
                  <Button variant="outline" className="w-full py-4 text-xs font-black tracking-widest text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400">
                    <ExternalLink className="h-3.5 w-3.5 mr-2" />
                    Add to Google Calendar
                  </Button>
                </a>
              )}

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
                onClick={() => setScheduleStep('datetime')}
                leftIcon={<ArrowLeft className="h-4 w-4" />}
                className="w-full py-4 text-xs font-black tracking-widest"
              >
                Back
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
