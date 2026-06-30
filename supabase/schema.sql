-- Recirculate schema — single-user, RLS-gated.
--
-- This app is single-user but must not be world-readable. Every row carries a
-- user_id and RLS restricts access to user_id = auth.uid(). The browser client
-- (anon key + the signed-in owner's session) can therefore touch only the
-- owner's own rows. The Vercel Cron (Phase 3) uses the service role, which
-- bypasses RLS, and acts on the owner's accounts.
--
-- Safe to re-run: guarded with "if not exists" / "if exists" throughout.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  caption text default '',
  hashtags text default '',
  video_path text,                 -- path inside the storage bucket, e.g. "<uid>/lev-tahor-chorus.mp4"
  created_at timestamptz default now()
);

create table if not exists clip_platforms (
  clip_id uuid references clips(id) on delete cascade,
  platform text check (platform in ('youtube','instagram','tiktok')),
  enabled boolean default true,
  link text default '',
  last_posted_at timestamptz,
  times_posted int default 0,
  primary key (clip_id, platform)
);

create table if not exists settings (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform text not null check (platform in ('youtube','instagram','tiktok')),
  cadence_days int not null default 5,
  active boolean default true,       -- master switch for auto-posting this platform
  primary key (user_id, platform)
);

-- One row per connected account, holding the OAuth tokens (populated in Phase 2).
create table if not exists platform_accounts (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform text not null check (platform in ('youtube','instagram','tiktok')),
  external_id text,                  -- ig_user_id / youtube channel id / tiktok open_id
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  meta jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, platform)
);

create table if not exists post_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clip_id uuid references clips(id) on delete set null,
  platform text,
  posted_at timestamptz default now(),
  status text,                       -- 'success' | 'error'
  external_post_id text,
  error text
);

-- Older deployments may predate user_id; add it idempotently.
alter table clips             add column if not exists user_id uuid default auth.uid();
alter table settings          add column if not exists user_id uuid default auth.uid();
alter table platform_accounts add column if not exists user_id uuid default auth.uid();
alter table post_log          add column if not exists user_id uuid default auth.uid();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table clips             enable row level security;
alter table clip_platforms    enable row level security;
alter table settings          enable row level security;
alter table platform_accounts enable row level security;
alter table post_log          enable row level security;

-- A row is readable and writable only by its owner.
drop policy if exists "own clips" on clips;
create policy "own clips" on clips for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own settings" on settings;
create policy "own settings" on settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own platform_accounts" on platform_accounts;
create policy "own platform_accounts" on platform_accounts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own post_log" on post_log;
create policy "own post_log" on post_log for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- clip_platforms has no user_id of its own; ownership flows through its clip.
drop policy if exists "own clip_platforms" on clip_platforms;
create policy "own clip_platforms" on clip_platforms for all
  using (exists (select 1 from clips c where c.id = clip_platforms.clip_id and c.user_id = auth.uid()))
  with check (exists (select 1 from clips c where c.id = clip_platforms.clip_id and c.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Seed default settings for the owner on first sign-in
-- ---------------------------------------------------------------------------
-- youtube 7, instagram 5, tiktok 4. TikTok starts inactive (audit not cleared).

create or replace function public.seed_owner_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.settings (user_id, platform, cadence_days, active) values
    (new.id, 'youtube',   7, true),
    (new.id, 'instagram', 5, true),
    (new.id, 'tiktok',    4, false)
  on conflict (user_id, platform) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.seed_owner_settings();

-- ---------------------------------------------------------------------------
-- Storage: public "clips" bucket for video files
-- ---------------------------------------------------------------------------
-- Public read so Instagram/TikTok servers (Phase 2/3) can fetch the video by URL.
-- Writes are limited to authenticated users (only the owner ever authenticates).

insert into storage.buckets (id, name, public)
values ('clips', 'clips', true)
on conflict (id) do update set public = true;

drop policy if exists "clips public read" on storage.objects;
create policy "clips public read" on storage.objects for select
  using (bucket_id = 'clips');

drop policy if exists "clips owner insert" on storage.objects;
create policy "clips owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips');

drop policy if exists "clips owner update" on storage.objects;
create policy "clips owner update" on storage.objects for update to authenticated
  using (bucket_id = 'clips') with check (bucket_id = 'clips');

drop policy if exists "clips owner delete" on storage.objects;
create policy "clips owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'clips');
