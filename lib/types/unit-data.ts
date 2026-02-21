export interface UnitDataCategory {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface UnitDataField {
  id: string;
  category_id: string;
  project_id: string;
  name: string;
  field_type: 'text' | 'number' | 'date';
  tooltip: string | null;
  is_file_link: boolean;
  is_hyperlink: boolean;
  visible: boolean;
  sort_order: number;
  created_at: string;
}

export interface UnitDataRow {
  id: string;
  project_id: string;
  sort_order: number;
  created_at: string;
}

export interface UnitDataValue {
  id: string;
  row_id: string;
  field_id: string;
  value: string | null;
  file_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryWithFields extends UnitDataCategory {
  fields: UnitDataField[];
}

export type ViewName = 'ALL FIELDS' | 'All Project Users' | 'PM View' | 'Personal View';

export interface UnitDataView {
  id: string;
  project_id: string;
  view_name: ViewName;
  user_id: string | null;
  field_visibility: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}
