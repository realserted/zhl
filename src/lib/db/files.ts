import { supabase } from '@/lib/supabase/client';
import {
  ProjectFileBackup,
  ProjectFileBackupRequest,
  ProjectFileCustomField,
  ProjectFileCustomFieldValue,
  ProjectFileDownloadLog,
  ProjectFileFolder,
  ProjectFileFolderPermissions,
  ProjectFileItem,
  ProjectFileItemPermissions,
} from '@/lib/types/files';

export async function getFileFolders(projectId: string): Promise<ProjectFileFolder[]> {
  const { data, error } = await supabase
    .from('zhl_project_file_folders')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order')
    .order('created_at');

  if (error) {
    console.error('Error fetching file folders:', error);
    return [];
  }
  return data ?? [];
}

export async function createFileFolder(
  projectId: string,
  name: string,
  parentFolderId: string | null,
  sortOrder: number,
  userId: string | null
): Promise<ProjectFileFolder | null> {
  const { data, error } = await supabase
    .from('zhl_project_file_folders')
    .insert({
      project_id: projectId,
      name,
      parent_folder_id: parentFolderId,
      sort_order: sortOrder,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating file folder:', error);
    return null;
  }
  return data;
}

export async function getFilesForProject(projectId: string): Promise<ProjectFileItem[]> {
  const { data, error } = await supabase
    .from('zhl_project_files')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching files:', error);
    return [];
  }
  return data ?? [];
}

export async function getFolderPermissions(folderId: string): Promise<ProjectFileFolderPermissions | null> {
  const { data, error } = await supabase
    .from('zhl_project_file_folder_permissions')
    .select('*')
    .eq('folder_id', folderId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching folder permissions:', error);
    return null;
  }
  return data;
}

export async function getAllFolderPermissions(projectId: string): Promise<ProjectFileFolderPermissions[]> {
  const { data, error } = await supabase
    .from('zhl_project_file_folder_permissions')
    .select('*')
    .eq('project_id', projectId);

  if (error) {
    console.error('Error fetching all folder permissions:', error);
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
    console.error('Error upserting folder permissions:', error);
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
    console.error('Error fetching all file permissions:', error);
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
    console.error('Error upserting file permissions:', error);
    return null;
  }
  return data;
}

export async function getCustomFields(projectId: string): Promise<ProjectFileCustomField[]> {
  const { data, error } = await supabase
    .from('zhl_project_file_custom_fields')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at');

  if (error) {
    console.error('Error fetching custom fields:', error);
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
    console.error('Error creating custom field:', error);
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
    console.error('Error fetching custom field values:', error);
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
    console.error('Error upserting custom field value:', error);
    return null;
  }

  return data;
}

export async function getMonthlyDownloadLog(projectId: string, monthStartIso: string): Promise<ProjectFileDownloadLog[]> {
  const { data, error } = await supabase
    .from('zhl_project_file_download_logs')
    .select('*')
    .eq('project_id', projectId)
    .gte('created_at', monthStartIso)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching monthly download log:', error);
    return [];
  }

  return data ?? [];
}

export async function logDownloadAll(projectId: string, userId: string | null): Promise<ProjectFileDownloadLog | null> {
  const { data, error } = await supabase
    .from('zhl_project_file_download_logs')
    .insert({
      project_id: projectId,
      requested_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error('Error logging download-all request:', error);
    return null;
  }

  return data;
}

export async function getBackups(projectId: string): Promise<ProjectFileBackup[]> {
  const { data, error } = await supabase
    .from('zhl_project_file_backups')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching backups:', error);
    return [];
  }

  return data ?? [];
}

export async function getBackupRequests(projectId: string): Promise<ProjectFileBackupRequest[]> {
  const { data, error } = await supabase
    .from('zhl_project_file_backup_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching backup requests:', error);
    return [];
  }

  return data ?? [];
}

/** Admin: fetch all backup requests across all projects, joined with project name. */
export async function getAllBackupRequests(): Promise<(ProjectFileBackupRequest & { project_name: string })[]> {
  const { data, error } = await supabase
    .from('zhl_project_file_backup_requests')
    .select('*, projects(name)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching all backup requests:', error);
    return [];
  }

  return (data ?? []).map((r: ProjectFileBackupRequest & { projects: { name: string } | null }) => ({
    ...r,
    project_name: r.projects?.name ?? 'Unknown Project',
  }));
}

/** Admin: update the status of a backup request. */
export async function updateBackupRequestStatus(
  requestId: string,
  status: ProjectFileBackupRequest['status'],
  responseNote?: string
): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_project_file_backup_requests')
    .update({ status, response_note: responseNote ?? null, responded_at: new Date().toISOString() })
    .eq('id', requestId);

  if (error) {
    console.error('Error updating backup request status:', error);
    return false;
  }
  return true;
}

