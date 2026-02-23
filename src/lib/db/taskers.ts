import { supabase } from '@/lib/supabase/client';
import { Tasker, TaskerLog } from '@/lib/types/tasker';

// Get all taskers for a project
export async function getTaskers(projectId: string): Promise<Tasker[]> {
  const { data, error } = await supabase
    .from('taskers')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching taskers:', error);
    return [];
  }
  return data ?? [];
}

// Create a new tasker
export async function createTasker(
  tasker: Omit<Tasker, 'id' | 'created_at' | 'updated_at'>
): Promise<Tasker | null> {
  const { data, error } = await supabase
    .from('taskers')
    .insert([tasker])
    .select()
    .single();

  if (error) {
    console.error('Error creating tasker:', error);
    return null;
  }
  return data;
}

// Update a tasker field
export async function updateTasker(
  taskerId: string,
  updates: Partial<Tasker>
): Promise<boolean> {
  const { error } = await supabase
    .from('taskers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', taskerId);

  if (error) {
    console.error('Error updating tasker:', error);
    return false;
  }
  return true;
}

// Delete a tasker
export async function deleteTasker(taskerId: string): Promise<boolean> {
  const { error } = await supabase
    .from('taskers')
    .delete()
    .eq('id', taskerId);

  if (error) {
    console.error('Error deleting tasker:', error);
    return false;
  }
  return true;
}

// Get logs for a tasker
export async function getTaskerLogs(taskerId: string): Promise<TaskerLog[]> {
  const { data, error } = await supabase
    .from('tasker_logs')
    .select('*')
    .eq('tasker_id', taskerId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching tasker logs:', error);
    return [];
  }
  return data ?? [];
}

// Add a log entry (comment or change)
export async function addTaskerLog(
  log: Omit<TaskerLog, 'id' | 'created_at'>
): Promise<TaskerLog | null> {
  const { data, error } = await supabase
    .from('tasker_logs')
    .insert([log])
    .select()
    .single();

  if (error) {
    console.error('Error adding tasker log:', error);
    return null;
  }
  return data;
}
