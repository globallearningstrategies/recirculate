-- Recirculate backend schema.
-- All access is server-side via the service role, which bypasses RLS.
-- RLS is enabled with no public policies so the anon/public key can read nothing.

create table if not exists clips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  caption text default '',
  hashtags text default '',
  video_path text,                 -- path inside the storage bucket, e.g. "lev-tahor-chorus.mp4"
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
  platform text primary key check (platform in ('youtube','instagram','tiktok')),
  cadence_days int not null default 5,
  active boolean default true        -- master switch for auto-posting this platform
);

insert into settings (platform, cadence_days, active) values
  ('youtube', 7, true), ('instagram', 5, true), ('tiktok', 4, false)
on conflict (platform) do nothing;

-- One row per connected account, holding the OAuth tokens.
create table if not exists platform_accounts (
  platform text primary key check (platform in ('youtube','instagram','tiktok')),
  external_id text,                  -- ig_user_id / youtube channel id / tiktok open_id
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  meta jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists post_log (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid references clips(id) on delete set null,
  platform text,
  posted_at timestamptz default now(),
  status text,                       -- 'success' | 'error'
  external_post_id text,
  error text
);

alter table clips enable row level security;
alter table clip_platforms enable row level security;
alter table settings enable row level security;
alter table platform_accounts enable row level security;
alter table post_log enable row level security;
-- No policies = no access for anon/authenticated. Service role still has full access.
