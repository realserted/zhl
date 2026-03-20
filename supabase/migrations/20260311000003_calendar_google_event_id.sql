-- Add google_event_id to calendar_events so we can sync with Google Calendar
ALTER TABLE public.zhl_calendar_events
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

-- Add default meeting location to project settings
ALTER TABLE public.zhl_project_settings
  ADD COLUMN IF NOT EXISTS default_meeting_location TEXT DEFAULT '';
