import { supabase } from '@/lib/supabase/client';
import { CalendarEvent, MeetingAttendee, OutOfOffice } from '@/lib/types/calendar-event';

// ── Calendar Events ─────────────────────────────────────────────────────────

export async function getCalendarEvents(projectId: string): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('zhl_calendar_events')
    .select('*')
    .eq('project_id', projectId)
    .order('event_date', { ascending: true });

  if (error) {
    console.error('Error fetching calendar events:', error.message);
    return [];
  }
  return (data ?? []) as CalendarEvent[];
}

export async function createCalendarEvent(
  projectId: string,
  title: string,
  eventDate: string,
  createdBy: string,
  location?: string | null,
  meetLink?: string | null,
  eventTime?: string | null,
  duration?: number
): Promise<CalendarEvent | null> {
  const { data, error } = await supabase
    .from('zhl_calendar_events')
    .insert({
      project_id: projectId,
      title,
      event_date: eventDate,
      created_by: createdBy,
      location: location ?? null,
      meet_link: meetLink ?? null,
      event_time: eventTime ?? null,
      duration: duration ?? 30,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating calendar event:', error.message);
    return null;
  }
  return data as CalendarEvent;
}

export async function updateCalendarEvent(
  eventId: string,
  updates: { title?: string; event_date?: string; event_time?: string | null; duration?: number; location?: string | null; meet_link?: string | null; google_event_id?: string | null }
): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_calendar_events')
    .update(updates)
    .eq('id', eventId);
  if (error) {
    console.error('Error updating calendar event:', error.message);
    return false;
  }
  return true;
}

export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_calendar_events')
    .delete()
    .eq('id', eventId);

  if (error) {
    console.error('Error deleting calendar event:', error.message);
    return false;
  }
  return true;
}

// ── Meeting Attendees ────────────────────────────────────────────────────────

export async function getMeetingAttendees(eventId: string): Promise<MeetingAttendee[]> {
  const { data, error } = await supabase
    .from('zhl_meeting_attendees')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching meeting attendees:', error.message);
    return [];
  }
  return (data ?? []) as MeetingAttendee[];
}

export async function addMeetingAttendees(
  eventId: string,
  attendees: { user_id?: string | null; email: string; display_name: string; is_guest: boolean }[]
): Promise<MeetingAttendee[]> {
  if (attendees.length === 0) return [];

  const rows = attendees.map((a) => ({
    event_id: eventId,
    user_id: a.user_id ?? null,
    email: a.email,
    display_name: a.display_name,
    is_guest: a.is_guest,
    status: 'pending',
  }));

  const { data, error } = await supabase
    .from('zhl_meeting_attendees')
    .insert(rows)
    .select();

  if (error) {
    console.error('Error adding meeting attendees:', error.message);
    return [];
  }
  return (data ?? []) as MeetingAttendee[];
}

export async function removeMeetingAttendee(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_meeting_attendees')
    .delete()
    .eq('id', id);
  if (error) {
    console.error('Error removing meeting attendee:', error.message);
    return false;
  }
  return true;
}

export async function removeAllMeetingAttendees(eventId: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_meeting_attendees')
    .delete()
    .eq('event_id', eventId);
  if (error) {
    console.error('Error removing meeting attendees:', error.message);
    return false;
  }
  return true;
}

// ── Out of Office ───────────────────────────────────────────────────────────

export async function getOutOfOffice(projectId: string, startDate: string, endDate: string): Promise<OutOfOffice[]> {
  const { data, error } = await supabase
    .from('zhl_out_of_office')
    .select('*')
    .eq('project_id', projectId)
    .gte('ooo_date', startDate)
    .lte('ooo_date', endDate)
    .order('ooo_date', { ascending: true });

  if (error) {
    console.error('Error fetching OOO:', error.message);
    return [];
  }
  return (data ?? []) as OutOfOffice[];
}

export async function setOutOfOffice(
  projectId: string,
  userId: string,
  userName: string,
  date: string,
  note: string
): Promise<OutOfOffice | null> {
  const { data, error } = await supabase
    .from('zhl_out_of_office')
    .insert({ project_id: projectId, user_id: userId, user_name: userName, ooo_date: date, note })
    .select()
    .single();

  if (error) {
    console.error('Error setting OOO:', error.message);
    return null;
  }
  return data as OutOfOffice;
}

export async function removeOutOfOffice(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_out_of_office')
    .delete()
    .eq('id', id);
  if (error) {
    console.error('Error removing OOO:', error.message);
    return false;
  }
  return true;
}
