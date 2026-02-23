import { supabase } from '@/lib/supabase/client';
import { Project, ProjectPermission } from '@/lib/types/project';

// Get all projects for current user (owned or member)
export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching projects:', error);
    return [];
  }
  return data ?? [];
}

// Create a new project
export async function createProject(name: string, ownerId: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .insert([{ name, owner_id: ownerId }])
    .select()
    .single();

  if (error) {
    console.error('Error creating project:', error);
    return null;
  }
  return data;
}

// Get permissions for a project
export async function getProjectPermissions(projectId: string): Promise<ProjectPermission[]> {
  const { data, error } = await supabase
    .from('project_permissions')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching permissions:', error);
    return [];
  }
  return data ?? [];
}

// Add a user to a project (looks up user_id by email so RLS works immediately)
export async function addProjectUser(
  projectId: string,
  userName: string,
  userEmail: string
): Promise<ProjectPermission | null> {
  // Look up the user's user_id via SECURITY DEFINER function (bypasses accounts RLS)
  let userId: string | null = null;
  if (userEmail) {
    const { data: uid } = await supabase.rpc('lookup_user_id_by_email', { p_email: userEmail.trim() });
    userId = uid ?? null;
  }

  const { data, error } = await supabase
    .from('project_permissions')
    .insert([{ project_id: projectId, user_id: userId, user_name: userName, user_email: userEmail }])
    .select()
    .single();

  if (error) {
    console.error('Error adding user:', error);
    return null;
  }
  return data;
}

// Update a single permission field
export async function updatePermission(
  permissionId: string,
  field: string,
  value: string
): Promise<boolean> {
  const { error } = await supabase
    .from('project_permissions')
    .update({ [field]: value })
    .eq('id', permissionId);

  if (error) {
    console.error('Error updating permission:', error);
    return false;
  }
  return true;
}

// Delete a project (CASCADE will remove permissions, unit data, files, etc.)
export async function deleteProject(projectId: string): Promise<boolean> {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId);

  if (error) {
    console.error('Error deleting project:', error);
    return false;
  }
  return true;
}

// Delete a user from a project
export async function removeProjectUser(permissionId: string): Promise<boolean> {
  const { error } = await supabase
    .from('project_permissions')
    .delete()
    .eq('id', permissionId);

  if (error) {
    console.error('Error removing user:', error);
    return false;
  }
  return true;
}
