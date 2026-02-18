import { supabase } from '../supabase';

/**
 * Log a user action to the user_logs table.
 * This is a fire-and-forget helper — errors are logged but don't block the caller.
 */
export async function logUserAction(params: {
  projectId: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: string;
}) {
  const { error } = await supabase.from('user_logs').insert({
    project_id: params.projectId,
    user_id: params.userId,
    user_name: params.userName,
    user_email: params.userEmail,
    action: params.action,
  });

  if (error) {
    console.error('Error logging user action:', error);
  }
}
