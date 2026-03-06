'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Tasker } from '@/lib/types/tasker';
import { CalendarEvent } from '@/lib/types/calendar-event';
import {
  getCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
} from '@/lib/db/calendar-events';

interface OverviewCalendarProps {
  projectId: string | null;
  taskers: Tasker[];
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getToday(): string {
  const d = new Date();
  return formatDateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function OverviewCalendar({ projectId, taskers }: OverviewCalendarProps) {
  const { user } = useAuth();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [addingEvent, setAddingEvent] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const today = getToday();

  // Fetch events when project changes
  useEffect(() => {
    if (!projectId) { setEvents([]); return; }
    getCalendarEvents(projectId).then(setEvents);
  }, [projectId]);

  // Close popover on outside click
  useEffect(() => {
    if (!selectedDate) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelectedDate(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectedDate]);

  // Close popover on Escape
  useEffect(() => {
    if (!selectedDate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedDate(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedDate]);

  // Group tasks by due_date
  const tasksByDate = useMemo(() => {
    const map = new Map<string, Tasker[]>();
    for (const t of taskers) {
      if (!t.due_date || t.status === 'Archived') continue;
      const key = t.due_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [taskers]);

  // Group events by event_date
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = e.event_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [events]);

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days: { day: number; dateKey: string }[] = [];

    // Leading empty slots
    for (let i = 0; i < firstDay; i++) {
      days.push({ day: 0, dateKey: '' });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, dateKey: formatDateKey(year, month, d) });
    }

    return days;
  }, [currentMonth]);

  const monthLabel = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    setSelectedDate(null);
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    setSelectedDate(null);
  };

  const getDotColors = useCallback((dateKey: string): string[] => {
    const dots: string[] = [];
    const tasks = tasksByDate.get(dateKey);
    if (tasks && tasks.length > 0) {
      // Determine task dot color based on date vs today
      if (dateKey < today) {
        dots.push('bg-red-500');       // overdue
      } else if (dateKey === today || dateKey <= formatDateKey(
        new Date(Date.now() + 3 * 86400000).getFullYear(),
        new Date(Date.now() + 3 * 86400000).getMonth(),
        new Date(Date.now() + 3 * 86400000).getDate()
      )) {
        dots.push('bg-yellow-500');    // due today or within 3 days
      } else {
        dots.push('bg-green-500');     // future
      }
    }
    if (eventsByDate.has(dateKey)) {
      dots.push('bg-blue-500');        // custom event
    }
    return dots;
  }, [tasksByDate, eventsByDate, today]);

  const handleAddEvent = async () => {
    if (!newEventTitle.trim() || !selectedDate || !projectId || !user) return;
    setAddingEvent(true);
    const created = await createCalendarEvent(projectId, newEventTitle.trim(), selectedDate, user.id);
    if (created) {
      setEvents((prev) => [...prev, created]);
      setNewEventTitle('');
    }
    setAddingEvent(false);
  };

  const handleDeleteEvent = async (eventId: string) => {
    const ok = await deleteCalendarEvent(eventId);
    if (ok) {
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    }
  };

  const selectedTasks = selectedDate ? tasksByDate.get(selectedDate) ?? [] : [];
  const selectedEvents = selectedDate ? eventsByDate.get(selectedDate) ?? [] : [];

  return (
    <div className="glass-card rounded-2xl p-6">
      <h2 className="text-sm font-bold text-foreground mb-4">Calendar</h2>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={prevMonth}
          className="p-2 rounded-lg hover:bg-muted transition-all text-muted-foreground hover:text-foreground active:scale-95"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-bold text-foreground tracking-tight">{monthLabel}</span>
        <button
          onClick={nextMonth}
          className="p-2 rounded-lg hover:bg-muted transition-all text-muted-foreground hover:text-foreground active:scale-95"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAY_NAMES.map((d) => (
          <div key={d} className="text-center text-[10px] font-black text-muted-foreground/50 uppercase tracking-widest py-1">
            {d[0]}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-0.5 relative">
        {calendarDays.map((cell, idx) => {
          if (cell.day === 0) {
            return <div key={`empty-${idx}`} className="h-9" />;
          }

          const isToday = cell.dateKey === today;
          const isSelected = cell.dateKey === selectedDate;
          const dots = getDotColors(cell.dateKey);

          return (
            <button
              key={cell.dateKey}
              onClick={() => setSelectedDate(isSelected ? null : cell.dateKey)}
              className={`
                h-10 rounded-lg text-xs font-bold transition-all relative flex flex-col items-center justify-center gap-1
                ${isToday ? 'bg-primary text-white shadow-[0_0_12px_rgba(var(--primary),0.3)] scale-105 z-10' : ''}
                ${isSelected && !isToday ? 'bg-muted ring-2 ring-primary/30 z-10' : ''}
                ${!isToday && !isSelected ? 'hover:bg-muted text-foreground' : ''}
                ${!isToday ? 'active:scale-95' : ''}
              `}
            >
              <span>{cell.day}</span>
              {dots.length > 0 && (
                <div className="flex gap-0.5">
                  {dots.map((color, i) => (
                    <span key={i} className={`w-1 h-1 rounded-full ${color}`} />
                  ))}
                </div>
              )}
            </button>
          );
        })}

        {/* Popover */}
        {selectedDate && (
          <div
            ref={popoverRef}
            className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-4 w-72 glass-card rounded-2xl shadow-2xl p-5 animate-in fade-in zoom-in duration-200"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('default', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              <button
                onClick={() => setSelectedDate(null)}
                className="p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Tasks */}
            {selectedTasks.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Tasks Due</p>
                <ul className="space-y-1 max-h-28 overflow-y-auto">
                  {selectedTasks.map((t) => (
                    <li key={t.id} className="text-xs text-foreground flex items-start gap-1.5">
                      <span
                        className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                          t.status === 'Complete'
                            ? 'bg-green-500'
                            : t.due_date && t.due_date < today
                            ? 'bg-red-500'
                            : 'bg-yellow-500'
                        }`}
                      />
                      <div className="min-w-0">
                        <span className="font-medium truncate block">{t.task_name}</span>
                        {t.responsible_name && (
                          <span className="text-muted-foreground text-[10px]">{t.responsible_name}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Events */}
            {selectedEvents.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Events</p>
                <ul className="space-y-1 max-h-28 overflow-y-auto">
                  {selectedEvents.map((e) => (
                    <li key={e.id} className="text-xs text-foreground flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                        <span className="truncate">{e.title}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteEvent(e.id)}
                        className="p-0.5 text-muted-foreground hover:text-red-500 shrink-0"
                        title="Delete event"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedTasks.length === 0 && selectedEvents.length === 0 && (
              <p className="text-xs text-muted-foreground mb-2">No tasks or events</p>
            )}

            {/* Add event */}
            {projectId && user && (
              <div className="flex gap-1.5 mt-2 pt-2 border-t border-border">
                <input
                  type="text"
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddEvent(); }}
                  placeholder="Add event..."
                  className="flex-1 text-xs px-2 py-1.5 bg-background border border-input rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  maxLength={200}
                />
                <button
                  onClick={handleAddEvent}
                  disabled={addingEvent || !newEventTitle.trim()}
                  className="px-2 py-1.5 bg-accent text-white rounded text-xs font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
