import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * GET /api/auth/google
 * Initiates the Google OAuth2 flow. Redirects the user to Google's consent screen.
 * Pass ?returnUrl=/some/path to redirect back after auth.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Google OAuth not configured.' }, { status: 500 });
  }

  const returnUrl = req.nextUrl.searchParams.get('returnUrl') || '/';

  // Generate a random state parameter to prevent CSRF
  const statePayload = JSON.stringify({
    nonce: crypto.randomBytes(16).toString('hex'),
    returnUrl,
  });
  const state = Buffer.from(statePayload).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}
