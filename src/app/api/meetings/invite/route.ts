import { NextRequest, NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { attendees, meeting } = body as {
      attendees: { email: string; display_name: string }[];
      meeting: {
        title: string;
        event_date?: string;
        date?: string;
        event_time?: string | null;
        time?: string | null;
        duration: number;
        location: string | null;
        meet_link: string | null;
        organizer_name: string;
      };
    };

    if (!attendees || attendees.length === 0) {
      return NextResponse.json({ error: 'No attendees provided' }, { status: 400 });
    }

    // Support both field names (event_date/event_time from ScheduleWizard, date/time as fallback)
    const dateValue = meeting.event_date || meeting.date;
    const timeValue = meeting.event_time ?? meeting.time ?? null;

    const formattedDate = dateValue
      ? new Date(dateValue + 'T00:00:00').toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : 'TBD';

    const formattedTime = timeValue
      ? new Date(`2000-01-01T${timeValue}`).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      : 'All day';

    // Build Google Calendar "Add to Calendar" link
    let googleCalUrl = '';
    if (dateValue) {
      const dateClean = dateValue.replace(/-/g, '');
      let startDt: string;
      let endDt: string;
      if (timeValue) {
        // Time-based event: YYYYMMDDTHHmmSS
        const [hh, mm] = timeValue.split(':').map(Number);
        const startMin = hh * 60 + mm;
        const endMin = startMin + (meeting.duration || 30);
        const endHH = String(Math.floor(endMin / 60)).padStart(2, '0');
        const endMM = String(endMin % 60).padStart(2, '0');
        startDt = `${dateClean}T${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}00`;
        endDt = `${dateClean}T${endHH}${endMM}00`;
      } else {
        // All-day event
        startDt = dateClean;
        const nextDay = new Date(dateValue + 'T00:00:00');
        nextDay.setDate(nextDay.getDate() + 1);
        endDt = nextDay.toISOString().slice(0, 10).replace(/-/g, '');
      }
      const calParams = new URLSearchParams({
        action: 'TEMPLATE',
        text: meeting.title,
        dates: `${startDt}/${endDt}`,
        details: meeting.meet_link
          ? `Join Google Meet: ${meeting.meet_link}\n\nOrganized by ${meeting.organizer_name} via ZHL`
          : `Organized by ${meeting.organizer_name} via ZHL`,
        ...(meeting.location ? { location: meeting.location } : {}),
      });
      googleCalUrl = `https://calendar.google.com/calendar/render?${calParams.toString()}`;
    }

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background: #111; color: #eee; border-radius: 16px;">
        <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">You're Invited to a Meeting</h1>
        <p style="color: #999; font-size: 14px; margin: 0 0 24px;">Invited by <strong style="color: #fff;">${meeting.organizer_name}</strong></p>

        <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px; color: #4ade80;">${meeting.title}</h2>
          <table style="width: 100%; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #999; width: 100px;">Date</td>
              <td style="padding: 6px 0; color: #fff;">${formattedDate}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #999;">Time</td>
              <td style="padding: 6px 0; color: #fff;">${formattedTime}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #999;">Duration</td>
              <td style="padding: 6px 0; color: #fff;">${meeting.duration} minutes</td>
            </tr>
            ${meeting.location ? `<tr><td style="padding: 6px 0; color: #999;">Location</td><td style="padding: 6px 0; color: #fff;">${meeting.location}</td></tr>` : ''}
          </table>
        </div>

        ${meeting.meet_link ? `
        <div style="margin-bottom: 16px;">
          <a href="${meeting.meet_link}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Join Google Meet
          </a>
        </div>
        <p style="font-size: 12px; color: #999; margin: 0 0 20px;">
          <a href="${meeting.meet_link}" style="color: #60a5fa; text-decoration: none;">${meeting.meet_link}</a>
        </p>
        ` : ''}

        ${googleCalUrl ? `
        <div style="margin-bottom: 24px;">
          <a href="${googleCalUrl}" target="_blank" style="display: inline-block; background: #1a1a1a; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 1px solid #333;">
            📅 Add to Google Calendar
          </a>
        </div>
        ` : ''}

        <p style="color: #666; font-size: 12px; margin-top: 24px; border-top: 1px solid #333; padding-top: 16px;">
          This invitation was sent via ZHL — Zero Hassle Landlord
        </p>
      </div>
    `;

    const messages = attendees.map((attendee) => ({
      to: attendee.email,
      from: { email: process.env.SENDGRID_FROM_EMAIL || 'meetings@zerohasslelandlord.com', name: 'ZHL Meetings' },
      subject: `Meeting Invitation: ${meeting.title}`,
      html: htmlContent,
    }));

    const results = await Promise.allSettled(
      messages.map((msg) => sgMail.send(msg))
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    // Log failures for debugging
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`Failed to send invite to ${attendees[i]?.email}:`, r.reason?.response?.body || r.reason?.message || r.reason);
      }
    });

    return NextResponse.json({ sent, failed, total: attendees.length });
  } catch (err) {
    console.error('Error sending meeting invites:', err);
    return NextResponse.json({ error: 'Failed to send invitations' }, { status: 500 });
  }
}
