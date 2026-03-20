-- Calendar events: per-project shared events (meetings, deadlines, etc.)
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  event_date date not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.calendar_events enable row level security;

-- Policies: any authenticated user can CRUD (same pattern as taskers)
create policy "Authenticated users can read calendar_events"
  on public.calendar_events for select to authenticated
  using (true);

create policy "Authenticated users can insert calendar_events"
  on public.calendar_events for insert to authenticated
  with check (true);

create policy "Authenticated users can update calendar_events"
  on public.calendar_events for update to authenticated
  using (true);

create policy "Authenticated users can delete calendar_events"
  on public.calendar_events for delete to authenticated
  using (true);

-- Index for fast project + date lookups
create index idx_calendar_events_project_date on public.calendar_events(project_id, event_date);
