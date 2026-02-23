import { supabase } from '@/lib/supabase/client';

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
  if (!params.projectId || !params.userId || !params.action?.trim()) {
    return;
  }

  const { error } = await supabase.from('user_logs').insert({
    project_id: params.projectId,
    user_id: params.userId,
    user_name: params.userName,
    user_email: params.userEmail,
    action: params.action,
  });

  if (error) {
    const pieces = [error.code, error.message, error.details, error.hint]
      .filter(Boolean)
      .map((p) => String(p));
    const summary = pieces.join(' | ');
    const expectedPermissionIssue =
      error.code === '42501' ||
      /permission denied|row-level security|forbidden|not allowed/i.test(summary);
    if (expectedPermissionIssue) return;
    console.warn('User action log skipped:', summary || 'Unknown logging error');
  }
}
