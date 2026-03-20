-- Add field_order column to unit_data_views for per-user column reordering
-- Stores an array of field IDs in display order. NULL = default sort_order.
ALTER TABLE public.unit_data_views
  ADD COLUMN IF NOT EXISTS field_order JSONB DEFAULT NULL;
