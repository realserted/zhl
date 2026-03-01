import { supabase } from '@/lib/supabase/client';
import { ProjectAccount } from '@/lib/types/project-account';

export async function getProjectAccounts(projectId: string): Promise<ProjectAccount[]> {
  const { data, error } = await supabase
    .from('zhl_project_accounts')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching project accounts:', error.message, error.code);
    return [];
  }
  return data ?? [];
}

export async function createProjectAccount(
  projectId: string,
  createdBy: string
): Promise<ProjectAccount | null> {
  const { data, error } = await supabase
    .from('zhl_project_accounts')
    .insert([{ project_id: projectId, created_by: createdBy }])
    .select()
    .single();

  if (error) {
    console.error('Error creating project account:', error.message, error.code);
    return null;
  }
  return data;
}

export async function updateProjectAccount(
  accountId: string,
  field: string,
  value: string | null
): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_project_accounts')
    .update({ [field]: value })
    .eq('id', accountId);

  if (error) {
    console.error('Error updating project account:', error.message, error.code);
    return false;
  }
  return true;
}

export async function deleteProjectAccount(accountId: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_project_accounts')
    .delete()
    .eq('id', accountId);

  if (error) {
    console.error('Error deleting project account:', error.message, error.code);
    return false;
  }
  return true;
}
