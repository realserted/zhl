import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { exchangeCode } from '@/lib/google-calendar';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const userId = req.nextUrl.searchParams.get('state');

  if (!code || !userId) {
    return NextResponse.redirect(new URL('/settings?gcal=error', req.url));
  }

  try {
    const tokens = await exchangeCode(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.redirect(new URL('/settings?gcal=error', req.url));
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    await adminClient.from('zhl_google_tokens').upsert(
      {
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry: new Date(tokens.expiry_date!).toISOString(),
      },
      { onConflict: 'user_id' },
    );

    return NextResponse.redirect(new URL('/settings?gcal=connected', req.url));
  } catch (err) {
    console.error('Google Calendar OAuth error:', err);
    return NextResponse.redirect(new URL('/settings?gcal=error', req.url));
  }
}
