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
        <a href="${meeting.meet_link}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; margin-bottom: 24px;">
          Join Meeting
        </a>
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

    return NextResponse.json({ sent, failed, total: attendees.length });
  } catch (err) {
    console.error('Error sending meeting invites:', err);
    return NextResponse.json({ error: 'Failed to send invitations' }, { status: 500 });
  }
}
