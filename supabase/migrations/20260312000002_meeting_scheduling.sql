-- Add duration (minutes) to calendar events for scheduling
ALTER TABLE public.zhl_calendar_events
  ADD COLUMN IF NOT EXISTS duration INTEGER NOT NULL DEFAULT 30;

-- Meeting attendees table (project members + external guests)
CREATE TABLE IF NOT EXISTS public.zhl_meeting_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.zhl_calendar_events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.zhl_meeting_attendees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read zhl_meeting_attendees"
  ON public.zhl_meeting_attendees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert zhl_meeting_attendees"
  ON public.zhl_meeting_attendees FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update zhl_meeting_attendees"
  ON public.zhl_meeting_attendees FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete zhl_meeting_attendees"
  ON public.zhl_meeting_attendees FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_meeting_attendees_event ON public.zhl_meeting_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_user ON public.zhl_meeting_attendees(user_id);
