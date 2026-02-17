import { supabase } from '../supabase';

export async function logUserAction(
  projectId: string,
  userId: string,
  userName: string,
  userEmail: string,
  action: string
) {
  try {
    await supabase.from('user_logs').insert({
      project_id: projectId,
      user_id: userId,
      user_name: userName,
      user_email: userEmail,
      action,
    });
  } catch (error) {
    console.error('Error logging user action:', error);
    // Don't throw - logging failures shouldn't break the app
  }
}
