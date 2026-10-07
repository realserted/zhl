export interface ProjectFileFolder {
  id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
}

export interface ProjectFileItem {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface ProjectFileFolderPermissions {
  id: string;
  project_id: string;
  folder_id: string;
  allow_all_users: boolean;
  allow_project_manager: boolean;
  allow_property_manager: boolean;
  allow_accountant: boolean;
  allow_anyone_with_link: boolean;
  link_enabled: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFileItemPermissions {
  id: string;
  project_id: string;
  file_id: string;
  allow_all_users: boolean;
  allow_project_manager: boolean;
  allow_property_manager: boolean;
  allow_accountant: boolean;
  allow_anyone_with_link: boolean;
  link_enabled: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFileCustomField {
  id: string;
  project_id: string;
  name: string;
  target_type: 'folder' | 'file';
  warning_message: string | null;
  ignore_warning_days: number | null;
  required: boolean;
  created_by: string | null;
  created_at: string;
}

export interface ProjectFileCustomFieldValue {
  id: string;
  custom_field_id: string;
  folder_id: string | null;
  file_id: string | null;
  value_text: string | null;
  ignored_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFileDownloadLog {
  id: string;
  project_id: string;
  requested_by: string | null;
  created_at: string;
}

export interface ProjectFileBackup {
  id: string;
  project_id: string;
  backup_type: 'system' | 'manual';
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ProjectFileBackupRequest {
  id: string;
  project_id: string;
  requested_by: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  response_note: string | null;
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}
