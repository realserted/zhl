import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCalendarClient } from '@/lib/google-calendar';

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: 'Missing auth token.' }, { status: 401 });

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData } = await anonClient.auth.getUser(token);
  if (!userData?.user) return NextResponse.json({ error: 'Invalid auth token.' }, { status: 401 });

  const userId = userData.user.id;
  const { projectId } = (await req.json()) as { projectId: string };
  if (!projectId) return NextResponse.json({ error: 'Missing projectId.' }, { status: 400 });

  const calendar = await getCalendarClient(userId);
  if (!calendar) return NextResponse.json({ error: 'Google Calendar not connected.' }, { status: 400 });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch taskers with due dates
  const { data: taskers } = await adminClient
    .from('zhl_taskers')
    .select('*')
    .eq('project_id', projectId)
    .not('due_date', 'is', null);

  // Fetch existing mappings for this user
  const { data: mappings } = await adminClient
    .from('zhl_tasker_gcal_events')
    .select('*')
    .eq('user_id', userId);

  const mappingsByTaskerId = new Map(
    (mappings ?? []).map((m: { tasker_id: string; id: string; gcal_event_id: string }) => [m.tasker_id, m]),
  );

  let synced = 0;

  for (const tasker of taskers ?? []) {
    const existing = mappingsByTaskerId.get(tasker.id) as { id: string; gcal_event_id: string } | undefined;

    const eventBody = {
      summary: tasker.task_name,
      description: [
        tasker.description,
        tasker.responsible_name ? `Responsible: ${tasker.responsible_name}` : null,
        `Status: ${tasker.status}`,
        `Priority: ${tasker.priority ?? 0}`,
      ]
        .filter(Boolean)
        .join('\n'),
      start: { date: tasker.due_date },
      end: { date: tasker.due_date },
    };

    try {
      if (tasker.status === 'Archived' || tasker.status === 'Complete') {
        // Remove completed/archived from calendar
        if (existing) {
          await calendar.events.delete({ calendarId: 'primary', eventId: existing.gcal_event_id }).catch(() => {});
          await adminClient.from('zhl_tasker_gcal_events').delete().eq('id', existing.id);
        }
      } else if (existing) {
        // Update existing event
        await calendar.events.update({
          calendarId: 'primary',
          eventId: existing.gcal_event_id,
          requestBody: eventBody,
        });
      } else {
        // Create new event
        const res = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: eventBody,
        });
        if (res.data.id) {
          await adminClient.from('zhl_tasker_gcal_events').insert({
            tasker_id: tasker.id,
            user_id: userId,
            gcal_event_id: res.data.id,
          });
        }
      }
      synced++;
    } catch (err) {
      console.error(`Error syncing tasker ${tasker.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, synced });
}
