import { supabase } from '@/lib/supabase/client';
import {
  ProjectFileCustomField,
  ProjectFileCustomFieldValue,
  ProjectFileFolderPermissions,
  ProjectFileItemPermissions,
  ProjectDriveConfig,
  DriveItem,
} from '@/lib/types/files';

// ── Drive Configuration ─────────────────────────────────────────────────────

export async function getDriveConfig(projectId: string): Promise<ProjectDriveConfig | null> {
  const { data, error } = await supabase
    .from('zhl_project_drive_config')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching drive config:', error.message, error.code);
    return null;
  }
  return data;
}

export async function upsertDriveConfig(config: {
  projectId: string;
  rootFolderId: string;
  rootFolderUrl: string;
  archiveFolderId?: string | null;
  configuredBy: string | null;
}): Promise<ProjectDriveConfig | null> {
  const { data, error } = await supabase
    .from('zhl_project_drive_config')
    .upsert(
      {
        project_id: config.projectId,
        root_folder_id: config.rootFolderId,
        root_folder_url: config.rootFolderUrl,
        archive_folder_id: config.archiveFolderId ?? null,
        configured_by: config.configuredBy,
      },
      { onConflict: 'project_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error upserting drive config:', error.message, error.code);
    return null;
  }
  return data;
}

export async function updateDriveConfigArchiveId(
  projectId: string,
  archiveFolderId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_project_drive_config')
    .update({ archive_folder_id: archiveFolderId, updated_at: new Date().toISOString() })
    .eq('project_id', projectId);

  if (error) {
    console.error('Error updating archive folder ID:', error.message);
    return false;
  }
  return true;
}

// ── Drive API Proxy (calls Next.js /api/drive which proxies to Apps Script) ──

export async function callDriveProxy(
  projectId: string,
  action: string,
  params: Record<string, unknown> = {}
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    if (!accessToken) {
      return { ok: false, error: 'Not authenticated.' };
    }

    const res = await fetch('/api/drive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ projectId, action, params }),
    });

    const json = await res.json();

    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }

    return { ok: true, data: json };
  } catch (err) {
    console.error('Drive proxy call failed:', err);
    return { ok: false, error: 'Network error calling Drive API.' };
  }
}

// ── Convenience wrappers for Drive operations ───────────────────────────────

export async function listDriveFolder(
  projectId: string,
  folderId: string
): Promise<DriveItem[]> {
  const result = await callDriveProxy(projectId, 'listFolderRecursive', { folderId });
  if (!result.ok || !result.data) return [];

  const raw = (result.data as { files?: Array<Record<string, unknown>> }).files || [];
  return raw.map((f) => mapDriveFile(f, (f.parentId as string) || null));
}

/** List direct children of a folder (non-recursive, for lazy-loading tree). */
export async function listDriveFolderDirect(
  projectId: string,
  folderId: string
): Promise<DriveItem[]> {
  const result = await callDriveProxy(projectId, 'listFolder', { folderId });
  if (!result.ok || !result.data) return [];

  const raw = (result.data as { files?: Array<Record<string, unknown>> }).files || [];
  return raw.map((f) => mapDriveFile(f, folderId));
}

function mapDriveFile(f: Record<string, unknown>, parentId: string | null): DriveItem {
  return {
    id: f.id as string,
    parentId,
    name: f.name as string,
    mimeType: (f.mimeType as string) || null,
    size: f.size ? Number(f.size) : null,
    isFolder: f.mimeType === 'application/vnd.google-apps.folder',
    webViewLink: (f.webViewLink as string) || null,
    webContentLink: (f.webContentLink as string) || null,
    modifiedTime: (f.modifiedTime as string) || null,
    iconLink: (f.iconLink as string) || null,
    thumbnailLink: (f.thumbnailLink as string) || null,
  };
}

/** Get raw file content for text-preview (proxied through Drive API). */
export async function getDriveFileContent(
  projectId: string,
  fileId: string
): Promise<string | null> {
  const result = await callDriveProxy(projectId, 'getFileContent', { fileId });
  if (!result.ok || !result.data) return null;
  return (result.data as { content?: string }).content ?? null;
}

/** Get raw binary file content as a blob URL (for videos, images, Office docs). */
export async function getDriveFileBinary(
  projectId: string,
  fileId: string
): Promise<{ blobUrl: string; contentType: string } | null> {
  const result = await callDriveProxy(projectId, 'getFileBinary', { fileId });
  if (!result.ok || !result.data) return null;
  const { base64, contentType } = result.data as { base64: string; contentType: string };
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: contentType });
  return { blobUrl: URL.createObjectURL(blob), contentType };
}

/** Export a Google Workspace file as HTML. */
export async function exportGoogleDocAsHtml(
  projectId: string,
  fileId: string
): Promise<string | null> {
  const result = await callDriveProxy(projectId, 'exportGoogleDoc', { fileId, exportMime: 'text/html' });
  if (!result.ok || !result.data) return null;
  return (result.data as { content?: string }).content ?? null;
}

