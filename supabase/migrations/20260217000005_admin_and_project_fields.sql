-- Add admin flag to accounts
alter table public.accounts add column if not exists is_admin boolean not null default false;

-- Add project-level fields for admin panel
alter table public.projects add column if not exists status text not null default 'Good'
  check (status in ('Critical', 'Problematic', 'Needs Attention', 'Good', 'Excellent'));
alter table public.projects add column if not exists units integer not null default 0;
alter table public.projects add column if not exists state text;

-- Helper function: check if current user is admin (SECURITY DEFINER to bypass RLS)
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.accounts where user_id = auth.uid() and is_admin = true
  );
$$ language sql security definer stable;

-- Auto-set is_admin for the admin account (email: admin@zhl.com)
-- This trigger fires when a new account row is inserted.
create or replace function public.auto_set_admin()
returns trigger as $$
begin
  if NEW.email = 'admin@zhl.com' then
    NEW.is_admin := true;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists set_admin_on_insert on public.accounts;
create trigger set_admin_on_insert
before insert on public.accounts
for each row
execute function public.auto_set_admin();

-- Admin can view ALL projects
create policy "Admins can view all projects" on public.projects
  for select using (public.is_admin());

-- Admin can update ALL projects (for status/units/state)
create policy "Admins can update all projects" on public.projects
  for update using (public.is_admin());

-- Admin can view all accounts
create policy "Admins can view all accounts" on public.accounts
  for select using (public.is_admin());
