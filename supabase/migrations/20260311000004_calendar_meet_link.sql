-- Add meet_link column to calendar events for storing Google Meet / Zoom links
ALTER TABLE public.zhl_calendar_events
  ADD COLUMN IF NOT EXISTS meet_link TEXT;
