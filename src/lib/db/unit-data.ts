import { supabase } from '@/lib/supabase/client';
import {
  UnitDataCategory,
  UnitDataField,
  UnitDataRow,
  UnitDataValue,
  CategoryWithFields,
} from '@/lib/types/unit-data';

// ── Categories + Fields ──

export async function getCategories(projectId: string): Promise<CategoryWithFields[]> {
  const { data: cats } = await supabase
    .from('zhl_unit_data_categories')
    .select('*')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('sort_order');

  if (!cats || cats.length === 0) return [];

  const { data: fields } = await supabase
    .from('zhl_unit_data_fields')
    .select('*')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('sort_order');

  const fieldMap = new Map<string, UnitDataField[]>();
  (fields ?? []).forEach((f: UnitDataField) => {
    if (!fieldMap.has(f.category_id)) fieldMap.set(f.category_id, []);
    fieldMap.get(f.category_id)!.push(f);
  });

  return cats.map((c: UnitDataCategory) => ({
    ...c,
    fields: fieldMap.get(c.id) ?? [],
  }));
}

export async function createCategory(projectId: string, name: string, sortOrder: number): Promise<UnitDataCategory | null> {
  const { data, error } = await supabase
    .from('zhl_unit_data_categories')
    .insert({ project_id: projectId, name, sort_order: sortOrder })
    .select()
    .single();
  if (error) { console.error('Error creating category:', error.message, error.code, error.details); return null; }
  return data;
}

export async function createField(
  categoryId: string,
  projectId: string,
  name: string,
  fieldType: string = 'text',
  tooltip: string | null = null,
  isFileLink: boolean = false,
  isHyperlink: boolean = false,
  sortOrder: number = 0
): Promise<UnitDataField | null> {
  const { data, error } = await supabase
    .from('zhl_unit_data_fields')
    .insert({
      category_id: categoryId,
      project_id: projectId,
      name,
      field_type: fieldType,
      tooltip,
      is_file_link: isFileLink,
      is_hyperlink: isHyperlink,
      sort_order: sortOrder,
    })
    .select()
    .single();
  if (error) { console.error('Error creating field:', error.message, error.code, error.details); return null; }
  return data;
}

export async function updateCategory(categoryId: string, name: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_unit_data_categories')
    .update({ name })
    .eq('id', categoryId);
  if (error) { console.error('Error updating category:', error.message, error.code, error.details); return false; }
  return true;
}

export async function updateField(
  fieldId: string,
  updates: { name?: string; tooltip?: string | null; is_file_link?: boolean; is_hyperlink?: boolean; show_sum?: boolean }
): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_unit_data_fields')
    .update(updates)
    .eq('id', fieldId);
  if (error) { console.error('Error updating field:', error.message, error.code, error.details); return false; }
  return true;
}

export async function deleteField(fieldId: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_unit_data_fields').delete().eq('id', fieldId);
  if (error) { console.error('Error deleting field:', error.message, error.code, error.details); return false; }
  return true;
}

export async function deleteCategory(categoryId: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_unit_data_categories').delete().eq('id', categoryId);
  if (error) { console.error('Error deleting category:', error.message, error.code, error.details); return false; }
  return true;
}

// ── Soft delete / restore ──

export async function softDeleteCategory(categoryId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_unit_data_categories')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', categoryId);
  if (error) { console.error('Error soft deleting category:', error.message); return false; }
  return true;
}

export async function softDeleteField(fieldId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_unit_data_fields')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', fieldId);
  if (error) { console.error('Error soft deleting field:', error.message); return false; }
  return true;
}

export async function restoreCategory(categoryId: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_unit_data_categories')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', categoryId);
  if (error) { console.error('Error restoring category:', error.message); return false; }
  return true;
}

export async function restoreField(fieldId: string): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_unit_data_fields')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', fieldId);
  if (error) { console.error('Error restoring field:', error.message); return false; }
  return true;
}

export interface DeletedItem {
  id: string;
  name: string;
  type: 'field' | 'category';
  deleted_at: string;
  parent_name?: string; // for fields: the category name (including deleted categories)
}

