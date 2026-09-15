# Music clip studio

Open `/studio` from the Music clip studio link above the library tabs.

## Workflow

1. Choose an existing song or pick an MP3/WAV/M4A (or original video for its audio). A new upload supplies the title from its filename; edit it if needed, then tap **Save song**. You can also create a song separately without losing the file you already chose. Artwork and performance footage are optional.
2. Choose up to three excerpts, 10–45 seconds each. **Suggest energetic moments** analyzes the audio in the browser and proposes non-overlapping windows to audition. This is an energy heuristic, not a chorus detector.
3. Paste lyrics or transcribe each excerpt. Correct sung words and timestamps. `[0:04.750]` means 4.75 seconds into the excerpt, not into the full song. Unstamped lines receive equal time slots.
4. Choose up to four visual treatments, then create up to 12 drafts. **Cosmic Dreamcore** is selected by default and needs only the song audio and lyrics. Start rendering on the review screen. Keep it open; a completed draft is saved after each video. Interrupted batches can resume. Failed requests become retryable after their ten-minute lease expires.
5. Preview, download, or select completed clips. Choose a connected Instagram/YouTube account and explicitly approve that destination before scheduling. The current connection system supports one account per platform. A separate clips account must be connected before scheduling to it; downloads work for any manually managed account.

## Startup and upload recovery

The server-rendered startup notice includes a normal reload link, so it works even when the JavaScript bundle fails to start. A studio error boundary provides recovery after client errors. Initial reads load independently with 15-second deadlines; a failed preferences or scheduling request cannot hold up the song list indefinitely. Notification controls stay disabled until their actual saved values load. Save and Create buttons explain their prerequisites beside the action.

The reported iPhone freeze could not be reproduced in a signed-in production session; these recovery paths do not establish its original cause. Browser coverage checks title interactivity, local audio selection, preservation across song creation, unavailable settings, and the no-JavaScript recovery notice.

## Notification defaults

Daily reminder emails/pushes and weekly summary emails are off. Failure alerts remain on. The three controls at the bottom of `/studio` persist per owner. A missing preferences row uses these quiet defaults. Disabling notifications does not disable scheduled publishing or token refreshes. The cron `force` parameter does not override notification choices.

## Implementation

- **Cosmic Dreamcore:** apply `supabase/cosmic-dreamcore.sql` after the existing studio migrations. This treatment uses continuous procedural animation at 540×960/24fps, upscaled to 1080×1920/30fps, with shaped subtitles at final resolution. No external video-generation subscription is called. Hosting, transcription, and storage costs still apply. See Continuous motion and lyric corrections below.

- The additive database setup is in `supabase/studio.sql`. Apply after the base `supabase/schema.sql` on a fresh installation. It adds assets, render jobs, preferences, and account-bound scheduling fields; existing rows remain intact.
- Original song assets use the **private** `song-assets` bucket (50 MB per file). Signed URLs are used for browser playback. Rendered MP4s use the existing public clips bucket so publishing APIs can retrieve them.
- Each draft snapshots its inputs. `POST /api/studio/render` claims one job using a compare-and-set timestamp, renders with FFmpeg, and saves a deterministic clip ID and file paths. Retry cannot create a duplicate clip. New clips have no enabled platform rows.
- Six 1080×1920 treatments: Cosmic Dreamcore, Spiritual journey, moving lyric typography, audio-reactive waveform, artwork camera motion, and performance footage with lyrics. Performance footage must align with the source audio from time zero. No generative-video subscription is required.
- Apply `supabase/spiritual-motion.sql` after `supabase/studio.sql` to enable Spiritual journey. Its software renderer creates evolving stars, a six-pointed star with orbiting light, stylized Jerusalem buildings, aurora ribbons, and water. Scene dissolves follow the excerpt's duration; glow intensity responds to the actual audio amplitude. This is designed animation, not photorealistic AI footage or automatic interpretation of lyric meaning. It uses the existing hosting compute and storage. Backgrounds render at 540×960/24fps and are upscaled to 1080×1920/30fps; lyrics are drawn at final resolution with text shaping enabled for Hebrew. Captions remain line-timed, not word-aligned.
- Jobs run one at a time from the open browser. This release does not include an unattended background render worker. Rendering may take longer on hosted CPUs than on a workstation.
- Publishing runs at the existing daily cron time, 14:00 UTC. The UI schedules dates against that cadence and labels it honestly. One due post per platform is attempted per run; backlog waits for later runs.
- Scheduled rows are claimed before publishing. Jobs bind the approved destination account ID; replacing a connection blocks those jobs until reviewed. A timed-out publish stays `processing` because blindly retrying could publish twice. Check the platform and reconcile the row before retrying.
- TikTok remains assisted manual. No fake engagement, account creation, or unapproved social posts are performed.

## Validation

`npm test` runs boundary, lyric timing, scheduling, treatment prerequisite, notification default, and audio suggestion tests.

Set `TEST_RENDER=1` when running the same command to render synthetic test media through all four FFmpeg treatments. Outputs are saved under ignored `.studio-test/`. Each MP4 is decoded and checked for 1080×1920 dimensions and a ten-second duration.

The additional spiritual test renders a 20-second sample with English, Hebrew and mixed lines, checks the full MP4, and extracts frames for visual review. Its audio is a synthetic test tone, not a song. Motion tests cover reproducibility, scene changes and audio response.

`TEST_RENDER=1 node --test tests/cosmic.test.cjs` checks a 20-second Cosmic Dreamcore export with English/Hebrew captions, audio, continuous motion, and a full decode. Set `COSMIC_TEST_DURATION=45` to check the maximum excerpt duration.

`node tests/studio-browser.cjs` runs a local-only browser flow with mocked APIs. It needs Playwright (or `PLAYWRIGHT_MODULE` pointing to an installed Playwright module) and Edge. Run render tests first to create the test media. The script creates a temporary development-only page, checks create/render/review/schedule/preferences at desktop and mobile widths, saves screenshots under `.studio-test/`, and removes the page. No real posts or emails are sent.

`tests/studio-rls.sql` checks owner access and cross-user denial inside a transaction, then rolls back all fixtures. Run on a provisioned database with at least one owner settings row.

## Continuous motion and lyric corrections

Cosmic Dreamcore now draws every frame from animated geometry: perspective gates, a shaded orbiting planet, flowing nebula ribbons, stars moving in depth, and rolling reflective water. It uses no still image in the video background. This is abstract animation, not generated photorealistic footage. Existing completed videos remain unchanged; create a new version to use the current renderer.

Transcription defaults to mixed Hebrew/English auto-detection. Users can type Hebrew script directly into excerpt lyrics. Review cards expose Edit lyrics / make new version, with an RTL-aware editable transcript. Saving creates a new queued job in the same batch; the source video, downloads, and schedules remain intact. The revisions endpoint authenticates the owner and only copies that owner's job and source paths. Captions remain line-timed; preserve or add timestamps to position corrected Hebrew lines.

## Phrase editor

The studio now uses short phrase cards with explicit start and end times, audition playback, playhead timing buttons, splitting, Hebrew/English text and a live caption preview. Existing timestamped verses are split with estimated timing for owner review. New studio transcriptions request word and segment timestamps and group words into short phrases, retaining silence between sung phrases. End times survive saving and rendering through the serialized [m:ss.sss --> m:ss.sss] format; no schema migration is needed. Server validation rejects overlaps and out-of-range times. The title fades after the opening 2.5 seconds. Previous completed videos remain unchanged until a corrected draft is rendered.

