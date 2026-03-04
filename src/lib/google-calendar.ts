import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

/** Generate the Google OAuth consent URL. state carries user_id through the flow. */
export function getAuthUrl(state: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state,
  });
}

/** Exchange the authorization code for tokens. */
export async function exchangeCode(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/** Get an authenticated Google Calendar client for a user. Auto-refreshes expired tokens. */
export async function getCalendarClient(userId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tokenRow } = await adminClient
    .from('zhl_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!tokenRow) return null;

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date: new Date(tokenRow.token_expiry).getTime(),
  });

  // Auto-refresh if expired
  if (new Date(tokenRow.token_expiry) < new Date()) {
    const { credentials } = await oauth2.refreshAccessToken();
    await adminClient
      .from('zhl_google_tokens')
      .update({
        access_token: credentials.access_token,
        token_expiry: new Date(credentials.expiry_date!).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    oauth2.setCredentials(credentials);
  }

  return google.calendar({ version: 'v3', auth: oauth2 });
}
