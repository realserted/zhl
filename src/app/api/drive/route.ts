import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/crypto';

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/**
 * POST /api/drive
 * Calls Google Drive API directly using the user's OAuth token.
 *
 * Body: { projectId, action, params }
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

  const { projectId, action, params = {} } = body;
  if (!projectId || !action) {
    return NextResponse.json({ error: 'Missing projectId or action.' }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 2. Verify user has access to this project
  const { data: permission } = await adminClient
    .from('zhl_project_permissions')
    .select('id, project_role')
    .eq('project_id', projectId)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  const { data: project } = await adminClient
    .from('zhl_projects')
    .select('owner_id')
    .eq('id', projectId)
    .maybeSingle();

  // Check if user is a system admin
  const { data: accountRow } = await adminClient
    .from('zhl_accounts')
    .select('is_admin')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  const isSysAdmin = accountRow?.is_admin === true;

  if (!permission && project?.owner_id !== userData.user.id && !isSysAdmin) {
    return NextResponse.json({ error: 'Access denied to this project.' }, { status: 403 });
  }

  // 2b. Action-level authorization
  // Read-only actions allowed for all project members
  const READ_ACTIONS = ['listFolder', 'listFolderRecursive', 'getFileUrl', 'getFolderInfo',
    'getFileContent', 'getFileBinary', 'exportGoogleDoc', 'convertOfficeToPdf', 'getThumbnail'];
  // Write actions require owner/admin role
  const WRITE_ACTIONS = ['createFolder', 'renameFile', 'moveFile', 'deleteFile', 'restoreFile', 'ensureArchive', 'uploadFile'];

  const isProjectOwner = project?.owner_id === userData.user.id;
  if (WRITE_ACTIONS.includes(action) && !isProjectOwner && !isSysAdmin) {
    const role = (permission as { project_role?: string } | null)?.project_role || '';
    if (!role.includes('Project Manager')) {
      return NextResponse.json({ error: 'You do not have permission to perform this action.' }, { status: 403 });
    }
  }

  if (!READ_ACTIONS.includes(action) && !WRITE_ACTIONS.includes(action)) {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
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

  // 4. Get fresh Google access token
  //    Use the project owner's Google token so all permitted members can access Drive files.
  //    File-level visibility is controlled by the permission checkboxes (All Users, Project Manager, etc.)
  const driveTokenUserId = project?.owner_id ?? userData.user.id;
  const { data: tokenRow } = await adminClient
    .from('zhl_google_tokens')
    .select('encrypted_refresh_token')
    .eq('user_id', driveTokenUserId)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: 'Google Drive not connected. The project owner needs to connect Google Drive first.' }, { status: 401 });
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
  const headers = { Authorization: `Bearer ${googleTokens.access_token}` };

  // 5. Handle actions directly via Google Drive API
  try {
    switch (action) {
      case 'listFolder':
        return await handleListFolder(headers, params);
      case 'listFolderRecursive':
        return await handleListFolderRecursive(headers, params);
      case 'createFolder':
        return await handleCreateFolder(headers, params);
      case 'renameFile':
        return await handleRenameFile(headers, params);
      case 'moveFile':
        return await handleMoveFile(headers, params);
      case 'deleteFile':
        return await handleDeleteFile(headers, params);
      case 'restoreFile':
        return await handleRestoreFile(headers, params);
      case 'ensureArchive':
        return await handleEnsureArchive(headers, params);
      case 'getFileUrl':
        return await handleGetFileUrl(headers, params);
      case 'getFolderInfo':
        return await handleGetFolderInfo(headers, params);
      case 'getFileContent':
        return await handleGetFileContent(headers, params);
      case 'getFileBinary':
        return await handleGetFileBinary(headers, params);
      case 'exportGoogleDoc':
        return await handleExportGoogleDoc(headers, params);
      case 'convertOfficeToPdf':
        return await handleConvertOfficeToPdf(headers, params);
      case 'getThumbnail':
        return await handleGetThumbnail(headers, params);
      case 'uploadFile':
        return await handleUploadFile(headers, params);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Drive API error:', err);
    return NextResponse.json({ error: 'Drive API request failed.' }, { status: 502 });
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,iconLink,thumbnailLink,parents';

async function driveList(headers: Record<string, string>, query: string): Promise<Array<Record<string, unknown>>> {
  const allFiles: Array<Record<string, unknown>> = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set('q', query);
    url.searchParams.set('fields', `nextPageToken,files(${FILE_FIELDS})`);
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('orderBy', 'folder,name');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(JSON.stringify(err));
    }

    const data = await res.json();
    allFiles.push(...(data.files || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return allFiles;
}

async function handleListFolder(headers: Record<string, string>, params: Record<string, unknown>) {
  const folderId = params.folderId as string;
  if (!folderId) return NextResponse.json({ error: 'Missing folderId.' }, { status: 400 });

  const files = await driveList(headers, `'${folderId}' in parents and trashed=false`);
  return NextResponse.json({ files });
}

async function handleListFolderRecursive(headers: Record<string, string>, params: Record<string, unknown>) {
  const folderId = params.folderId as string;
  if (!folderId) return NextResponse.json({ error: 'Missing folderId.' }, { status: 400 });

  const allItems: Array<Record<string, unknown>> = [];
  const queue = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const files = await driveList(headers, `'${currentId}' in parents and trashed=false`);

    for (const file of files) {
      (file as Record<string, unknown>).parentId = currentId;
      allItems.push(file);
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        queue.push(file.id as string);
      }
    }
  }

  return NextResponse.json({ files: allItems });
}

async function handleCreateFolder(headers: Record<string, string>, params: Record<string, unknown>) {
  const { name, parentId } = params as { name?: string; parentId?: string };
  if (!name || !parentId) return NextResponse.json({ error: 'Missing name or parentId.' }, { status: 400 });

  const res = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });

  return NextResponse.json(await res.json(), { status: res.ok ? 200 : res.status });
}

async function handleRenameFile(headers: Record<string, string>, params: Record<string, unknown>) {
  const { fileId, newName } = params as { fileId?: string; newName?: string };
  if (!fileId || !newName) return NextResponse.json({ error: 'Missing fileId or newName.' }, { status: 400 });

  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });

  return NextResponse.json(await res.json(), { status: res.ok ? 200 : res.status });
}

async function handleMoveFile(headers: Record<string, string>, params: Record<string, unknown>) {
  const { fileId, fromFolderId, toFolderId } = params as { fileId?: string; fromFolderId?: string; toFolderId?: string };
  if (!fileId || !fromFolderId || !toFolderId) {
    return NextResponse.json({ error: 'Missing fileId, fromFolderId, or toFolderId.' }, { status: 400 });
  }

  const url = `${DRIVE_API}/files/${fileId}?addParents=${encodeURIComponent(toFolderId)}&removeParents=${encodeURIComponent(fromFolderId)}&fields=id,name,parents`;
  const res = await fetch(url, { method: 'PATCH', headers });

  return NextResponse.json(await res.json(), { status: res.ok ? 200 : res.status });
}

async function handleDeleteFile(headers: Record<string, string>, params: Record<string, unknown>) {
  const { fileId, currentParentId, archiveFolderId } = params as { fileId?: string; currentParentId?: string; archiveFolderId?: string };
  if (!fileId || !currentParentId || !archiveFolderId) {
    return NextResponse.json({ error: 'Missing fileId, currentParentId, or archiveFolderId.' }, { status: 400 });
  }

  const url = `${DRIVE_API}/files/${fileId}?addParents=${encodeURIComponent(archiveFolderId)}&removeParents=${encodeURIComponent(currentParentId)}&fields=id,name,parents`;
  const res = await fetch(url, { method: 'PATCH', headers });

  return NextResponse.json(await res.json(), { status: res.ok ? 200 : res.status });
}

async function handleRestoreFile(headers: Record<string, string>, params: Record<string, unknown>) {
  const { fileId, archiveFolderId, targetFolderId } = params as { fileId?: string; archiveFolderId?: string; targetFolderId?: string };
  if (!fileId || !archiveFolderId || !targetFolderId) {
    return NextResponse.json({ error: 'Missing fileId, archiveFolderId, or targetFolderId.' }, { status: 400 });
  }

  const url = `${DRIVE_API}/files/${fileId}?addParents=${encodeURIComponent(targetFolderId)}&removeParents=${encodeURIComponent(archiveFolderId)}&fields=id,name,parents`;
  const res = await fetch(url, { method: 'PATCH', headers });

  return NextResponse.json(await res.json(), { status: res.ok ? 200 : res.status });
}

async function handleEnsureArchive(headers: Record<string, string>, params: Record<string, unknown>) {
  const rootFolderId = params.rootFolderId as string;
  if (!rootFolderId) return NextResponse.json({ error: 'Missing rootFolderId.' }, { status: 400 });

  // Search for existing ARCHIVE folder
  const searchQuery = `'${rootFolderId}' in parents and name='ARCHIVE' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const existing = await driveList(headers, searchQuery);

  if (existing.length > 0) {
    return NextResponse.json({ archiveFolderId: existing[0].id, created: false });
  }

  // Create ARCHIVE folder
  const res = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ARCHIVE', mimeType: 'application/vnd.google-apps.folder', parents: [rootFolderId] }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to create ARCHIVE folder.' }, { status: res.status });
  }

  const created = await res.json();
  return NextResponse.json({ archiveFolderId: created.id, created: true });
}

async function handleGetFileUrl(headers: Record<string, string>, params: Record<string, unknown>) {
  const fileId = params.fileId as string;
  if (!fileId) return NextResponse.json({ error: 'Missing fileId.' }, { status: 400 });

  const res = await fetch(`${DRIVE_API}/files/${fileId}?fields=id,name,webViewLink,webContentLink,mimeType`, { headers });
  return NextResponse.json(await res.json(), { status: res.ok ? 200 : res.status });
}

async function handleGetFolderInfo(headers: Record<string, string>, params: Record<string, unknown>) {
  const folderId = params.folderId as string;
  if (!folderId) return NextResponse.json({ error: 'Missing folderId.' }, { status: 400 });

  const res = await fetch(`${DRIVE_API}/files/${folderId}?fields=id,name,mimeType,owners,shared`, { headers });
  return NextResponse.json(await res.json(), { status: res.ok ? 200 : res.status });
}

async function handleGetFileContent(headers: Record<string, string>, params: Record<string, unknown>) {
  const fileId = params.fileId as string;
  if (!fileId) return NextResponse.json({ error: 'Missing fileId.' }, { status: 400 });

  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers });
  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch file content.' }, { status: res.status });
  }

  const text = await res.text();
  return NextResponse.json({ content: text });
}

/** Return raw binary file content as base64 (for videos, images, Office docs). */
async function handleGetFileBinary(headers: Record<string, string>, params: Record<string, unknown>) {
  const fileId = params.fileId as string;
  if (!fileId) return NextResponse.json({ error: 'Missing fileId.' }, { status: 400 });

  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers });
  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch file.' }, { status: res.status });
  }

  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return NextResponse.json({ base64, contentType });
}

