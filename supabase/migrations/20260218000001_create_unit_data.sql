-- Unit Data: dynamic spreadsheet-like data organized by categories and fields

-- Categories (column groups)
CREATE TABLE IF NOT EXISTS public.unit_data_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ud_categories_project ON public.unit_data_categories(project_id);

-- Fields (columns within a category)
CREATE TABLE IF NOT EXISTS public.unit_data_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.unit_data_categories(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  field_type VARCHAR(20) NOT NULL DEFAULT 'text',
  tooltip TEXT,
  is_file_link BOOLEAN NOT NULL DEFAULT false,
  is_hyperlink BOOLEAN NOT NULL DEFAULT false,
  visible BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ud_fields_category ON public.unit_data_fields(category_id);
CREATE INDEX IF NOT EXISTS idx_ud_fields_project ON public.unit_data_fields(project_id);

-- Rows (one per unit/record)
CREATE TABLE IF NOT EXISTS public.unit_data_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ud_rows_project ON public.unit_data_rows(project_id);

-- Values (cell data: row x field)
CREATE TABLE IF NOT EXISTS public.unit_data_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id UUID NOT NULL REFERENCES public.unit_data_rows(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.unit_data_fields(id) ON DELETE CASCADE,
  value TEXT,
  file_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(row_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_ud_values_row ON public.unit_data_values(row_id);
CREATE INDEX IF NOT EXISTS idx_ud_values_field ON public.unit_data_values(field_id);

-- Updated_at trigger for values
CREATE OR REPLACE FUNCTION public.update_ud_values_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ud_values_updated_at_trigger ON public.unit_data_values;
CREATE TRIGGER ud_values_updated_at_trigger
BEFORE UPDATE ON public.unit_data_values
FOR EACH ROW
EXECUTE FUNCTION public.update_ud_values_updated_at();

-- Enable RLS on all tables
ALTER TABLE public.unit_data_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_data_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_data_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_data_values ENABLE ROW LEVEL SECURITY;

-- RLS helper: check if user has access to the project
CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project_id AND owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.project_permissions WHERE project_id = p_project_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Categories policies
CREATE POLICY "Users can view categories for their projects" ON public.unit_data_categories
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Users can insert categories for their projects" ON public.unit_data_categories
  FOR INSERT WITH CHECK (public.has_project_access(project_id));
CREATE POLICY "Users can update categories for their projects" ON public.unit_data_categories
  FOR UPDATE USING (public.has_project_access(project_id));
CREATE POLICY "Users can delete categories for their projects" ON public.unit_data_categories
  FOR DELETE USING (public.has_project_access(project_id));

-- Fields policies
CREATE POLICY "Users can view fields for their projects" ON public.unit_data_fields
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Users can insert fields for their projects" ON public.unit_data_fields
  FOR INSERT WITH CHECK (public.has_project_access(project_id));
CREATE POLICY "Users can update fields for their projects" ON public.unit_data_fields
  FOR UPDATE USING (public.has_project_access(project_id));
CREATE POLICY "Users can delete fields for their projects" ON public.unit_data_fields
  FOR DELETE USING (public.has_project_access(project_id));

-- Rows policies
CREATE POLICY "Users can view rows for their projects" ON public.unit_data_rows
  FOR SELECT USING (public.has_project_access(project_id) OR public.is_admin());
CREATE POLICY "Users can insert rows for their projects" ON public.unit_data_rows
  FOR INSERT WITH CHECK (public.has_project_access(project_id));
CREATE POLICY "Users can delete rows for their projects" ON public.unit_data_rows
  FOR DELETE USING (public.has_project_access(project_id));

-- Values policies (access through row's project)
CREATE POLICY "Users can view values" ON public.unit_data_values
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.unit_data_rows r WHERE r.id = row_id AND (public.has_project_access(r.project_id) OR public.is_admin()))
  );
CREATE POLICY "Users can insert values" ON public.unit_data_values
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.unit_data_rows r WHERE r.id = row_id AND public.has_project_access(r.project_id))
  );
CREATE POLICY "Users can update values" ON public.unit_data_values
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.unit_data_rows r WHERE r.id = row_id AND public.has_project_access(r.project_id))
  );
CREATE POLICY "Users can delete values" ON public.unit_data_values
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.unit_data_rows r WHERE r.id = row_id AND public.has_project_access(r.project_id))
  );
