export interface CalendarEvent {
  id: string;
  project_id: string;
  title: string;
  event_date: string;
  location: string | null;
  meet_link: string | null;
  created_by: string;
  created_at: string;
  google_event_id?: string | null;
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
