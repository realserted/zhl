// ─── Google Drive Item (replaces ProjectFileFolder + ProjectFileItem) ────────

export interface DriveItem {
  /** Google Drive file/folder ID */
  id: string;
  /** Parent folder's Google Drive ID (null = root folder) */
  parentId: string | null;
  name: string;
  mimeType: string | null;
  /** File size in bytes (null for folders) */
  size: number | null;
  isFolder: boolean;
  /** Google Drive view link */
  webViewLink: string | null;
  /** Google Drive download link */
  webContentLink: string | null;
  /** Last modified time from Drive */
  modifiedTime: string | null;
  /** Drive icon URL */
  iconLink: string | null;
  /** Thumbnail URL for image preview */
  thumbnailLink: string | null;
}

// ─── File Tree Node (for lazy-loading tree view) ─────────────────────────────

export interface FileTreeNode {
  item: DriveItem;
  children: FileTreeNode[];
  isLoaded: boolean;
  isExpanded: boolean;
}

// ─── Project Drive Configuration ────────────────────────────────────────────

export interface ProjectDriveConfig {
  id: string;
  project_id: string;
  /** Google Drive folder ID (extracted from URL) */
  root_folder_id: string;
  /** Original pasted Google Drive URL */
  root_folder_url: string;
  /** @deprecated No longer needed — Drive API is called directly */
  apps_script_url: string | null;
  /** @deprecated No longer needed */
  apps_script_api_key: string | null;
  /** Cached ARCHIVE folder ID in Drive */
  archive_folder_id: string | null;
  configured_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Google Token Status ────────────────────────────────────────────────────

export interface GoogleTokenStatus {
  connected: boolean;
  google_email: string | null;
}

// ─── Permissions (unchanged — these are ZHL UI-only visibility controls) ────

export interface ProjectFileFolderPermissions {
  id: string;
  project_id: string;
  /** References a Google Drive folder ID */
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
  /** References a Google Drive file ID */
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

// ─── Custom Fields (unchanged) ──────────────────────────────────────────────

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
