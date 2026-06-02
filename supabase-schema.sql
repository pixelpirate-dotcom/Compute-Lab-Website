-- ============================================================
-- ComputeLab — New Schema (PIN-based auth, no Supabase Auth)
-- Run this in the Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / DROP IF EXISTS).
-- ============================================================

-- Drop old tables that depend on Supabase Auth (if migrating)
drop table if exists public.posts cascade;
drop table if exists public.projects cascade;
drop table if exists public.resources cascade;
drop table if exists public.workspace_settings cascade;
drop table if exists public.team_members cascade;
drop table if exists public.profiles cascade;

-- ── Tables ────────────────────────────────────────────────

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  group_name text not null default '',
  description text not null default '',
  status text not null default 'Planning',
  created_at timestamptz not null default now()
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  resource_type text not null default '',
  url text not null,
  created_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  link_url text,
  link_label text,
  author_name text not null default '',
  author_group text not null default '',
  created_at timestamptz not null default now()
);

create table public.workspace_settings (
  id boolean primary key default true check (id),
  presentation_url text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.workspace_settings (id) values (true)
on conflict (id) do nothing;

-- ── Row Level Security (allow anon access) ────────────────
-- Members authenticate via PIN in config.js, not Supabase Auth.
-- All tables are readable and writable by the anon key.

alter table public.projects enable row level security;
alter table public.resources enable row level security;
alter table public.posts enable row level security;
alter table public.workspace_settings enable row level security;

-- Projects
create policy "Anon select projects" on public.projects for select to anon using (true);
create policy "Anon insert projects" on public.projects for insert to anon with check (true);
create policy "Anon update projects" on public.projects for update to anon using (true) with check (true);
create policy "Anon delete projects" on public.projects for delete to anon using (true);

-- Resources
create policy "Anon select resources" on public.resources for select to anon using (true);
create policy "Anon insert resources" on public.resources for insert to anon with check (true);
create policy "Anon update resources" on public.resources for update to anon using (true) with check (true);
create policy "Anon delete resources" on public.resources for delete to anon using (true);

-- Posts
create policy "Anon select posts" on public.posts for select to anon using (true);
create policy "Anon insert posts" on public.posts for insert to anon with check (true);
create policy "Anon update posts" on public.posts for update to anon using (true) with check (true);
create policy "Anon delete posts" on public.posts for delete to anon using (true);

-- Workspace settings
create policy "Anon select settings" on public.workspace_settings for select to anon using (true);
create policy "Anon update settings" on public.workspace_settings for update to anon using (true) with check (true);
