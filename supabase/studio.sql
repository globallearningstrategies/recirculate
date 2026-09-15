-- Music studio. Masters stay private; only rendered clips use the public bucket.
create table if not exists public.song_assets (
 song_id uuid primary key references public.songs(id) on delete cascade,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 audio_path text not null, audio_name text not null, duration double precision not null check (duration between 10 and 3600),
 artwork_path text, performance_path text, lyrics text not null default '',
 updated_at timestamptz not null default now()
);
alter table public.song_assets enable row level security;
revoke all on public.song_assets from anon;
grant select,insert,update,delete on public.song_assets to authenticated;
grant all on public.song_assets to service_role;
drop policy if exists "own song assets" on public.song_assets;
create policy "own song assets" on public.song_assets for all to authenticated
 using ((select auth.uid()) = user_id)
 with check ((select auth.uid()) = user_id and exists (select 1 from public.songs s where s.id = song_id and s.user_id = (select auth.uid())));

create table if not exists public.studio_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 song_id uuid not null references public.songs(id) on delete cascade,
 batch_id uuid not null, title text not null,
 treatment text not null check (treatment in ('kinetic','visualizer','artwork','performance')),
 audio_path text not null, artwork_path text, performance_path text,
 start_seconds double precision not null check (start_seconds >= 0),
 duration_seconds double precision not null check (duration_seconds between 10 and 45),
 lyrics text not null,
 status text not null default 'queued' check (status in ('queued','rendering','ready','error')),
 error text, clip_id uuid references public.clips(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists studio_jobs_owner_batch on public.studio_jobs(user_id, batch_id);
create index if not exists studio_jobs_song on public.studio_jobs(song_id);
create index if not exists studio_jobs_clip on public.studio_jobs(clip_id);
alter table public.studio_jobs enable row level security;
revoke all on public.studio_jobs from anon, authenticated;
grant select on public.studio_jobs to authenticated;
grant all on public.studio_jobs to service_role;
drop policy if exists "read own studio jobs" on public.studio_jobs;
create policy "read own studio jobs" on public.studio_jobs for select to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.notification_preferences (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 daily_reminders boolean not null default false,
 weekly_summary boolean not null default false,
 failure_alerts boolean not null default true
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon;
grant select,insert,update on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;
drop policy if exists "own notification preferences" on public.notification_preferences;
create policy "own notification preferences" on public.notification_preferences for all to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.scheduled_posts add column if not exists destination_account_id text;
alter table public.scheduled_posts add column if not exists studio_job_id uuid references public.studio_jobs(id) on delete set null;
create unique index if not exists studio_schedule_once on public.scheduled_posts(studio_job_id, platform) where studio_job_id is not null and status in ('pending','processing','done');
create index if not exists scheduled_posts_studio_job on public.scheduled_posts(studio_job_id);

insert into storage.buckets(id, name, public, file_size_limit)
 values ('song-assets','song-assets',false,52428800)
 on conflict(id) do update set public=false, file_size_limit=52428800;
drop policy if exists "own private masters" on storage.objects;
create policy "own private masters" on storage.objects for all to authenticated
 using (bucket_id='song-assets' and (storage.foldername(name))[1]=(select auth.uid())::text)
 with check (bucket_id='song-assets' and (storage.foldername(name))[1]=(select auth.uid())::text);
