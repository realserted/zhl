export interface Tasker {
  id: string;
  project_id: string;
  status: 'Archived' | 'Complete' | 'In Progress' | 'Open';
  task_name: string;
  description: string | null;
  update_status: string | null;
  responsible: string | null;
  responsible_name: string | null;
  cc: string | null;
  cc_name: string | null;
  got_the_ball: string | null;
  got_the_ball_name: string | null;
  priority: number;
  due_date: string | null;
  original_due_date: string | null;
  help_request_user: string | null;
  help_request_user_name: string | null;
  issues: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TaskerLog {
  id: string;
  tasker_id: string;
  user_id: string;
  user_name: string;
  type: 'comment' | 'change';
  message: string;
  created_at: string;
}