export async function getDeletedItems(projectId: string): Promise<DeletedItem[]> {
  const [{ data: cats }, { data: fields }, { data: allCats }] = await Promise.all([
    supabase.from('zhl_unit_data_categories').select('id, name, deleted_at').eq('project_id', projectId).not('deleted_at', 'is', null),
    supabase.from('zhl_unit_data_fields').select('id, name, deleted_at, category_id').eq('project_id', projectId).not('deleted_at', 'is', null),
    supabase.from('zhl_unit_data_categories').select('id, name').eq('project_id', projectId),
  ]);

  const catNameMap = new Map<string, string>((allCats ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));

  const deletedCats: DeletedItem[] = (cats ?? []).map((c: { id: string; name: string; deleted_at: string }) => ({
    id: c.id, name: c.name, type: 'category' as const, deleted_at: c.deleted_at,
  }));

  const deletedFields: DeletedItem[] = (fields ?? []).map((f: { id: string; name: string; deleted_at: string; category_id: string }) => ({
    id: f.id, name: f.name, type: 'field' as const, deleted_at: f.deleted_at,
    parent_name: catNameMap.get(f.category_id),
  }));

  return [...deletedCats, ...deletedFields].sort((a, b) =>
    new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime()
  );
}

export async function permanentDeleteField(fieldId: string): Promise<boolean> {
  // Delete all values for this field first
  await supabase.from('zhl_unit_data_values').delete().eq('field_id', fieldId);
  const { error } = await supabase.from('zhl_unit_data_fields').delete().eq('id', fieldId);
  if (error) { console.error('Error permanently deleting field:', error.message); return false; }
  return true;
}

export async function permanentDeleteCategory(categoryId: string): Promise<boolean> {
  // Get all fields in this category
  const { data: fields } = await supabase.from('zhl_unit_data_fields').select('id').eq('category_id', categoryId);
  // Delete all values for those fields
  if (fields && fields.length > 0) {
    const fieldIds = fields.map((f: { id: string }) => f.id);
    await supabase.from('zhl_unit_data_values').delete().in('field_id', fieldIds);
  }
  // Delete the fields
  await supabase.from('zhl_unit_data_fields').delete().eq('category_id', categoryId);
  // Delete the category
  const { error } = await supabase.from('zhl_unit_data_categories').delete().eq('id', categoryId);
  if (error) { console.error('Error permanently deleting category:', error.message); return false; }
  return true;
}

export async function updateFieldVisibility(fieldId: string, visible: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_unit_data_fields')
    .update({ visible })
    .eq('id', fieldId);
  if (error) { console.error('Error updating field visibility:', error.message, error.code, error.details); return false; }
  return true;
}

/** Build a { fieldId: boolean } map from current categories state. */
export function getCurrentFieldVisibility(categories: CategoryWithFields[]): Record<string, boolean> {
  const vis: Record<string, boolean> = {};
  for (const cat of categories) {
    for (const f of cat.fields) {
      vis[f.id] = f.visible;
    }
  }
  return vis;
}

// ── Rows ──

export async function getRows(projectId: string): Promise<UnitDataRow[]> {
  const { data, error } = await supabase
    .from('zhl_unit_data_rows')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order');
  if (error) { console.error('Error fetching rows:', error.message, error.code, error.details); return []; }
  return data ?? [];
}

/** Delete orphaned empty rows and re-sort remaining rows to 0, 1, 2, ...
 *  Rows with more distinct field values (across more categories) are sorted first. */
