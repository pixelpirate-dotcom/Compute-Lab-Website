-- Run this file in the Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS and DROP ... IF EXISTS throughout.

create extension if not exists "pgcrypto";

do $$ begin
  create type public.workspace_role as enum ('admin', 'member');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.project_status as enum ('Planning', 'Active', 'Completed');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  group_name text not null default 'Research Team',
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  group_name text not null,
  description text not null default '',
  status public.project_status not null default 'Planning',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null default '',
  group_name text not null default 'Research Team',
  directory_role public.workspace_role not null default 'member',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  resource_type text not null,
  url text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  link_url text,
  link_label text,
  author_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_settings (
  id boolean primary key default true check (id),
  presentation_url text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.workspace_settings (id) values (true)
on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill accounts created before this schema was installed.
insert into public.profiles (id, full_name, email)
select
  id,
  coalesce(raw_user_meta_data ->> 'full_name', ''),
  coalesce(email, '')
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.team_members enable row level security;
alter table public.projects enable row level security;
alter table public.resources enable row level security;
alter table public.posts enable row level security;
alter table public.workspace_settings enable row level security;

-- Profiles policies
drop policy if exists "Authenticated users can view profiles" on public.profiles;
create policy "Authenticated users can view profiles"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
  on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete profiles" on public.profiles;
create policy "Admins can delete profiles"
  on public.profiles for delete to authenticated using (public.is_admin());

-- Team members policies
drop policy if exists "Authenticated users can view team members" on public.team_members;
create policy "Authenticated users can view team members"
  on public.team_members for select to authenticated using (true);

drop policy if exists "Admins can create team members" on public.team_members;
create policy "Admins can create team members"
  on public.team_members for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins can update team members" on public.team_members;
create policy "Admins can update team members"
  on public.team_members for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete team members" on public.team_members;
create policy "Admins can delete team members"
  on public.team_members for delete to authenticated using (public.is_admin());

-- Projects policies
drop policy if exists "Authenticated users can view projects" on public.projects;
create policy "Authenticated users can view projects"
  on public.projects for select to authenticated using (true);

drop policy if exists "Admins can create projects" on public.projects;
create policy "Admins can create projects"
  on public.projects for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins can update projects" on public.projects;
create policy "Admins can update projects"
  on public.projects for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete projects" on public.projects;
create policy "Admins can delete projects"
  on public.projects for delete to authenticated using (public.is_admin());

-- Resources policies
drop policy if exists "Authenticated users can view resources" on public.resources;
create policy "Authenticated users can view resources"
  on public.resources for select to authenticated using (true);

drop policy if exists "Admins can create resources" on public.resources;
create policy "Admins can create resources"
  on public.resources for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins can update resources" on public.resources;
create policy "Admins can update resources"
  on public.resources for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete resources" on public.resources;
create policy "Admins can delete resources"
  on public.resources for delete to authenticated using (public.is_admin());

-- Posts policies
drop policy if exists "Authenticated users can view posts" on public.posts;
create policy "Authenticated users can view posts"
  on public.posts for select to authenticated using (true);

drop policy if exists "Users can create their own posts" on public.posts;
create policy "Users can create their own posts"
  on public.posts for insert to authenticated with check (author_id = auth.uid());

drop policy if exists "Authors and admins can update posts" on public.posts;
create policy "Authors and admins can update posts"
  on public.posts for update to authenticated using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());

drop policy if exists "Authors and admins can delete posts" on public.posts;
create policy "Authors and admins can delete posts"
  on public.posts for delete to authenticated using (author_id = auth.uid() or public.is_admin());

-- Workspace settings policies
drop policy if exists "Authenticated users can view settings" on public.workspace_settings;
create policy "Authenticated users can view settings"
  on public.workspace_settings for select to authenticated using (true);

drop policy if exists "Admins can update settings" on public.workspace_settings;
create policy "Admins can update settings"
  on public.workspace_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- After the first user signs up, promote that account once in the SQL Editor:
-- update public.profiles set role = 'admin' where email = 'your-email@example.com';
