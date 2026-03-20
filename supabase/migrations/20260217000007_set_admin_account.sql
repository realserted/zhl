-- Set the admin account
UPDATE public.accounts 
SET is_admin = true 
WHERE email = 'admin@zhl.com';