export async function createBackupRequest(projectId: string, userId: string | null, reason: string): Promise<ProjectFileBackupRequest | null> {
  const { data, error } = await supabase
    .from('zhl_project_file_backup_requests')
    .insert({
      project_id: projectId,
      requested_by: userId,
      reason,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating backup request:', error);
    return null;
  }

  return data;
}

// ── Storage operations ───────────────────────────────────────────────

const BUCKET = 'project-files';

export async function uploadFile(
  projectId: string,
  folderId: string | null,
  file: File,
  userId: string | null
): Promise<ProjectFileItem | null> {
  const ts = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = folderId
    ? `${projectId}/${folderId}/${ts}_${safeName}`
    : `${projectId}/${ts}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file);

  if (uploadError) {
    console.error('Error uploading file:', uploadError);
    return null;
  }

  const { data, error } = await supabase
    .from('zhl_project_files')
    .insert({
      project_id: projectId,
      folder_id: folderId,
      name: file.name,
      storage_path: storagePath,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error('Error inserting file metadata:', error);
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return null;
  }

  return data;
}

export async function downloadFileUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60);

  if (error) {
    console.error('Error creating signed URL:', error);
    return null;
  }

  return data.signedUrl;
}

export async function deleteFile(fileId: string): Promise<boolean> {
  const { data: file, error: fetchError } = await supabase
    .from('zhl_project_files')
    .select('storage_path')
    .eq('id', fileId)
    .maybeSingle();

  if (fetchError || !file) {
    console.error('Error fetching file for deletion:', fetchError);
    return false;
  }

  if (file.storage_path) {
    await supabase.storage.from(BUCKET).remove([file.storage_path]);
  }

  const { error } = await supabase.from('zhl_project_files').delete().eq('id', fileId);
  if (error) {
    console.error('Error deleting file metadata:', error);
    return false;
  }

  return true;
}

export async function deleteFolder(folderId: string): Promise<boolean> {
  const { data: filesInFolder } = await supabase
    .from('zhl_project_files')
    .select('storage_path')
    .eq('folder_id', folderId);

  if (filesInFolder && filesInFolder.length > 0) {
    const paths = filesInFolder.map((f) => f.storage_path).filter(Boolean) as string[];
    if (paths.length > 0) {
      await supabase.storage.from(BUCKET).remove(paths);
    }
  }

  const { error } = await supabase.from('zhl_project_file_folders').delete().eq('id', folderId);
  if (error) {
    console.error('Error deleting folder:', error);
    return false;
  }

  return true;
}

export async function renameFolder(folderId: string, newName: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_project_file_folders')
    .update({ name: newName })
    .eq('id', folderId);
  if (error) {
    console.error('Error renaming folder:', error);
    return false;
  }
  return true;
}

export async function renameFile(fileId: string, newName: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_project_files')
    .update({ name: newName })
    .eq('id', fileId);
  if (error) {
    console.error('Error renaming file:', error);
    return false;
  }
  return true;
}

/** Get a map of storagePath -> linked target info for all linked files/folders in a project. */
export async function getLinkedUnitDataMap(projectId: string): Promise<Map<string, { type: 'field' | 'category'; name: string; parentName?: string }>> {
  const map = new Map<string, { type: 'field' | 'category'; name: string; parentName?: string }>();

  const [{ data: fields }, { data: cats }] = await Promise.all([
    supabase
      .from('zhl_unit_data_fields')
      .select('name, linked_file_path, unit_data_categories(name)')
      .eq('project_id', projectId)
      .not('linked_file_path', 'is', null),
    supabase
      .from('zhl_unit_data_categories')
      .select('name, linked_file_path')
      .eq('project_id', projectId)
      .not('linked_file_path', 'is', null),
  ]);

  if (fields) {
    for (const f of fields as unknown as Array<{ name: string; linked_file_path: string; unit_data_categories: { name: string } | null }>) {
      map.set(f.linked_file_path, { type: 'field', name: f.name, parentName: f.unit_data_categories?.name ?? undefined });
    }
  }
  if (cats) {
    for (const c of cats as Array<{ name: string; linked_file_path: string }>) {
      map.set(c.linked_file_path, { type: 'category', name: c.name });
    }
  }

  return map;
}

/** Link a file/folder to a unit data field or category. */
export async function linkFileToUnitData(
  targetType: 'field' | 'category',
  targetId: string,
  fileName: string,
  storagePath: string
): Promise<boolean> {
  const table = targetType === 'field' ? 'unit_data_fields' : 'unit_data_categories';
  const { error } = await supabase
    .from(table)
    .update({ linked_file_name: fileName, linked_file_path: storagePath })
    .eq('id', targetId);
  if (error) {
    console.error(`Error linking file to ${targetType}:`, error.message);
    return false;
  }
  return true;
}
