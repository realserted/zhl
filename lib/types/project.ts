export interface Project {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface ProjectPermission {
  id: string;
  project_id: string;
  user_id: string | null;
  user_name: string;
  user_email: string;
  perm_taskers: string;
  perm_unit_data: string;
  perm_files: string;
  perm_accounts: string;
  perm_reports: string;
  perm_templates: string;
  perm_meetings: string;
  perm_user_logs: string;
  project_role: string;
  work_role: string;
  created_at: string;
  updated_at: string;
}
