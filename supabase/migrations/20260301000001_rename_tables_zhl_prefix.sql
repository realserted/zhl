-- Rename all tables to add zhl_ prefix
ALTER TABLE accounts RENAME TO zhl_accounts;
ALTER TABLE admin_requests RENAME TO zhl_admin_requests;
ALTER TABLE calendar_events RENAME TO zhl_calendar_events;
ALTER TABLE financial_bank_types RENAME TO zhl_financial_bank_types;
ALTER TABLE financial_line_items RENAME TO zhl_financial_line_items;
ALTER TABLE financial_loans RENAME TO zhl_financial_loans;
ALTER TABLE financial_monthly_values RENAME TO zhl_financial_monthly_values;
ALTER TABLE financial_sections RENAME TO zhl_financial_sections;
ALTER TABLE financial_transactions RENAME TO zhl_financial_transactions;
ALTER TABLE financial_tx_categories RENAME TO zhl_financial_tx_categories;
ALTER TABLE financial_upload_sheets RENAME TO zhl_financial_upload_sheets;
ALTER TABLE notifications RENAME TO zhl_notifications;
ALTER TABLE project_accounts RENAME TO zhl_project_accounts;
ALTER TABLE project_file_backup_requests RENAME TO zhl_project_file_backup_requests;
ALTER TABLE project_file_backups RENAME TO zhl_project_file_backups;
ALTER TABLE project_file_custom_field_values RENAME TO zhl_project_file_custom_field_values;
ALTER TABLE project_file_custom_fields RENAME TO zhl_project_file_custom_fields;
ALTER TABLE project_file_download_logs RENAME TO zhl_project_file_download_logs;
ALTER TABLE project_file_folder_permissions RENAME TO zhl_project_file_folder_permissions;
ALTER TABLE project_file_folders RENAME TO zhl_project_file_folders;
ALTER TABLE project_file_item_permissions RENAME TO zhl_project_file_item_permissions;
ALTER TABLE project_files RENAME TO zhl_project_files;
ALTER TABLE project_permissions RENAME TO zhl_project_permissions;
ALTER TABLE project_settings RENAME TO zhl_project_settings;
ALTER TABLE projects RENAME TO zhl_projects;
ALTER TABLE tasker_logs RENAME TO zhl_tasker_logs;
ALTER TABLE taskers RENAME TO zhl_taskers;
ALTER TABLE unit_data_categories RENAME TO zhl_unit_data_categories;
ALTER TABLE unit_data_fields RENAME TO zhl_unit_data_fields;
ALTER TABLE unit_data_recovery_requests RENAME TO zhl_unit_data_recovery_requests;
ALTER TABLE unit_data_rows RENAME TO zhl_unit_data_rows;
ALTER TABLE unit_data_values RENAME TO zhl_unit_data_values;
ALTER TABLE unit_data_views RENAME TO zhl_unit_data_views;
ALTER TABLE user_logs RENAME TO zhl_user_logs;

-- Recreate functions that reference table names in their bodies

CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.zhl_projects WHERE id = p_project_id AND owner_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.zhl_projects WHERE id = p_project_id AND owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.zhl_project_permissions WHERE project_id = p_project_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.link_user_permissions(p_user_id UUID, p_email TEXT)
RETURNS void AS $$
  UPDATE public.zhl_project_permissions
  SET user_id = p_user_id
  WHERE lower(user_email) = lower(p_email)
    AND user_id IS NULL;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.zhl_project_permissions
    WHERE project_id = p_project_id
      AND (
        user_id = auth.uid()
        OR lower(user_email) = (
          SELECT lower(email) FROM auth.users WHERE id = auth.uid() LIMIT 1
        )
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.create_notification_for_user(
  p_user_id     UUID,
  p_type        TEXT,
  p_title       TEXT,
  p_message     TEXT,
  p_related_id  UUID    DEFAULT NULL,
  p_related_type TEXT   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.zhl_notifications (user_id, type, title, message, related_id, related_type)
  VALUES (p_user_id, p_type, p_title, p_message, p_related_id, p_related_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_display_name_by_email(p_email TEXT)
RETURNS TEXT AS $$
  SELECT display_name
  FROM public.zhl_accounts
  WHERE lower(email) = lower(p_email)
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
