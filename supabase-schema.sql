create table if not exists public.profiles (
  id uuid primary key,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  email text not null default '',
  password_hash text not null default '',
  created_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists password_hash text not null default '';

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

alter table public.profiles drop constraint if exists profiles_id_fkey;

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
on public.profiles for select
to anon, authenticated
using (true);

drop policy if exists "Users can create their profile" on public.profiles;
create policy "Users can create their profile"
on public.profiles for insert
to anon, authenticated
with check (true);

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
on public.profiles for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read events" on public.calendar_events;
create policy "Authenticated users can read events"
on public.calendar_events for select
to anon, authenticated
using (true);

drop policy if exists "Authenticated users can create events" on public.calendar_events;
create policy "Authenticated users can create events"
on public.calendar_events for insert
to anon, authenticated
with check (true);

drop policy if exists "Authenticated users can update events" on public.calendar_events;
create policy "Authenticated users can update events"
on public.calendar_events for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can delete events" on public.calendar_events;
create policy "Authenticated users can delete events"
on public.calendar_events for delete
to anon, authenticated
using (true);
