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
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData } = await anonClient.auth.getUser(token);
  if (!userData?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = userData.user.id;

  // No-op if user hasn't connected Google Calendar
  const calendar = await getCalendarClient(userId);
  if (!calendar) return NextResponse.json({ ok: true, skipped: true });

  const { taskerId } = (await req.json()) as { taskerId: string };
  if (!taskerId) return NextResponse.json({ error: 'Missing taskerId.' }, { status: 400 });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch the tasker
  const { data: tasker } = await adminClient
    .from('zhl_taskers')
    .select('*')
    .eq('id', taskerId)
    .single();

  if (!tasker) return NextResponse.json({ ok: true });

  // Fetch existing mapping
  const { data: mapping } = await adminClient
    .from('zhl_tasker_gcal_events')
    .select('*')
    .eq('tasker_id', taskerId)
    .eq('user_id', userId)
    .maybeSingle();

  try {
    // No due date or completed/archived → remove if mapped
    if (!tasker.due_date || tasker.status === 'Archived' || tasker.status === 'Complete') {
      if (mapping) {
        await calendar.events.delete({ calendarId: 'primary', eventId: mapping.gcal_event_id }).catch(() => {});
        await adminClient.from('zhl_tasker_gcal_events').delete().eq('id', mapping.id);
      }
      return NextResponse.json({ ok: true });
    }

    const eventBody = {
      summary: tasker.task_name,
      description: [
        tasker.description,
        tasker.responsible_name ? `Responsible: ${tasker.responsible_name}` : null,
        `Status: ${tasker.status}`,
      ]
        .filter(Boolean)
        .join('\n'),
      start: { date: tasker.due_date },
      end: { date: tasker.due_date },
    };

    if (mapping) {
      await calendar.events.update({
        calendarId: 'primary',
        eventId: mapping.gcal_event_id,
        requestBody: eventBody,
      });
    } else {
      const res = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: eventBody,
      });
      if (res.data.id) {
        await adminClient.from('zhl_tasker_gcal_events').insert({
          tasker_id: taskerId,
          user_id: userId,
          gcal_event_id: res.data.id,
        });
      }
    }
  } catch (err) {
    console.error(`Error syncing tasker ${taskerId} to Google Calendar:`, err);
  }

  return NextResponse.json({ ok: true });
}
