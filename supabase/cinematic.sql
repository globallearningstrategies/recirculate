create table public.cinematic_runs (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 source jsonb,
 plan jsonb not null,
 scenes jsonb not null,
 status text not null default 'active' check (status in ('active','ready','attention')),
 error text,
 background_path text,
 lock_id uuid,
 lock_until timestamptz,
 created_at timestamptz not null default now()
);
create index cinematic_runs_owner on public.cinematic_runs(user_id,created_at desc);
create unique index cinematic_one_active on public.cinematic_runs(user_id) where status='active';
alter table public.cinematic_runs enable row level security;
revoke all on public.cinematic_runs from anon,authenticated;
grant select on public.cinematic_runs to authenticated;
grant all on public.cinematic_runs to service_role;
create policy "read own cinematic runs" on public.cinematic_runs for select to authenticated using ((select auth.uid())=user_id);
alter table public.studio_jobs drop constraint studio_jobs_treatment_check;
alter table public.studio_jobs add constraint studio_jobs_treatment_check check (treatment in ('cosmic','spiritual','kinetic','visualizer','artwork','performance','cinematic'));
