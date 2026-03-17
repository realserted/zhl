'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { CalendarEvent } from '@/lib/types/calendar-event';
import {
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  addMeetingAttendees, getMeetingAttendees,
} from '@/lib/db/calendar-events';
import { createNotification } from '@/lib/db/notifications';
import {
  DURATIONS, generateTimeSlots, formatTime12, formatDateShort, todayDateStr,
  toDateStr, getGoogleCalendarUrl, buildCalendarDays, getMonthLabel, timeToMinutes,
  prevMonth, nextMonth, YearMonth,
} from '@/lib/calendar-utils';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, MapPin, X, Calendar, ExternalLink, Video, Clock,
  Users, Mail, UserPlus, Check, ArrowRight, ArrowLeft, Globe,
} from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';

// ── Types ───────────────────────────────────────────────────────────────────

type ScheduleStep = 'details' | 'attendees' | 'datetime' | 'review';

interface AttendeeEntry {
  user_id: string | null;
  email: string;
  display_name: string;
  is_guest: boolean;
}

interface ProjectUser {
  user_id: string;
  user_name: string;
  user_email: string;
}

export interface ScheduleWizardProps {
  isOpen: boolean;
  onClose: () => void;
  /** If provided, the wizard opens in edit mode for this event. */
  editEvent: CalendarEvent | null;
  /** Pre-selected date (when clicking a day cell). */
  initialDate?: string;
  // Context
  projectId: string;
  userId: string;
  displayName: string;
  projectUsers: ProjectUser[];
  events: CalendarEvent[];
  defaultLocation: string;
  googleCalendarId: string;
  // Callbacks
  onEventCreated: (ev: CalendarEvent) => void;
  onEventUpdated: (ev: CalendarEvent) => void;
  onEventDeleted: (id: string) => void;
}

const STEP_ORDER: ScheduleStep[] = ['details', 'attendees', 'datetime', 'review'];
const STEP_LABELS: Record<ScheduleStep, string> = { details: 'Details', attendees: 'Attendees', datetime: 'Date & Time', review: 'Review' };
const STEP_ICONS: Record<ScheduleStep, typeof Calendar> = { details: Calendar, attendees: Users, datetime: Clock, review: Check };

// ── Reusable label ──────────────────────────────────────────────────────────

function FormLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">{children}</label>;
}

// ── Attendee avatar ─────────────────────────────────────────────────────────

