import { supabase } from '@/lib/supabase/client';

export interface ProjectSettings {
  id: string;
  project_id: string;
  // Status thresholds
  threshold_tw_comments_critical:    number;
  threshold_tw_comments_problematic: number;
  threshold_tw_comments_good:        number;
  threshold_overdue_critical:        number;
  threshold_overdue_problematic:     number;
  threshold_overdue_good:            number;
  threshold_unit_data_critical:      number;
  threshold_unit_data_problematic:   number;
  threshold_unit_data_good:          number;
  // Feature flags
  allow_user_customization: boolean;
}

export type ProjectSettingsUpdate = Partial<Omit<ProjectSettings, 'id' | 'project_id'>>;

/** Default values — returned when no row exists yet */
export const DEFAULT_PROJECT_SETTINGS: Omit<ProjectSettings, 'id' | 'project_id'> = {
  threshold_tw_comments_critical:    5,
  threshold_tw_comments_problematic: 3,
  threshold_tw_comments_good:        1,
  threshold_overdue_critical:        5,
  threshold_overdue_problematic:     3,
  threshold_overdue_good:            1,
  threshold_unit_data_critical:      70,
  threshold_unit_data_problematic:   80,
  threshold_unit_data_good:          95,
  allow_user_customization:          false,
};

export async function getProjectSettings(projectId: string): Promise<ProjectSettings> {
  const { data } = await supabase
    .from('project_settings')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  if (!data) {
    // No row yet — return defaults with a placeholder id
    return { id: '', project_id: projectId, ...DEFAULT_PROJECT_SETTINGS };
  }
  return data as ProjectSettings;
}

/** Upsert one or more fields for the project's settings row. */
export async function saveProjectSettings(
  projectId: string,
  updates: ProjectSettingsUpdate
): Promise<boolean> {
  const { error } = await supabase
    .from('project_settings')
    .upsert({ project_id: projectId, ...updates }, { onConflict: 'project_id' });

  if (error) {
    console.error('Error saving project settings:', error.message);
    return false;
  }
  return true;
}
