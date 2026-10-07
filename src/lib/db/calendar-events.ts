import { supabase } from '@/lib/supabase/client';
import { CalendarEvent } from '@/lib/types/calendar-event';

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
  createdBy: string
): Promise<CalendarEvent | null> {
  const { data, error } = await supabase
    .from('zhl_calendar_events')
    .insert({ project_id: projectId, title, event_date: eventDate, created_by: createdBy })
    .select()
    .single();

  if (error) {
    console.error('Error creating calendar event:', error.message);
    return null;
  }
  return data as CalendarEvent;
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
