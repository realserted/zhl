/**
 * Pure calendar/date utility functions.
 * Shared across MeetingsPage, DayDetailModal, ScheduleWizard, etc.
 */

// ── Date formatting ─────────────────────────────────────────────────────────

/** "2026-03-13" from (2026, 2, 13) — month is 0-indexed */
export function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "9:30 AM" from "09:30" */
export function formatTime12(time: string): string {
  return new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** "Fri, Mar 13" from "2026-03-13" */
export function formatDateShort(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Today as "YYYY-MM-DD" */
export function todayDateStr(): string {
  const t = new Date();
  return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
}

/** "March 2026" from (year, month) */
export function getMonthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// ── Calendar grid computation ───────────────────────────────────────────────

/** Build an array of (number | null) representing a Monday-start calendar grid. */
export function buildCalendarDays(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);
  return days;
}

// ── Month navigation helpers ────────────────────────────────────────────────

export type YearMonth = { year: number; month: number };

export function prevMonth(ym: YearMonth): YearMonth {
  return ym.month === 0 ? { year: ym.year - 1, month: 11 } : { ...ym, month: ym.month - 1 };
}

export function nextMonth(ym: YearMonth): YearMonth {
  return ym.month === 11 ? { year: ym.year + 1, month: 0 } : { ...ym, month: ym.month + 1 };
}

// ── OOO date range for a calendar month ─────────────────────────────────────

export function getOooDateRange(year: number, month: number): { start: string; end: string } {
  const first = new Date(year, month, 1);
  const dayOfWeek = first.getDay();
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  first.setDate(first.getDate() - offset);
  const start = first.toISOString().slice(0, 10);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((offset + daysInMonth) / 7);
  const end = new Date(start);
  end.setDate(end.getDate() + weekCount * 7 - 1);

  return { start, end: end.toISOString().slice(0, 10) };
}

// ── Time slots ──────────────────────────────────────────────────────────────

export const DURATIONS = [15, 30, 45, 60, 90] as const;

/** Generate 30-min-interval time slots between 9 AM and 5 PM that fit the given duration. */
export function generateTimeSlots(duration: number): string[] {
  const slots: string[] = [];
  const startMin = 9 * 60;  // 9:00 AM
  const endMin = 17 * 60;   // 5:00 PM

  for (let m = startMin; m + duration <= endMin; m += 30) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return slots;
}

/** Parse "HH:mm" → total minutes since midnight */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// ── Google Calendar URL builder ─────────────────────────────────────────────

export function getGoogleCalendarUrl(event: {
  title: string;
  date: string;
  time?: string | null;
  duration?: number;
  location?: string | null;
}): string {
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
