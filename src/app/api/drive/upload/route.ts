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
 * POST /api/drive/upload
 * Uploads a file directly to Google Drive using the user's OAuth token.
 *
 * Expects multipart/form-data with:
 *   - file: the file to upload
 *   - projectId: the ZHL project ID
 *   - folderId: the target Google Drive folder ID
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

  // 1. Authenticate
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

  // 2. Parse form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const projectId = formData.get('projectId') as string | null;
  const folderId = formData.get('folderId') as string | null;

  if (!file || !projectId || !folderId) {
    return NextResponse.json({ error: 'Missing file, projectId, or folderId.' }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. Verify project access
  const { data: permission } = await adminClient
    .from('zhl_project_permissions')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  const { data: project } = await adminClient
    .from('zhl_projects')
    .select('created_by')
    .eq('id', projectId)
    .maybeSingle();

  if (!permission && project?.created_by !== userData.user.id) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  }

  // 4. Get Google access token
  const { data: tokenRow } = await adminClient
    .from('zhl_google_tokens')
    .select('encrypted_refresh_token')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: 'Google account not connected.' }, { status: 401 });
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(tokenRow.encrypted_refresh_token);
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt stored token.' }, { status: 500 });
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

  if (!googleRes.ok) {
    if (googleRes.status === 400 || googleRes.status === 401) {
      await adminClient.from('zhl_google_tokens').delete().eq('user_id', userData.user.id);
      return NextResponse.json({ error: 'Google authorization expired. Please reconnect.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to refresh Google token.' }, { status: 502 });
  }

  const googleTokens = await googleRes.json();
  const accessToken = googleTokens.access_token;

  // 5. Upload to Google Drive using multipart upload
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const boundary = '---zhl_upload_boundary---';

  const metadata = JSON.stringify({
    name: file.name,
    parents: [folderId],
  });

  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`
    ),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!uploadRes.ok) {
    const errBody = await uploadRes.text();
    console.error('Google Drive upload failed:', errBody);
    return NextResponse.json({ error: 'Upload to Google Drive failed.' }, { status: 502 });
  }

  const uploadedFile = await uploadRes.json();

  // Auto-share so the file is accessible in iframe editors
  await fetch(`https://www.googleapis.com/drive/v3/files/${uploadedFile.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'writer', type: 'anyone' }),
  }).catch(() => {});

  return NextResponse.json(uploadedFile);
}
