-- Change file_id and folder_id in permission tables from UUID to TEXT
-- to support Google Drive file/folder IDs (which are strings, not UUIDs).

-- 1. Drop foreign key constraints on file_id and folder_id
ALTER TABLE zhl_project_file_item_permissions
  DROP CONSTRAINT IF EXISTS project_file_item_permissions_file_id_fkey;

ALTER TABLE zhl_project_file_folder_permissions
  DROP CONSTRAINT IF EXISTS project_file_folder_permissions_folder_id_fkey;

-- 2. Change column types from UUID to TEXT
ALTER TABLE zhl_project_file_item_permissions
  ALTER COLUMN file_id TYPE text USING file_id::text;

ALTER TABLE zhl_project_file_folder_permissions
  ALTER COLUMN folder_id TYPE text USING folder_id::text;