/** Convert Office file (.pptx/.xlsx/.ppt/.xls) to PDF and return as blob URL. */
export async function convertOfficeToPdf(
  projectId: string,
  fileId: string,
  mimeType: string
): Promise<string | null> {
  const result = await callDriveProxy(projectId, 'convertOfficeToPdf', { fileId, mimeType });
  if (!result.ok || !result.data) return null;
  const { base64, contentType } = result.data as { base64: string; contentType: string };
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: contentType });
  return URL.createObjectURL(blob);
}

/** Get a file's thumbnail as blob URL. */
export async function getDriveFileThumbnail(
  projectId: string,
  fileId: string
): Promise<string | null> {
  const result = await callDriveProxy(projectId, 'getThumbnail', { fileId });
  if (!result.ok || !result.data) return null;
  const { base64, contentType } = result.data as { base64: string; contentType: string };
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: contentType });
  return URL.createObjectURL(blob);
}

export async function createDriveFolder(
  projectId: string,
  name: string,
  parentId: string
): Promise<{ ok: boolean; folderId?: string; error?: string }> {
  const result = await callDriveProxy(projectId, 'createFolder', { name, parentId });
  if (!result.ok) return { ok: false, error: result.error };
  const data = result.data as { id?: string };
  return { ok: true, folderId: data.id };
}

export async function renameDriveItem(
  projectId: string,
  fileId: string,
  newName: string
): Promise<boolean> {
  const result = await callDriveProxy(projectId, 'renameFile', { fileId, newName });
  return result.ok;
}

export async function moveDriveItem(
  projectId: string,
  fileId: string,
  fromFolderId: string,
  toFolderId: string
): Promise<boolean> {
  const result = await callDriveProxy(projectId, 'moveFile', { fileId, fromFolderId, toFolderId });
  return result.ok;
}

export async function archiveDriveItem(
  projectId: string,
  fileId: string,
  currentParentId: string,
  archiveFolderId: string
): Promise<boolean> {
  const result = await callDriveProxy(projectId, 'deleteFile', {
    fileId,
    currentParentId,
    archiveFolderId,
  });
  return result.ok;
}

export async function restoreDriveItem(
  projectId: string,
  fileId: string,
  archiveFolderId: string,
  targetFolderId: string
): Promise<boolean> {
  const result = await callDriveProxy(projectId, 'restoreFile', {
    fileId,
    archiveFolderId,
    targetFolderId,
  });
  return result.ok;
}

export async function ensureArchiveFolder(
  projectId: string,
  rootFolderId: string
): Promise<string | null> {
  const result = await callDriveProxy(projectId, 'ensureArchive', { rootFolderId });
  if (!result.ok) return null;
  const data = result.data as { archiveFolderId?: string };
  return data.archiveFolderId || null;
}

// ── Permissions (unchanged — UI-only visibility controls) ───────────────────

export async function getAllFolderPermissions(projectId: string): Promise<ProjectFileFolderPermissions[]> {
  const { data, error } = await supabase
    .from('zhl_project_file_folder_permissions')
    .select('*')
    .eq('project_id', projectId);

  if (error) {
    console.error('Error fetching all folder permissions:', error.message, error.code);
    return [];
  }
  return data ?? [];
}

export async function upsertFolderPermissions(payload: {
  projectId: string;
  folderId: string;
  userId: string | null;
  allow_all_users: boolean;
  allow_project_manager: boolean;
  allow_property_manager: boolean;
  allow_accountant: boolean;
  allow_anyone_with_link: boolean;
  link_enabled: boolean;
}): Promise<ProjectFileFolderPermissions | null> {
  const { data, error } = await supabase
    .from('zhl_project_file_folder_permissions')
    .upsert(
      {
        project_id: payload.projectId,
        folder_id: payload.folderId,
        updated_by: payload.userId,
        allow_all_users: payload.allow_all_users,
        allow_project_manager: payload.allow_project_manager,
        allow_property_manager: payload.allow_property_manager,
        allow_accountant: payload.allow_accountant,
        allow_anyone_with_link: payload.allow_anyone_with_link,
        link_enabled: payload.link_enabled,
      },
      { onConflict: 'folder_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error upserting folder permissions:', error.message, error.code, error.details, error.hint);
    return null;
  }
  return data;
}

export async function getAllFilePermissions(projectId: string): Promise<ProjectFileItemPermissions[]> {
  const { data, error } = await supabase
    .from('zhl_project_file_item_permissions')
    .select('*')
    .eq('project_id', projectId);

  if (error) {
    console.error('Error fetching all file permissions:', error.message, error.code);
    return [];
  }
  return data ?? [];
}

export async function upsertFilePermissions(payload: {
  projectId: string;
  fileId: string;
  userId: string | null;
  allow_all_users: boolean;
  allow_project_manager: boolean;
  allow_property_manager: boolean;
  allow_accountant: boolean;
  allow_anyone_with_link: boolean;
  link_enabled: boolean;
}): Promise<ProjectFileItemPermissions | null> {
  const { data, error } = await supabase
    .from('zhl_project_file_item_permissions')
    .upsert(
      {
        project_id: payload.projectId,
        file_id: payload.fileId,
        updated_by: payload.userId,
        allow_all_users: payload.allow_all_users,
        allow_project_manager: payload.allow_project_manager,
        allow_property_manager: payload.allow_property_manager,
        allow_accountant: payload.allow_accountant,
        allow_anyone_with_link: payload.allow_anyone_with_link,
        link_enabled: payload.link_enabled,
      },
      { onConflict: 'file_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error upserting file permissions:', error.message, error.code);
    return null;
  }
  return data;
}