function AttendeeAvatar({ name, isGuest, size = 'md' }: { name: string; isGuest: boolean; size?: 'sm' | 'md' }) {
  const px = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7';
  const iconSize = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
  const textSize = size === 'sm' ? 'text-[9px]' : 'text-xs';
  return (
    <div className={`${px} rounded-full flex items-center justify-center shrink-0 ${isGuest ? 'bg-blue-500/10' : 'bg-primary/10'}`}>
      {isGuest
        ? <Globe className={`${iconSize} text-blue-500`} />
        : <span className={`${textSize} font-bold text-primary`}>{name.charAt(0).toUpperCase()}</span>
      }
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export function ScheduleWizard({
  isOpen, onClose, editEvent, initialDate,
  projectId, userId, displayName, projectUsers, events,
  defaultLocation, googleCalendarId,
  onEventCreated, onEventUpdated, onEventDeleted,
}: ScheduleWizardProps) {
  // ── Internal state ──────────────────────────────────────────────────────
  const [step, setStep] = useState<ScheduleStep>('details');
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingMeet, setIsGeneratingMeet] = useState(false);

  // Step 1: Details
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState('');
  const [meetLink, setMeetLink] = useState('');

  // Step 2: Attendees
  const [attendees, setAttendees] = useState<AttendeeEntry[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestName, setGuestName] = useState('');

  // Step 3: Date & Time
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [calMonth, setCalMonth] = useState<YearMonth>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // ── Reset / initialize on open ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    if (editEvent) {
      setTitle(editEvent.title);
      setDuration(editEvent.duration || 30);
      setLocation(editEvent.location ?? '');
      setMeetLink(editEvent.meet_link ?? '');
      setDate(editEvent.event_date);
      setTime(editEvent.event_time ?? '');
      getMeetingAttendees(editEvent.id).then((att) => {
        const seen = new Set<string>();
        const unique: AttendeeEntry[] = [];
        for (const a of att) {
          if (seen.has(a.email)) continue;
          seen.add(a.email);
          unique.push({ user_id: a.user_id, email: a.email, display_name: a.display_name, is_guest: a.is_guest });
        }
        setAttendees(unique);
      });
    } else {
      setTitle('');
      setDuration(30);
      setLocation(defaultLocation);
      setMeetLink('');
      setAttendees([]);
      setDate(initialDate ?? '');
      setTime('');
    }

    setStep('details');
    setIsSaving(false);
    setIsGeneratingMeet(false);
    setMemberSearch('');
    setGuestEmail('');
    setGuestName('');
    const now = new Date();
    setCalMonth({ year: now.getFullYear(), month: now.getMonth() });
  }, [isOpen, editEvent, initialDate, defaultLocation]);

  // ── Derived ───────────────────────────────────────────────────────────
  const todayStr = todayDateStr();
  const currentStepIndex = STEP_ORDER.indexOf(step);

  const canGoToStep = (s: ScheduleStep): boolean => {
    switch (s) {
      case 'details': return true;
      case 'attendees': return !!title.trim();
      case 'datetime': return !!title.trim();
      case 'review': return !!title.trim() && !!date;
      default: return false;
    }
  };

  // ── Attendee helpers ──────────────────────────────────────────────────
  const filteredMembers = useMemo(() => {
    const q = memberSearch.toLowerCase();
    return projectUsers.filter((pu) => {
      if (attendees.some((a) => a.user_id === pu.user_id)) return false;
      if (pu.user_id === userId) return false;
      if (!q) return true;
      return pu.user_name.toLowerCase().includes(q) || pu.user_email?.toLowerCase().includes(q);
    });
  }, [projectUsers, memberSearch, attendees, userId]);

  const addMember = (pu: ProjectUser) => {
    if (attendees.some((a) => a.email === pu.user_email)) return;
    setAttendees((prev) => [...prev, { user_id: pu.user_id, email: pu.user_email, display_name: pu.user_name, is_guest: false }]);
    setMemberSearch('');
  };

  const addGuest = () => {
    const email = guestEmail.trim();
    const name = guestName.trim() || email;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    if (attendees.some((a) => a.email === email)) return;
    setAttendees((prev) => [...prev, { user_id: null, email, display_name: name, is_guest: true }]);
    setGuestEmail('');
    setGuestName('');
  };

  const removeAttendee = (email: string) => setAttendees((prev) => prev.filter((a) => a.email !== email));

  const availableMembers = useMemo(
    () => projectUsers.filter((pu) => pu.user_id !== userId && !attendees.some((a) => a.user_id === pu.user_id)),
    [projectUsers, userId, attendees]
  );

  // ── Date picker ───────────────────────────────────────────────────────
  const calDays = useMemo(() => buildCalendarDays(calMonth.year, calMonth.month), [calMonth]);
  const calMonthLabel = getMonthLabel(calMonth.year, calMonth.month);

  // ── Time slots ────────────────────────────────────────────────────────
  const timeSlots = useMemo(() => generateTimeSlots(duration), [duration]);

  const isSlotTaken = useCallback((slot: string) => {
    if (!date) return false;
    const dayEvents = events.filter((e) => e.event_date === date && e.event_time);
    const slotStart = timeToMinutes(slot);
    const slotEnd = slotStart + duration;

    for (const ev of dayEvents) {
      if (editEvent && ev.id === editEvent.id) continue;
      const evStart = timeToMinutes(ev.event_time!);
      const evEnd = evStart + (ev.duration || 30);
      if (slotStart < evEnd && slotEnd > evStart) return true;
    }
    return false;
  }, [date, events, duration, editEvent]);

  // ── Generate Meet link ────────────────────────────────────────────────
  const handleGenerateMeetLink = async () => {
    if (!googleCalendarId || isGeneratingMeet) return;
    setIsGeneratingMeet(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: 'create-meet',
          calendarId: googleCalendarId,
          event: { title: title.trim() || 'Meeting', date: date || todayStr, time: time || null, duration, location: location.trim() || null },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.meetLink) setMeetLink(data.meetLink);
      }
    } catch (err) {
      console.error('Failed to generate Meet link:', err);
    } finally {
      setIsGeneratingMeet(false);
    }
  };

  // ── Auto-generate Meet link when entering review step ────────────────
  useEffect(() => {
    if (
      step === 'review' &&
      googleCalendarId &&
      date &&
      !meetLink.trim() &&
      location.toLowerCase().includes('google meet') &&
      !isGeneratingMeet
    ) {
      handleGenerateMeetLink();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Save ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!title.trim() || !date) return;
    setIsSaving(true);

    try {
      const payload = {
        title: title.trim(),
        event_date: date,
        event_time: time || null,
        duration,
        location: location.trim() || null,
        meet_link: meetLink.trim() || null,
      };

      let eventId: string;

      if (editEvent) {
        const ok = await updateCalendarEvent(editEvent.id, payload);
        if (!ok) { setIsSaving(false); return; }
        eventId = editEvent.id;
        onEventUpdated({ ...editEvent, ...payload });
      } else {
        const ev = await createCalendarEvent(projectId, payload.title, date, userId, payload.location, payload.meet_link, payload.event_time, duration);
        if (!ev) { setIsSaving(false); return; }
        eventId = ev.id;
        onEventCreated(ev);
      }

      if (attendees.length > 0) {
        await addMeetingAttendees(eventId, attendees);

        // Notify each project-member attendee (skip guests who have no user_id)
        for (const a of attendees) {
          if (a.user_id && a.user_id !== userId) {
            createNotification({
              userId: a.user_id,
              type: 'meeting_invitation',
              title: 'Meeting Invitation',
              message: `You were invited to "${payload.title}" on ${date}${time ? ` at ${time}` : ''} by ${displayName}`,
              relatedId: eventId,
              relatedType: 'meeting',
            }).catch(() => {});
          }
        }

        // Fire-and-forget email invites
        fetch('/api/meetings/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attendees: attendees.map((a) => ({ email: a.email, display_name: a.display_name })),
            meeting: { ...payload, organizer_name: displayName },
          }),
        }).catch(() => {});
      }

      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editEvent) return;
    const ok = await deleteCalendarEvent(editEvent.id);
    if (ok) onEventDeleted(editEvent.id);
    onClose();
  };

  if (!isOpen) return null;

  // ── Shared input class ────────────────────────────────────────────────
  const inputCls = 'w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium';
  const inputIconCls = 'w-full pl-9 pr-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editEvent ? 'Edit Meeting' : 'Schedule Meeting'}
      maxWidth="lg"
    >
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {STEP_ORDER.map((s, idx) => {
          const Icon = STEP_ICONS[s];
          const isActive = idx === currentStepIndex;
          const isDone = idx < currentStepIndex;
          return (
            <button
              key={s}
              onClick={() => canGoToStep(s) && setStep(s)}
              disabled={!canGoToStep(s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                isActive ? 'bg-primary text-primary-foreground shadow-md'
                  : isDone ? 'bg-primary/10 text-primary'
                    : 'bg-muted/50 text-muted-foreground'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{STEP_LABELS[s]}</span>
              <span className="sm:hidden">{idx + 1}</span>
            </button>
          );
        })}
      </div>

      {/* ── Step 1: Details ── */}
      {step === 'details' && (
        <div className="space-y-4">
          <div>
            <FormLabel>Meeting Title</FormLabel>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly standup, Client review..." className={inputCls} />
          </div>

          <div>
            <FormLabel>Duration</FormLabel>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    duration === d ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          <div>
            <FormLabel>Location</FormLabel>
            <div className="relative">
              <MapPin className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Conference Room A, Office, etc." className={inputIconCls} />
            </div>
          </div>

          <div>
            <FormLabel>Meeting Link</FormLabel>
            <div className="relative">
              <Video className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <input value={meetLink} onChange={(e) => setMeetLink(e.target.value)} placeholder="Google Meet, Zoom, or Teams link..." className={inputIconCls} />
            </div>
            {googleCalendarId ? (
              <button type="button" onClick={handleGenerateMeetLink} disabled={isGeneratingMeet} className="inline-flex items-center gap-1.5 mt-2 ml-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50">
                <Video className="h-3.5 w-3.5" />
                {isGeneratingMeet ? 'Generating...' : 'Generate Google Meet link'}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 mt-2 ml-1 text-[11px] text-muted-foreground">
                <Video className="h-3.5 w-3.5" />Connect Google Calendar in settings to auto-generate Meet links
              </span>
            )}
          </div>

          <div className="pt-4 border-t border-border/50">
            <Button onClick={() => setStep('attendees')} disabled={!title.trim()} className="w-full py-4 text-xs font-black tracking-widest" rightIcon={<ArrowRight className="h-4 w-4" />}>
              Next: Add Attendees
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Attendees ── */}
      {step === 'attendees' && (
        <div className="space-y-4">
          <div>
            <FormLabel><Users className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />Project Members</FormLabel>
            <div className="relative">
              <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Search members by name or email..." className={inputCls} />
              {memberSearch && filteredMembers.length > 0 && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-background border border-border rounded-xl shadow-xl max-h-48 overflow-y-auto">
                  {filteredMembers.map((pu) => (
                    <button key={pu.user_id} onClick={() => addMember(pu)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left">
                      <AttendeeAvatar name={pu.user_name} isGuest={false} />
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
            {!memberSearch && availableMembers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {availableMembers.map((pu) => (
                  <button key={pu.user_id} onClick={() => addMember(pu)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/50 hover:bg-primary/10 text-xs font-medium transition-colors">
                    <Plus className="h-3 w-3 text-primary" />{pu.user_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <FormLabel><Mail className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />Guest Emails</FormLabel>
            <div className="flex gap-2">
              <div className="flex-1 space-y-2">
                <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Guest name (optional)" className="w-full px-4 py-2.5 bg-background/50 border border-border/30 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium" />
                <input value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addGuest(); }} placeholder="guest@example.com" className="w-full px-4 py-2.5 bg-background/50 border border-border/30 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium" />
              </div>
              <Button variant="secondary" onClick={addGuest} disabled={!guestEmail.trim()} className="self-end" size="sm">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {attendees.length > 0 && (
            <div>
              <FormLabel>Attendees ({attendees.length})</FormLabel>
              <div className="space-y-1.5">
                {attendees.map((a, idx) => (
                  <div key={`${a.email}-${idx}`} className="flex items-center justify-between px-3 py-2 rounded-xl bg-muted/30 border border-border/30">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AttendeeAvatar name={a.display_name} isGuest={a.is_guest} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{a.display_name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{a.email}</p>
                      </div>
                      {a.is_guest && <span className="text-[9px] font-bold uppercase tracking-widest text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded-md shrink-0">Guest</span>}
                    </div>
                    <button onClick={() => removeAttendee(a.email)} className="p-1 hover:bg-destructive/10 rounded-lg transition-colors shrink-0 ml-2">
                      <X className="h-4 w-4 text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <StepNav onBack={() => setStep('details')} onNext={() => setStep('datetime')} nextLabel="Next: Date & Time" />
        </div>
      )}

      {/* ── Step 3: Date & Time ── */}
      {step === 'datetime' && (
        <div className="space-y-4">
          <div>
            <FormLabel>Select Date</FormLabel>
            <div className="border border-border/30 rounded-xl p-3">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setCalMonth(prevMonth)} className="p-1 rounded-lg hover:bg-muted/50 transition-colors"><ChevronLeft className="h-4 w-4" /></button>
                <span className="text-xs font-bold">{calMonthLabel}</span>
                <button onClick={() => setCalMonth(nextMonth)} className="p-1 rounded-lg hover:bg-muted/50 transition-colors"><ChevronRight className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                  <div key={d} className="text-center text-[9px] font-bold uppercase tracking-widest text-muted-foreground py-0.5">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calDays.map((day, i) => {
                  if (day === null) return <div key={`e-${i}`} className="h-8" />;
                  const dateStr = toDateStr(calMonth.year, calMonth.month, day);
                  const isSelected = dateStr === date;
                  const isPast = dateStr < todayStr;
                  const isToday = dateStr === todayStr;
                  return (
                    <button
                      key={day}
                      onClick={() => !isPast && setDate(dateStr)}
                      disabled={isPast}
                      className={`h-8 rounded-lg text-xs font-medium transition-all ${
                        isSelected ? 'bg-primary text-primary-foreground shadow-md'
                          : isPast ? 'text-muted-foreground/30 cursor-not-allowed'
                            : isToday ? 'bg-primary/10 text-primary hover:bg-primary/20'
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

          {date && (
            <div>
              <div className="flex items-center justify-between mb-2 ml-1">
                <FormLabel><Globe className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />Available Times</FormLabel>
                <span className="text-[10px] text-muted-foreground">{formatDateShort(date)} · {duration} min slots</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {timeSlots.map((slot) => {
                  const taken = isSlotTaken(slot);
                  const isSelected = slot === time;
                  return (
                    <button
                      key={slot}
                      onClick={() => !taken && setTime(isSelected ? '' : slot)}
                      disabled={taken}
                      className={`px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        isSelected ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                          : taken ? 'bg-muted/20 text-muted-foreground/30 line-through cursor-not-allowed'
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

          <StepNav onBack={() => setStep('attendees')} onNext={() => setStep('review')} nextLabel="Next: Review" nextDisabled={!date} />
        </div>
      )}

      {/* ── Step 4: Review ── */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border/30 bg-muted/20 p-4 space-y-3">
            <h3 className="text-lg font-bold">{title}</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4 shrink-0" />
                <span>{date ? formatDateShort(date) : 'No date'}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" />
                <span>{time ? formatTime12(time) : 'All day'} · {duration}m</span>
              </div>
              {location && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" /><span className="truncate">{location}</span>
                </div>
              )}
              {isGeneratingMeet ? (
                <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                  <Video className="h-4 w-4 shrink-0 animate-pulse" /><span className="text-blue-500 text-xs">Generating Google Meet link...</span>
                </div>
              ) : meetLink ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Video className="h-4 w-4 shrink-0" /><span className="truncate text-blue-500">Meeting link attached</span>
                </div>
              ) : null}
            </div>
          </div>

          {attendees.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">
                Attendees ({attendees.length}) — invitations will be emailed
              </p>
              <div className="space-y-1">
                {attendees.map((a, idx) => (
                  <div key={`${a.email}-${idx}`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/20">
                    <AttendeeAvatar name={a.display_name} isGuest={a.is_guest} size="sm" />
                    <span className="text-sm font-medium">{a.display_name}</span>
                    <span className="text-[11px] text-muted-foreground">({a.email})</span>
                    {a.is_guest && <span className="text-[9px] font-bold uppercase text-blue-500">Guest</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground px-1">No attendees added. The meeting will be created without sending invitations.</p>
          )}

          <div className="flex flex-col gap-3 pt-4 border-t border-border/50">
            <Button onClick={handleSave} disabled={isSaving} isLoading={isSaving} className="w-full py-4 text-xs font-black tracking-widest shadow-xl shadow-primary/20">
              {editEvent ? 'Update Meeting' : attendees.length > 0 ? 'Schedule & Send Invites' : 'Create Meeting'}
            </Button>

            {title.trim() && date && (
              <a href={getGoogleCalendarUrl({ title: title.trim(), date, time: time || null, duration, location: location.trim() || null })} target="_blank" rel="noopener noreferrer" className="w-full block">
                <Button variant="outline" className="w-full py-4 text-xs font-black tracking-widest text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400">
                  <ExternalLink className="h-3.5 w-3.5 mr-2" />Add to Google Calendar
                </Button>
              </a>
            )}

            {editEvent && (
              <Button variant="outline" onClick={handleDelete} leftIcon={<Trash2 className="h-4 w-4" />} className="w-full py-4 text-xs font-black tracking-widest text-destructive hover:text-destructive">
                Delete Meeting
              </Button>
            )}

            <Button variant="outline" onClick={() => setStep('datetime')} leftIcon={<ArrowLeft className="h-4 w-4" />} className="w-full py-4 text-xs font-black tracking-widest">
              Back
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Shared step navigation ──────────────────────────────────────────────────

function StepNav({ onBack, onNext, nextLabel, nextDisabled }: { onBack: () => void; onNext: () => void; nextLabel: string; nextDisabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-4 border-t border-border/50">
      <Button variant="outline" onClick={onBack} className="flex-1 py-4 text-xs font-black tracking-widest" leftIcon={<ArrowLeft className="h-4 w-4" />}>
        Back
      </Button>
      <Button onClick={onNext} disabled={nextDisabled} className="flex-1 py-4 text-xs font-black tracking-widest" rightIcon={<ArrowRight className="h-4 w-4" />}>
        {nextLabel}
      </Button>
    </div>
  );
}
