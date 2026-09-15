# Music clip studio

Open `/studio` from the Music clip studio link above the library tabs.

## Workflow

1. Choose or create a song. Upload its MP3/WAV/M4A (or original video for its audio), optional artwork and optional performance footage. Save the assets once.
2. Choose up to three excerpts, 10–45 seconds each. **Suggest energetic moments** analyzes the audio in the browser and proposes non-overlapping windows to audition. This is an energy heuristic, not a chorus detector.
3. Paste lyrics or transcribe each excerpt. Correct sung words and timestamps. `[0:04.750]` means 4.75 seconds into the excerpt, not into the full song. Unstamped lines receive equal time slots.
4. Choose up to four visual treatments, then create up to 12 drafts. **Spiritual journey** is selected by default and needs only the song audio and lyrics. Start rendering on the review screen. Keep it open; a completed draft is saved after each video. Interrupted batches can resume. Failed requests become retryable after their ten-minute lease expires.
5. Preview, download, or select completed clips. Choose a connected Instagram/YouTube account and explicitly approve that destination before scheduling. The current connection system supports one account per platform. A separate clips account must be connected before scheduling to it; downloads work for any manually managed account.

## Notification defaults

Daily reminder emails/pushes and weekly summary emails are off. Failure alerts remain on. The three controls at the bottom of `/studio` persist per owner. A missing preferences row uses these quiet defaults. Disabling notifications does not disable scheduled publishing or token refreshes. The cron `force` parameter does not override notification choices.

## Implementation

- The additive database setup is in `supabase/studio.sql`. Apply after the base `supabase/schema.sql` on a fresh installation. It adds assets, render jobs, preferences, and account-bound scheduling fields; existing rows remain intact.
- Original song assets use the **private** `song-assets` bucket (50 MB per file). Signed URLs are used for browser playback. Rendered MP4s use the existing public clips bucket so publishing APIs can retrieve them.
- Each draft snapshots its inputs. `POST /api/studio/render` claims one job using a compare-and-set timestamp, renders with FFmpeg, and saves a deterministic clip ID and file paths. Retry cannot create a duplicate clip. New clips have no enabled platform rows.
- Five 1080×1920 treatments: Spiritual journey, moving lyric typography, audio-reactive waveform, artwork camera motion, and performance footage with lyrics. Performance footage must align with the source audio from time zero. No generative-video subscription is required.
- Apply `supabase/spiritual-motion.sql` after `supabase/studio.sql` to enable Spiritual journey. Its software renderer creates evolving stars, a six-pointed star with orbiting light, stylized Jerusalem buildings, aurora ribbons, and water. Scene dissolves follow the excerpt's duration; glow intensity responds to the actual audio amplitude. This is designed animation, not photorealistic AI footage or automatic interpretation of lyric meaning. It uses the existing hosting compute and storage. Backgrounds render at 540×960/24fps and are upscaled to 1080×1920/30fps; lyrics are drawn at final resolution with text shaping enabled for Hebrew. Captions remain line-timed, not word-aligned.
- Jobs run one at a time from the open browser. This release does not include an unattended background render worker. Rendering may take longer on hosted CPUs than on a workstation.
- Publishing runs at the existing daily cron time, 14:00 UTC. The UI schedules dates against that cadence and labels it honestly. One due post per platform is attempted per run; backlog waits for later runs.
- Scheduled rows are claimed before publishing. Jobs bind the approved destination account ID; replacing a connection blocks those jobs until reviewed. A timed-out publish stays `processing` because blindly retrying could publish twice. Check the platform and reconcile the row before retrying.
- TikTok remains assisted manual. No fake engagement, account creation, or unapproved social posts are performed.

## Validation

`npm test` runs boundary, lyric timing, scheduling, treatment prerequisite, notification default, and audio suggestion tests.

Set `TEST_RENDER=1` when running the same command to render synthetic test media through all four FFmpeg treatments. Outputs are saved under ignored `.studio-test/`. Each MP4 is decoded and checked for 1080×1920 dimensions and a ten-second duration.

The additional spiritual test renders a 20-second sample with English, Hebrew and mixed lines, checks the full MP4, and extracts frames for visual review. Its audio is a synthetic test tone, not a song. Motion tests cover reproducibility, scene changes and audio response.

`node tests/studio-browser.cjs` runs a local-only browser flow with mocked APIs. It needs Playwright (or `PLAYWRIGHT_MODULE` pointing to an installed Playwright module) and Edge. Run render tests first to create the test media. The script creates a temporary development-only page, checks create/render/review/schedule/preferences at desktop and mobile widths, saves screenshots under `.studio-test/`, and removes the page. No real posts or emails are sent.

`tests/studio-rls.sql` checks owner access and cross-user denial inside a transaction, then rolls back all fixtures. Run on a provisioned database with at least one owner settings row.