// ── Custom Fields (unchanged) ───────────────────────────────────────────────

export async function getCustomFields(projectId: string): Promise<ProjectFileCustomField[]> {
  const { data, error } = await supabase
    .from('zhl_project_file_custom_fields')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at');

  if (error) {
    console.error('Error fetching custom fields:', error.message, error.code);
    return [];
  }
  return data ?? [];
}

export async function createCustomField(payload: {
  projectId: string;
  name: string;
  targetType: 'folder' | 'file';
  warningMessage: string | null;
  ignoreWarningDays: number | null;
  required: boolean;
  userId: string | null;
}): Promise<ProjectFileCustomField | null> {
  const { data, error } = await supabase
    .from('zhl_project_file_custom_fields')
    .insert({
      project_id: payload.projectId,
      name: payload.name,
      target_type: payload.targetType,
      warning_message: payload.warningMessage,
      ignore_warning_days: payload.ignoreWarningDays,
      required: payload.required,
      created_by: payload.userId,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating custom field:', error.message, error.code);
    return null;
  }
  return data;
}

export async function getCustomFieldValuesForTarget(params: {
  customFieldIds: string[];
  folderId?: string;
  fileId?: string;
}): Promise<ProjectFileCustomFieldValue[]> {
  if (params.customFieldIds.length === 0) return [];

  let query = supabase
    .from('zhl_project_file_custom_field_values')
    .select('*')
    .in('custom_field_id', params.customFieldIds);

  if (params.folderId) {
    query = query.eq('folder_id', params.folderId);
  }
  if (params.fileId) {
    query = query.eq('file_id', params.fileId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching custom field values:', error.message, error.code);
    return [];
  }

  return data ?? [];
}

export async function upsertCustomFieldValue(payload: {
  customFieldId: string;
  folderId: string | null;
  fileId: string | null;
  valueText: string | null;
  ignoredUntil: string | null;
}): Promise<ProjectFileCustomFieldValue | null> {
  const conflictKey = payload.folderId ? 'custom_field_id,folder_id' : 'custom_field_id,file_id';

  const { data, error } = await supabase
    .from('zhl_project_file_custom_field_values')
    .upsert(
      {
        custom_field_id: payload.customFieldId,
        folder_id: payload.folderId,
        file_id: payload.fileId,
        value_text: payload.valueText,
        ignored_until: payload.ignoredUntil,
      },
      { onConflict: conflictKey }
    )
    .select()
    .single();

  if (error) {
    console.error('Error upserting custom field value:', error.message, error.code);
    return null;
  }

  return data;
}

// ── Unit Data Linking (updated to use Drive file IDs) ───────────────────────

/** Get a map of Drive file/folder ID -> linked target info for all linked items in a project. */
export async function getLinkedUnitDataMap(projectId: string): Promise<Map<string, { type: 'field' | 'category'; name: string; parentName?: string }>> {
  const map = new Map<string, { type: 'field' | 'category'; name: string; parentName?: string }>();

  const [{ data: fields }, { data: cats }] = await Promise.all([
    supabase
      .from('zhl_unit_data_fields')
      .select('name, linked_file_path, zhl_unit_data_categories(name)')
      .eq('project_id', projectId)
      .not('linked_file_path', 'is', null),
    supabase
      .from('zhl_unit_data_categories')
      .select('name, linked_file_path')
      .eq('project_id', projectId)
      .not('linked_file_path', 'is', null),
  ]);

  if (fields) {
    for (const f of fields as unknown as Array<{ name: string; linked_file_path: string; zhl_unit_data_categories: { name: string } | null }>) {
      map.set(f.linked_file_path, { type: 'field', name: f.name, parentName: f.zhl_unit_data_categories?.name ?? undefined });
    }
  }
  if (cats) {
    for (const c of cats as Array<{ name: string; linked_file_path: string }>) {
      map.set(c.linked_file_path, { type: 'category', name: c.name });
    }
  }

  return map;
}

/** Link a Drive file/folder to a unit data field or category. Uses Drive file ID as the path. */
export async function linkFileToUnitData(
  targetType: 'field' | 'category',
  targetId: string,
  fileName: string,
  driveFileId: string
): Promise<boolean> {
  const table = targetType === 'field' ? 'zhl_unit_data_fields' : 'zhl_unit_data_categories';
  const { error } = await supabase
    .from(table)
    .update({ linked_file_name: fileName, linked_file_path: driveFileId })
    .eq('id', targetId);
  if (error) {
    console.error(`Error linking file to ${targetType}:`, error.message);
    return false;
  }
  return true;
}