/** Export a Google Workspace file (Docs/Sheets/Slides) as HTML. */
async function handleExportGoogleDoc(headers: Record<string, string>, params: Record<string, unknown>) {
  const fileId = params.fileId as string;
  const exportMime = (params.exportMime as string) || 'text/html';
  if (!fileId) return NextResponse.json({ error: 'Missing fileId.' }, { status: 400 });

  const url = `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to export file.' }, { status: res.status });
  }

  const html = await res.text();
  return NextResponse.json({ content: html });
}

/** Convert Office file (.pptx/.xlsx/.xls/.ppt) to PDF via copy-to-Google → export. */
async function handleConvertOfficeToPdf(headers: Record<string, string>, params: Record<string, unknown>) {
  const fileId = params.fileId as string;
  const mimeType = params.mimeType as string;
  if (!fileId || !mimeType) return NextResponse.json({ error: 'Missing fileId or mimeType.' }, { status: 400 });

  const googleMimeMap: Record<string, string> = {
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
    'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
    'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
  };

  const googleMime = googleMimeMap[mimeType];
  if (!googleMime) {
    return NextResponse.json({ error: 'Unsupported MIME type for PDF conversion.' }, { status: 400 });
  }

  let tempId: string | null = null;
  try {
    // 1. Copy file as Google format
    const copyRes = await fetch(`${DRIVE_API}/files/${fileId}/copy`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: googleMime }),
    });
    if (!copyRes.ok) return NextResponse.json({ error: 'Failed to copy file.' }, { status: copyRes.status });
    const copyData = await copyRes.json();
    tempId = copyData.id;

    // 2. Export as PDF
    const exportUrl = `${DRIVE_API}/files/${tempId}/export?mimeType=${encodeURIComponent('application/pdf')}`;
    const pdfRes = await fetch(exportUrl, { headers });
    if (!pdfRes.ok) return NextResponse.json({ error: 'Failed to export as PDF.' }, { status: pdfRes.status });

    const pdfBuffer = await pdfRes.arrayBuffer();
    const base64 = Buffer.from(pdfBuffer).toString('base64');
    return NextResponse.json({ base64, contentType: 'application/pdf' });
  } finally {
    // 3. Delete temp copy
    if (tempId) {
      fetch(`${DRIVE_API}/files/${tempId}`, { method: 'DELETE', headers }).catch(() => {});
    }
  }
}

/** Get a file's thumbnail from Google Drive. */
async function handleGetThumbnail(headers: Record<string, string>, params: Record<string, unknown>) {
  const fileId = params.fileId as string;
  if (!fileId) return NextResponse.json({ error: 'Missing fileId.' }, { status: 400 });

  // Get thumbnailLink from metadata
  const metaRes = await fetch(`${DRIVE_API}/files/${fileId}?fields=thumbnailLink`, { headers });
  if (!metaRes.ok) return NextResponse.json({ error: 'Failed to get metadata.' }, { status: metaRes.status });

  const meta = await metaRes.json();
  if (!meta.thumbnailLink) return NextResponse.json({ error: 'No thumbnail available.' }, { status: 404 });

  // Fetch thumbnail at higher resolution
  const thumbUrl = (meta.thumbnailLink as string).replace(/=s\d+/, '=s1600');
  const thumbRes = await fetch(thumbUrl, { headers });
  if (!thumbRes.ok) return NextResponse.json({ error: 'Failed to fetch thumbnail.' }, { status: thumbRes.status });

  const thumbBuffer = await thumbRes.arrayBuffer();
  const base64 = Buffer.from(thumbBuffer).toString('base64');
  const contentType = thumbRes.headers.get('content-type') || 'image/png';
  return NextResponse.json({ base64, contentType });
}

/** Upload a file to Google Drive. Expects base64-encoded file content. */
async function handleUploadFile(headers: Record<string, string>, params: Record<string, unknown>) {
  const fileName = params.fileName as string;
  const parentId = params.parentId as string;
  const mimeType = params.mimeType as string || 'application/octet-stream';
  const base64Content = params.base64Content as string;

  if (!fileName || !parentId || !base64Content) {
    return NextResponse.json({ error: 'Missing fileName, parentId, or base64Content.' }, { status: 400 });
  }

  // Google Drive uses multipart upload: metadata + file content
  const metadata = JSON.stringify({
    name: fileName,
    parents: [parentId],
  });

  const fileBytes = Buffer.from(base64Content, 'base64');
  const boundary = '-------zhl_upload_boundary';

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FILE_FIELDS}`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('Drive upload failed:', err);
    return NextResponse.json({ error: 'Failed to upload file.' }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
