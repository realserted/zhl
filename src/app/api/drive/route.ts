import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/crypto';

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

/**
 * POST /api/drive
 * Central proxy that forwards Drive operations to the Apps Script web app.
 *
 * Body: { projectId, action, params }
 *
 * Flow:
 * 1. Authenticates the Supabase user
 * 2. Looks up the project's Apps Script URL + API key
 * 3. Gets a fresh Google access token for the user
 * 4. Forwards to Apps Script with { apiKey, accessToken, action, params }
 * 5. Returns the response
 */
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!supabaseUrl || !serviceRoleKey || !anonKey || !clientId || !clientSecret) {
    return NextResponse.json({ error: 'Server configuration incomplete.' }, { status: 500 });
  }

  // 1. Authenticate Supabase user
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token.' }, { status: 401 });
  }

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'Invalid auth token.' }, { status: 401 });
  }

  // Parse request body
  let body: { projectId: string; action: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { projectId, action, params } = body;
  if (!projectId || !action) {
    return NextResponse.json({ error: 'Missing projectId or action.' }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 2. Verify user has access to this project
  const { data: permission } = await adminClient
    .from('zhl_project_permissions')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  // Also check if user is the project owner
  const { data: project } = await adminClient
    .from('zhl_projects')
    .select('created_by')
    .eq('id', projectId)
    .maybeSingle();

  const isOwner = project?.created_by === userData.user.id;

  if (!permission && !isOwner) {
    return NextResponse.json({ error: 'Access denied to this project.' }, { status: 403 });
  }

  // 3. Get project's Drive config
  const { data: driveConfig, error: configErr } = await adminClient
    .from('zhl_project_drive_config')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  if (configErr || !driveConfig) {
    return NextResponse.json({ error: 'Google Drive not configured for this project.' }, { status: 404 });
  }

  // 4. Get fresh Google access token for the user
  const { data: tokenRow, error: tokenErr } = await adminClient
    .from('zhl_google_tokens')
    .select('encrypted_refresh_token')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'Google account not connected. Please connect your Google Drive.' }, { status: 401 });
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(tokenRow.encrypted_refresh_token);
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt stored token.' }, { status: 500 });
  }

  // Exchange refresh token for access token
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

  if (!googleRes.ok) {
    // Clean up if token is revoked
    if (googleRes.status === 400 || googleRes.status === 401) {
      await adminClient.from('zhl_google_tokens').delete().eq('user_id', userData.user.id);
      return NextResponse.json({ error: 'Google authorization expired. Please reconnect.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to refresh Google token.' }, { status: 502 });
  }

  const googleTokens = await googleRes.json();
  const accessToken = googleTokens.access_token;

  // 5. Forward to Apps Script
  try {
    const appsScriptRes = await fetch(driveConfig.apps_script_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: driveConfig.apps_script_api_key,
        accessToken,
        action,
        params: params || {},
      }),
    });

    // Apps Script may redirect (302) on doPost — follow redirects
    const responseText = await appsScriptRes.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      return NextResponse.json({ error: 'Invalid response from Apps Script.', raw: responseText }, { status: 502 });
    }

    // The Apps Script wraps responses in { status, data }
    const status = responseData.status || 200;
    return NextResponse.json(responseData.data || responseData, { status: status >= 400 ? status : 200 });
  } catch (fetchError) {
    console.error('Apps Script request failed:', fetchError);
    return NextResponse.json({ error: 'Failed to reach Apps Script. Check the URL.' }, { status: 502 });
  }
}