export async function cleanupAndResortRows(projectId: string): Promise<void> {
  const { data: allRows } = await supabase
    .from('zhl_unit_data_rows')
    .select('id, sort_order, created_at')
    .eq('project_id', projectId)
    .order('sort_order');
  if (!allRows || allRows.length === 0) return;

  // Get all values with their field_id to identify which rows have data and from how many categories
  const { data: vals } = await supabase
    .from('zhl_unit_data_values')
    .select('row_id, field_id, value')
    .in('row_id', allRows.map((r) => r.id));

  // Get field → category mapping
  const { data: fields } = await supabase
    .from('zhl_unit_data_fields')
    .select('id, category_id')
    .eq('project_id', projectId);
  const fieldCategoryMap = new Map<string, string>();
  for (const f of (fields ?? [])) fieldCategoryMap.set(f.id, f.category_id);

  const rowHasValues = new Set<string>();
  const rowCategoryCount = new Map<string, number>();
  for (const v of (vals ?? [])) {
    if (v.value != null && String(v.value).trim() !== '') {
      rowHasValues.add(v.row_id);
      // Track distinct categories per row
      const catId = fieldCategoryMap.get(v.field_id);
      if (catId) {
        const key = `${v.row_id}::${catId}`;
        if (!rowCategoryCount.has(key)) {
          rowCategoryCount.set(key, 1);
        }
      }
    }
  }
  // Count distinct categories per row
  const rowDistinctCats = new Map<string, number>();
  for (const key of rowCategoryCount.keys()) {
    const rowId = key.split('::')[0];
    rowDistinctCats.set(rowId, (rowDistinctCats.get(rowId) ?? 0) + 1);
  }

  // Delete empty rows (no values at all)
  const emptyRows = allRows.filter((r) => !rowHasValues.has(r.id));
  if (emptyRows.length > 0) {
    await supabase.from('zhl_unit_data_rows').delete().in('id', emptyRows.map((r) => r.id));
  }

  // Sort remaining rows: rows with data in MORE categories come first (old data rows)
  // Tiebreaker: older created_at first, then original sort_order
  const keepRows = allRows
    .filter((r) => rowHasValues.has(r.id))
    .sort((a, b) => {
      const catDiff = (rowDistinctCats.get(b.id) ?? 0) - (rowDistinctCats.get(a.id) ?? 0);
      if (catDiff !== 0) return catDiff;
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.sort_order - b.sort_order;
    });

  // First pass: offset all sort_orders to temp values to avoid unique constraint conflicts
  for (let i = 0; i < keepRows.length; i++) {
    await supabase.from('zhl_unit_data_rows').update({ sort_order: 100000 + i }).eq('id', keepRows[i].id);
  }
  // Second pass: assign final sequential sort_orders
  for (let i = 0; i < keepRows.length; i++) {
    await supabase.from('zhl_unit_data_rows').update({ sort_order: i }).eq('id', keepRows[i].id);
  }
}

export async function createRow(projectId: string, sortOrder: number): Promise<UnitDataRow | null> {
  const { data, error } = await supabase
    .from('zhl_unit_data_rows')
    .insert({ project_id: projectId, sort_order: sortOrder })
    .select()
    .single();
  if (error) { console.error('Error creating row:', error.message, error.code, error.details); return null; }
  return data;
}

export async function deleteRow(rowId: string): Promise<boolean> {
  const { error } = await supabase.from('zhl_unit_data_rows').delete().eq('id', rowId);
  if (error) { console.error('Error deleting row:', error.message, error.code, error.details); return false; }
  return true;
}

// ── Values ──

export async function getValues(projectId: string): Promise<UnitDataValue[]> {
  // Get all row IDs for this project, then fetch values
  const { data: rows } = await supabase
    .from('zhl_unit_data_rows')
    .select('id')
    .eq('project_id', projectId);

  if (!rows || rows.length === 0) return [];

  const rowIds = rows.map((r: { id: string }) => r.id);
  const { data, error } = await supabase
    .from('zhl_unit_data_values')
    .select('*')
    .in('row_id', rowIds);

  if (error) { console.error('Error fetching values:', error.message, error.code, error.details); return []; }
  return data ?? [];
}

export async function upsertValue(
  rowId: string,
  fieldId: string,
  value: string | null,
  fileUrl: string | null = null
): Promise<boolean> {
  const { error } = await supabase
    .from('zhl_unit_data_values')
    .upsert(
      { row_id: rowId, field_id: fieldId, value, file_url: fileUrl },
      { onConflict: 'row_id,field_id' }
    );
  if (error) { console.error('Error upserting value:', error.message, error.code, error.details); return false; }
  return true;
}

// ── Seed default schema ──

const DEFAULT_SCHEMA = [
  {
    name: 'Property Info',
    fields: ['Address', 'Property ID', 'Unit ID', "Seller's Unit ID", 'Property Type'],
  },
  {
    name: 'Rent Info',
    fields: ['Current Rent Rate', 'Next Rent Rate', 'Tenant Payment', 'Section 8 Pmt'],
  },
];

export async function seedDefaultSchema(projectId: string): Promise<CategoryWithFields[]> {
  const result: CategoryWithFields[] = [];

  for (let ci = 0; ci < DEFAULT_SCHEMA.length; ci++) {
    const catDef = DEFAULT_SCHEMA[ci];
    const cat = await createCategory(projectId, catDef.name, ci);
    if (!cat) continue;

    const fields: UnitDataField[] = [];
    for (let fi = 0; fi < catDef.fields.length; fi++) {
      const field = await createField(cat.id, projectId, catDef.fields[fi], 'text', null, false, false, fi);
      if (field) fields.push(field);
    }

    result.push({ ...cat, fields });
  }

  return result;
}
