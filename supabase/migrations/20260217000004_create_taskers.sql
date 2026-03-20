-- Create taskers table
create table if not exists public.taskers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'Open' check (status in ('Archived', 'Complete', 'In Progress', 'Open')),
  task_name text not null,
  description text,
  update_status text,
  responsible uuid references auth.users(id),
  responsible_name text,
  cc uuid references auth.users(id),
  cc_name text,
  got_the_ball uuid references auth.users(id),
  got_the_ball_name text,
  priority integer not null default 0 check (priority between 0 and 5),
  due_date date,
  original_due_date date,
  help_request_user uuid references auth.users(id),
  help_request_user_name text,
  issues text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create tasker_logs table (change logs + chat messages)
create table if not exists public.tasker_logs (
  id uuid primary key default gen_random_uuid(),
  tasker_id uuid not null references public.taskers(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  user_name text not null,
  type text not null default 'comment' check (type in ('comment', 'change')),
  message text not null,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.taskers enable row level security;
alter table public.tasker_logs enable row level security;

-- Taskers policies: any authenticated user can read/write (project-level filtering in app)
create policy "Authenticated users can read taskers"
  on public.taskers for select to authenticated
  using (true);

create policy "Authenticated users can insert taskers"
  on public.taskers for insert to authenticated
  with check (true);

create policy "Authenticated users can update taskers"
  on public.taskers for update to authenticated
  using (true);

create policy "Authenticated users can delete taskers"
  on public.taskers for delete to authenticated
  using (true);

-- Tasker logs policies
create policy "Authenticated users can read tasker_logs"
  on public.tasker_logs for select to authenticated
  using (true);

create policy "Authenticated users can insert tasker_logs"
  on public.tasker_logs for insert to authenticated
  with check (true);

-- Index for fast project lookups
create index idx_taskers_project_id on public.taskers(project_id);
create index idx_tasker_logs_tasker_id on public.tasker_logs(tasker_id);
