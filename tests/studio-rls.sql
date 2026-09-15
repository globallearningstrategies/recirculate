begin;
do $test$
declare owner_id uuid; other_id uuid := gen_random_uuid(); test_song_id uuid; n integer;
begin
 select user_id into owner_id from public.settings limit 1;
 if owner_id is null then raise exception 'No owner available'; end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 execute 'set local role authenticated';
 insert into public.songs(title,slug) values ('Studio RLS test','rls-test-'||gen_random_uuid()) returning id into test_song_id;
 insert into public.song_assets(song_id,audio_path,audio_name,duration) values (test_song_id,owner_id::text||'/test.mp3','test.mp3',30);
 select count(*) into n from public.song_assets a where a.song_id=test_song_id;
 if n <> 1 then raise exception 'Owner cannot read asset'; end if;
 perform set_config('request.jwt.claim.sub',other_id::text,true);
 select count(*) into n from public.song_assets;
 if n <> 0 then raise exception 'Other user can read assets'; end if;
 update public.song_assets set audio_name='wrong-owner' where user_id=owner_id;
 get diagnostics n=row_count;
 if n <> 0 then raise exception 'Other user can edit asset'; end if;
 begin
  insert into public.notification_preferences(user_id) values(owner_id);
  raise exception 'Other user wrote owner preferences';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into public.studio_jobs(user_id,song_id,batch_id,title,treatment,audio_path,start_seconds,duration_seconds,lyrics) values(owner_id,test_song_id,gen_random_uuid(),'bad','kinetic','bad',0,20,'bad');
  raise exception 'Client can create privileged render jobs';
 exception when insufficient_privilege then null;
 end;
 execute 'reset role';
end $test$;
rollback;
select 'Owner access and cross-user restrictions passed; all test rows rolled back' as verification;
