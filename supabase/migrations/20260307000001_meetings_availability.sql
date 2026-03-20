-- Add location column to calendar_events
alter table public.zhl_calendar_events add column if not exists location text;

-- Out-of-Office tracker
create table if not exists public.zhl_out_of_office (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.zhl_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  user_name text not null default '',
  ooo_date date not null,
  note text not null default 'Out',
  created_at timestamptz not null default now()
);

alter table public.zhl_out_of_office enable row level security;

create policy "Authenticated users can read zhl_out_of_office"
  on public.zhl_out_of_office for select to authenticated using (true);
create policy "Authenticated users can insert zhl_out_of_office"
  on public.zhl_out_of_office for insert to authenticated with check (true);
create policy "Authenticated users can update zhl_out_of_office"
  on public.zhl_out_of_office for update to authenticated using (true);
create policy "Authenticated users can delete zhl_out_of_office"
  on public.zhl_out_of_office for delete to authenticated using (true);

create index if not exists idx_ooo_project_date on public.zhl_out_of_office(project_id, ooo_date);

-- Add Google Calendar ID to project settings
alter table public.zhl_project_settings add column if not exists google_calendar_id text default '';
