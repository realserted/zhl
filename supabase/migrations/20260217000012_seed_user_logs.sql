-- Seed test data for user logs
-- This will create sample logs to verify the user logs page is working

INSERT INTO public.user_logs (project_id, user_id, user_name, user_email, action, created_at)
SELECT
  p.id as project_id,
  a.user_id,
  a.display_name,
  a.email,
  action,
  CURRENT_TIMESTAMP - (row_number() OVER (ORDER BY p.id) * INTERVAL '5 minutes')
FROM public.projects p
CROSS JOIN public.accounts a
CROSS JOIN (
  VALUES
    ('Created new tasker'),
    ('Updated unit data'),
    ('Uploaded file'),
    ('Modified permissions'),
    ('Updated project status')
) AS actions(action)
WHERE p.id IS NOT NULL
LIMIT 10;
