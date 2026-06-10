create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  email text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id text primary key,
  type text not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  customer_name text not null default '',
  address text not null default '',
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.calendar_events enable row level security;

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "Users can create their profile" on public.profiles;
create policy "Users can create their profile"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Authenticated users can read events" on public.calendar_events;
create policy "Authenticated users can read events"
on public.calendar_events for select
to authenticated
using (true);

drop policy if exists "Authenticated users can create events" on public.calendar_events;
create policy "Authenticated users can create events"
on public.calendar_events for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update events" on public.calendar_events;
create policy "Authenticated users can update events"
on public.calendar_events for update
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can delete events" on public.calendar_events;
create policy "Authenticated users can delete events"
on public.calendar_events for delete
to authenticated
using (true);
