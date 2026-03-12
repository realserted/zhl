import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/crypto';

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getGoogleAccessToken(userId: string, adminClient: any): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;

  const { data: tokenRow } = await adminClient
    .from('zhl_google_tokens')
    .select('encrypted_refresh_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (!tokenRow) return null;
  const row = tokenRow as { encrypted_refresh_token: string };

  let refreshToken: string;
  try {
    refreshToken = decrypt(row.encrypted_refresh_token);
  } catch {
    return null;
  }

  const googleRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!googleRes.ok) return null;
  const tokens = await googleRes.json();
  return tokens.access_token;
}

/**
 * POST /api/calendar
 * Syncs a calendar event to Google Calendar.
 * Body: { action: 'create' | 'update' | 'delete', calendarId, eventId?, event? }
 */
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return NextResponse.json({ error: 'Server configuration incomplete.' }, { status: 500 });
  }

  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token.' }, { status: 401 });
  }

  // Verify user
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'Invalid auth token.' }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const googleAccessToken = await getGoogleAccessToken(userData.user.id, adminClient);
  if (!googleAccessToken) {
    return NextResponse.json({ error: 'Google account not connected or token expired.' }, { status: 401 });
  }

  const body = await req.json();
  const { action, calendarId, googleEventId, event } = body;

  if (!calendarId) {
    return NextResponse.json({ error: 'No Google Calendar ID configured.' }, { status: 400 });
  }

  const calendarApiBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const headers = {
    Authorization: `Bearer ${googleAccessToken}`,
    'Content-Type': 'application/json',
  };

  try {
    if (action === 'create-meet') {
      // Create a Google Calendar event with conferenceData to generate a Meet link
      const startDateTime = event.time
        ? `${event.date}T${event.time}:00`
        : `${event.date}T09:00:00`;
      const endDt = new Date(startDateTime);
      endDt.setMinutes(endDt.getMinutes() + (event.duration || 60));
      const endDateTime = endDt.toISOString().replace('Z', '');

      const gcalEvent = {
        summary: event.title || 'Meeting',
        location: event.location || undefined,
        start: event.time
          ? { dateTime: startDateTime, timeZone: event.timeZone || 'America/New_York' }
          : { date: event.date },
        end: event.time
          ? { dateTime: endDateTime, timeZone: event.timeZone || 'America/New_York' }
          : { date: event.date },
        conferenceData: {
          createRequest: {
            requestId: `zhl-meet-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      };

      const res = await fetch(`${calendarApiBase}?conferenceDataVersion=1`, {
        method: 'POST',
        headers,
        body: JSON.stringify(gcalEvent),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('Google Calendar create-meet failed:', err);
        return NextResponse.json({ error: 'Failed to create Google Meet link.' }, { status: 502 });
      }

      const created = await res.json();
      const meetLink = created.hangoutLink || created.conferenceData?.entryPoints?.[0]?.uri || null;
      return NextResponse.json({ googleEventId: created.id, meetLink });
    }

    if (action === 'create') {
      const gcalEvent = {
        summary: event.title,
        location: event.location || undefined,
        start: { date: event.date },
        end: { date: event.date },
      };

      const res = await fetch(calendarApiBase, {
        method: 'POST',
        headers,
        body: JSON.stringify(gcalEvent),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('Google Calendar create failed:', err);
        return NextResponse.json({ error: 'Failed to create Google Calendar event.' }, { status: 502 });
      }

      const created = await res.json();
      return NextResponse.json({ googleEventId: created.id });
    }

    if (action === 'update') {
      if (!googleEventId) {
        return NextResponse.json({ error: 'No Google event ID to update.' }, { status: 400 });
      }

      const gcalEvent = {
        summary: event.title,
        location: event.location || undefined,
        start: { date: event.date },
        end: { date: event.date },
      };

      const res = await fetch(`${calendarApiBase}/${encodeURIComponent(googleEventId)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(gcalEvent),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('Google Calendar update failed:', err);
        return NextResponse.json({ error: 'Failed to update Google Calendar event.' }, { status: 502 });
      }

      return NextResponse.json({ ok: true });
    }

    if (action === 'delete') {
      if (!googleEventId) {
        return NextResponse.json({ ok: true }); // Nothing to delete
      }

      const res = await fetch(`${calendarApiBase}/${encodeURIComponent(googleEventId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${googleAccessToken}` },
      });

      // 404 = already deleted, that's fine
      if (!res.ok && res.status !== 404) {
        const err = await res.text();
        console.error('Google Calendar delete failed:', err);
        return NextResponse.json({ error: 'Failed to delete Google Calendar event.' }, { status: 502 });
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (err) {
    console.error('Google Calendar sync error:', err);
    return NextResponse.json({ error: 'Google Calendar sync failed.' }, { status: 500 });
  }
}
