import { supabase } from '../supabase';
import { UnitDataView, ViewName } from '../types/unit-data';

/** Get a specific view config. For personal views pass userId. */
export async function getView(
  projectId: string,
  viewName: ViewName,
  userId?: string,
): Promise<UnitDataView | null> {
  let query = supabase
    .from('unit_data_views')
    .select('*')
    .eq('project_id', projectId)
    .eq('view_name', viewName);

  if (viewName === 'Personal View' && userId) {
    query = query.eq('user_id', userId);
  } else {
    query = query.is('user_id', null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('Error fetching view:', error.message);
    return null;
  }
  return data as UnitDataView | null;
}

/** Get all project-level views (user_id IS NULL). */
export async function getProjectViews(projectId: string): Promise<UnitDataView[]> {
  const { data, error } = await supabase
    .from('unit_data_views')
    .select('*')
    .eq('project_id', projectId)
    .is('user_id', null)
    .order('view_name');

  if (error) {
    console.error('Error fetching project views:', error.message);
    return [];
  }
  return (data ?? []) as UnitDataView[];
}

/** Save (upsert) a view configuration. */
export async function saveView(
  projectId: string,
  viewName: ViewName,
  fieldVisibility: Record<string, boolean>,
  userId?: string,
): Promise<boolean> {
  const payload = {
    project_id: projectId,
    view_name: viewName,
    user_id: viewName === 'Personal View' && userId ? userId : null,
    field_visibility: fieldVisibility,
  };

  const { error } = await supabase
    .from('unit_data_views')
    .upsert(payload, { onConflict: 'project_id,view_name,user_id' });

  if (error) {
    console.error('Error saving view:', error.message);
    return false;
  }
  return true;
}
