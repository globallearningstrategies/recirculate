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
  thumb_path text,                 -- cover image for library cards / video posters
  external_id text,                -- source media id (e.g. Instagram media id); null for manual adds
  source text,                     -- 'instagram' | null (manual)
  status text,                     -- 'imported' | null
  posted_at timestamptz,           -- original platform timestamp (IG reel created time)
  licensed_audio boolean not null default false, -- IG licensed-music: audio baked in, may trip Content ID
  archived boolean not null default false,       -- kept but out of every rotation and the main library view
  created_at timestamptz default now()
);

-- Backfill columns on pre-existing deployments.
alter table clips add column if not exists thumb_path     text;
alter table clips add column if not exists external_id    text;
alter table clips add column if not exists source         text;
alter table clips add column if not exists status         text;
alter table clips add column if not exists posted_at      timestamptz;
alter table clips add column if not exists licensed_audio boolean not null default false;
alter table clips add column if not exists archived       boolean not null default false;

-- Idempotency for imports: one clip per (owner, external id). Partial so manual clips are unaffected.
create unique index if not exists clips_user_external_idx
  on clips (user_id, external_id)
  where external_id is not null;

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

-- Per-user platform connection used by the Instagram importer (and forward-compatible
-- with Phase 2 OAuth, which will write the same row). The importer reads access_token
-- server-side via the service role; for now the owner inserts a long-lived token by hand.
create table if not exists social_connections (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform text not null check (platform in ('instagram','youtube','tiktok')),
  external_user_id text,
  username text,
  access_token text,
  refresh_token text,                -- YouTube/TikTok only; TikTok rotates it on every refresh
  token_expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, platform)
);

alter table social_connections add column if not exists refresh_token text;

-- Older deployments may predate user_id; add it idempotently.
alter table clips             add column if not exists user_id uuid default auth.uid();
alter table settings          add column if not exists user_id uuid default auth.uid();
alter table platform_accounts add column if not exists user_id uuid default auth.uid();
alter table post_log          add column if not exists user_id uuid default auth.uid();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table clips              enable row level security;
alter table clip_platforms     enable row level security;
alter table settings           enable row level security;
alter table platform_accounts  enable row level security;
alter table post_log           enable row level security;
alter table social_connections enable row level security;

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

drop policy if exists "own social_connections" on social_connections;
create policy "own social_connections" on social_connections for all
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

-- Only the auth trigger should run this — not the public RPC surface.
revoke execute on function public.seed_owner_settings() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: public "clips" bucket for video files
-- ---------------------------------------------------------------------------
-- The bucket is public so Instagram/TikTok servers can fetch videos by URL —
-- public-bucket object URLs don't consult RLS, so no anon SELECT policy is
-- needed (and a broad one would let anyone LIST the bucket). Reads/writes via
-- the API are limited to authenticated users (only the owner ever authenticates).

insert into storage.buckets (id, name, public)
values ('clips', 'clips', true)
on conflict (id) do update set public = true;

drop policy if exists "clips public read" on storage.objects;
drop policy if exists "clips authenticated read" on storage.objects;
create policy "clips authenticated read" on storage.objects for select to authenticated
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

-- ---------------------------------------------------------------------------
-- Smart-link funnel (/listen): songs with streaming URLs, clip→song
-- assignment, and click tracking so social posts become measurable funnels.
-- ---------------------------------------------------------------------------

create table if not exists songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  slug text not null,
  spotify_url text default '',
  apple_url text default '',
  youtube_url text default '',
  created_at timestamptz default now(),
  unique (user_id, slug)
);

alter table clips add column if not exists song_id uuid references songs(id) on delete set null;

create table if not exists link_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  song_id uuid references songs(id) on delete cascade,
  target text,   -- 'spotify' | 'apple' | 'youtube'
  src text,      -- 'instagram' | 'tiktok' | 'youtube' | 'direct'
  created_at timestamptz default now()
);

alter table songs enable row level security;
alter table link_clicks enable row level security;

drop policy if exists "own songs" on songs;
create policy "own songs" on songs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Clicks are inserted server-side (service role) only; the owner reads stats.
drop policy if exists "own link_clicks" on link_clicks;
create policy "own link_clicks" on link_clicks for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Performance metrics pulled back from the platforms (see /api/metrics/refresh)
-- ---------------------------------------------------------------------------
alter table post_log add column if not exists views int;
alter table post_log add column if not exists likes int;
alter table post_log add column if not exists comments int;
alter table post_log add column if not exists shares int;
alter table post_log add column if not exists metrics_at timestamptz;

alter table clips add column if not exists source_views int;
alter table clips add column if not exists source_likes int;
alter table clips add column if not exists metrics_at timestamptz;

-- ---------------------------------------------------------------------------
-- Campaign mode + weekly scorecard
-- ---------------------------------------------------------------------------
alter table songs add column if not exists campaign_until timestamptz;

create table if not exists artist_snapshots (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz default now(),
  spotify_followers int,
  brevo_contacts int
);
alter table artist_snapshots enable row level security; -- service-role only

-- ---------------------------------------------------------------------------
-- Scheduled posts: approve now, the daily cron posts it that morning
-- ---------------------------------------------------------------------------
create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clip_id uuid not null references clips(id) on delete cascade,
  platform text not null check (platform in ('youtube','instagram','tiktok')),
  run_at timestamptz not null,
  status text not null default 'pending',  -- pending | done | error | canceled
  error text,
  created_at timestamptz default now()
);
alter table scheduled_posts enable row level security;
drop policy if exists "own scheduled_posts" on scheduled_posts;
create policy "own scheduled_posts" on scheduled_posts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Growth stack: caption memory, lead magnet, curator outreach
-- ---------------------------------------------------------------------------
alter table post_log add column if not exists caption text;

create table if not exists lead_magnet (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  file_path text not null,
  created_at timestamptz default now()
);
alter table lead_magnet enable row level security;
drop policy if exists "own lead_magnet" on lead_magnet;
create policy "own lead_magnet" on lead_magnet for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists curators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  contact_email text default '',
  playlist_url text default '',
  note text default '',
  status text not null default 'new',   -- new | pitched | placed | passed
  last_contact timestamptz,
  created_at timestamptz default now()
);
alter table curators enable row level security;
drop policy if exists "own curators" on curators;
create policy "own curators" on curators for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
