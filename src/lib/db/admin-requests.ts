import { supabase } from '@/lib/supabase/client';

export interface AdminRequest {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  message: string;
  status: string;
  created_at: string;
}

export async function getAdminRequests(): Promise<AdminRequest[]> {
  const { data } = await supabase
    .from('admin_requests')
    .select('*')
    .order('created_at', { ascending: false });
  return (data as AdminRequest[]) ?? [];
}

export async function submitAdminRequest(
  userId: string,
  userName: string,
  userEmail: string,
  message: string
): Promise<boolean> {
  const { error } = await supabase
    .from('admin_requests')
    .insert({ user_id: userId, user_name: userName, user_email: userEmail, message });
  if (error) { console.error('Error submitting request:', error.message); return false; }
  return true;
}

export async function resolveAdminRequest(requestId: string): Promise<boolean> {
  const { error } = await supabase
    .from('admin_requests')
    .update({ status: 'resolved' })
    .eq('id', requestId);
  if (error) { console.error('Error resolving request:', error.message); return false; }
  return true;
}

export async function deleteAdminRequest(requestId: string): Promise<boolean> {
  const { error } = await supabase
    .from('admin_requests')
    .delete()
    .eq('id', requestId);
  if (error) { console.error('Error deleting request:', error.message); return false; }
  return true;
}
