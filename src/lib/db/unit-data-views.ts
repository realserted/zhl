import { supabase } from '@/lib/supabase/client';
import { UnitDataView, ViewName } from '@/lib/types/unit-data';

/** Get a specific view config. For personal views pass userId. */
export async function getView(
  projectId: string,
  viewName: ViewName,
  userId?: string,
): Promise<UnitDataView | null> {
  let query = supabase
    .from('zhl_unit_data_views')
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
    .from('zhl_unit_data_views')
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
  fieldOrder?: string[] | null,
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    project_id: projectId,
    view_name: viewName,
    user_id: viewName === 'Personal View' && userId ? userId : null,
    field_visibility: fieldVisibility,
  };
  if (fieldOrder !== undefined) {
    payload.field_order = fieldOrder;
  }

  const { error } = await supabase
    .from('zhl_unit_data_views')
    .upsert(payload, { onConflict: 'project_id,view_name,user_id' });

  if (error) {
    console.error('Error saving view:', error.message);
    return false;
  }
  return true;
}

/** Save only field_order to the user's Personal View (upsert). */
export async function saveFieldOrder(
  projectId: string,
  userId: string,
  fieldOrder: string[],
): Promise<boolean> {
  // Try to update existing Personal View first
  const { data, error: updateError } = await supabase
    .from('zhl_unit_data_views')
    .update({ field_order: fieldOrder })
    .eq('project_id', projectId)
    .eq('view_name', 'Personal View')
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('Error updating field order:', updateError.message);
    return false;
  }

  // If no existing row, insert a new Personal View with all fields visible (empty object = show all)
  if (!data) {
    const { error: insertError } = await supabase
      .from('zhl_unit_data_views')
      .insert({
        project_id: projectId,
        view_name: 'Personal View',
        user_id: userId,
        field_visibility: {},
        field_order: fieldOrder,
      });

    if (insertError) {
      console.error('Error inserting field order:', insertError.message);
      return false;
    }
  }

  return true;
}
