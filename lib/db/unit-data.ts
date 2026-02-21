import { supabase } from '../supabase';
import {
  UnitDataCategory,
  UnitDataField,
  UnitDataRow,
  UnitDataValue,
  CategoryWithFields,
} from '../types/unit-data';

// ── Categories + Fields ──

export async function getCategories(projectId: string): Promise<CategoryWithFields[]> {
  const { data: cats } = await supabase
    .from('unit_data_categories')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order');

  if (!cats || cats.length === 0) return [];

  const { data: fields } = await supabase
    .from('unit_data_fields')
    .select('*')
    .eq('project_id', projectId)
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
    .from('unit_data_categories')
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
    .from('unit_data_fields')
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

export async function deleteCategory(categoryId: string): Promise<boolean> {
  const { error } = await supabase.from('unit_data_categories').delete().eq('id', categoryId);
  if (error) { console.error('Error deleting category:', error.message, error.code, error.details); return false; }
  return true;
}

export async function updateFieldVisibility(fieldId: string, visible: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('unit_data_fields')
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
    .from('unit_data_rows')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order');
  if (error) { console.error('Error fetching rows:', error.message, error.code, error.details); return []; }
  return data ?? [];
}

export async function createRow(projectId: string, sortOrder: number): Promise<UnitDataRow | null> {
  const { data, error } = await supabase
    .from('unit_data_rows')
    .insert({ project_id: projectId, sort_order: sortOrder })
    .select()
    .single();
  if (error) { console.error('Error creating row:', error.message, error.code, error.details); return null; }
  return data;
}

export async function deleteRow(rowId: string): Promise<boolean> {
  const { error } = await supabase.from('unit_data_rows').delete().eq('id', rowId);
  if (error) { console.error('Error deleting row:', error.message, error.code, error.details); return false; }
  return true;
}

// ── Values ──

export async function getValues(projectId: string): Promise<UnitDataValue[]> {
  // Get all row IDs for this project, then fetch values
  const { data: rows } = await supabase
    .from('unit_data_rows')
    .select('id')
    .eq('project_id', projectId);

  if (!rows || rows.length === 0) return [];

  const rowIds = rows.map((r: { id: string }) => r.id);
  const { data, error } = await supabase
    .from('unit_data_values')
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
    .from('unit_data_values')
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
