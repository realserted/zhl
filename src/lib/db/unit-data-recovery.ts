import { supabase } from '@/lib/supabase/client';

export interface UnitDataRecoveryRequest {
  id: string;
  project_id: string;
  requested_by: string;
  requester_name: string;
  item_type: 'field' | 'category';
  item_id: string;
  item_name: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export async function createRecoveryRequest(
  projectId: string,
  requestedBy: string,
  requesterName: string,
  itemType: 'field' | 'category',
  itemId: string,
  itemName: string
): Promise<boolean> {
  const { error } = await supabase
    .from('unit_data_recovery_requests')
    .insert({ project_id: projectId, requested_by: requestedBy, requester_name: requesterName, item_type: itemType, item_id: itemId, item_name: itemName });
  if (error) { console.error('Error creating recovery request:', error.message); return false; }
  return true;
}

export async function getRecoveryRequests(projectId?: string): Promise<UnitDataRecoveryRequest[]> {
  let query = supabase
    .from('unit_data_recovery_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (projectId) query = query.eq('project_id', projectId);
  const { data } = await query;
  return (data as UnitDataRecoveryRequest[]) ?? [];
}

export async function resolveRecoveryRequest(
  requestId: string,
  status: 'approved' | 'rejected',
  resolvedBy: string
): Promise<boolean> {
  const { error } = await supabase
    .from('unit_data_recovery_requests')
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
    .eq('id', requestId);
  if (error) { console.error('Error resolving recovery request:', error.message); return false; }
  return true;
}
