ALTER TABLE public.zhl_calendar_events
  ADD COLUMN IF NOT EXISTS event_time TEXT;
