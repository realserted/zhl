-- Add linked file columns to unit_data_fields and unit_data_categories
-- Allows associating a file/folder (from the Files page) with a field or category

ALTER TABLE public.unit_data_fields
  ADD COLUMN IF NOT EXISTS linked_file_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS linked_file_path TEXT DEFAULT NULL;

ALTER TABLE public.unit_data_categories
  ADD COLUMN IF NOT EXISTS linked_file_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS linked_file_path TEXT DEFAULT NULL;
