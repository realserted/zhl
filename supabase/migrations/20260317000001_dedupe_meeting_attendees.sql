-- Remove duplicate meeting attendees (keep the earliest inserted row)
DELETE FROM zhl_meeting_attendees a
USING zhl_meeting_attendees b
WHERE a.id > b.id
  AND a.event_id = b.event_id
  AND a.email = b.email;

-- Prevent future duplicates
ALTER TABLE zhl_meeting_attendees
  ADD CONSTRAINT uq_meeting_attendee UNIQUE (event_id, email);
