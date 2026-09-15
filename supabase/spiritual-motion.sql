-- Add the procedural motion treatment; preserve existing rows and RLS.
alter table public.studio_jobs drop constraint if exists studio_jobs_treatment_check;
alter table public.studio_jobs add constraint studio_jobs_treatment_check
  check (treatment in ('kinetic', 'visualizer', 'artwork', 'performance', 'spiritual'));
