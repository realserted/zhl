export interface CalendarEvent {
  id: string;
  project_id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  duration: number; // minutes
  location: string | null;
  meet_link: string | null;
  created_by: string;
  created_at: string;
  google_event_id?: string | null;
}

export interface MeetingAttendee {
  id: string;
  event_id: string;
  user_id: string | null;
  email: string;
  display_name: string;
  status: 'pending' | 'accepted' | 'declined';
  is_guest: boolean;
  created_at: string;
}

export interface OutOfOffice {
  id: string;
  project_id: string;
  user_id: string;
  user_name: string;
  ooo_date: string;
  note: string;
  created_at: string;
}
