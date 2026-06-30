# Build Brief — Recirculate

This is the master spec. Build it in the phases below. Propose a plan before writing code, then
build one phase at a time and stop for review after each.

## Goal
A personal web app that recycles one creator's short-form clips. He adds his best clips once, sets
how often to repost per platform, and the app reposts the next-due clip to YouTube Shorts,
Instagram Reels, and TikTok on a schedule. The point is to end the treadmill of making new content.

## Platform decision
Next.js web app on Vercel, shipped as a PWA installed to the iPhone home screen. Not native. The
auto-poster must run server-side (Vercel Cron), so the client and server live in one Next.js repo.

## Data model
Start from supabase/schema.sql. Upgrade it for single-user auth:
- Add user_id (uuid) to clips, settings, platform_accounts, and post_log.
- RLS policies: a row is readable and writable only when user_id = auth.uid().
- The Cron job uses the service role, which bypasses RLS, and acts on the owner's accounts.

Tables:
- clips: id, user_id, title, caption, hashtags, video_path, created_at
- clip_platforms: clip_id, platform, enabled, link, last_posted_at, times_posted
- settings: user_id, platform, cadence_days, active
- platform_accounts: user_id, platform, external_id, access_token, refresh_token, expires_at, meta
- post_log: id, user_id, clip_id, platform, posted_at, status, external_post_id, error

## Rotation rule (keep this exact)
For a platform, the next clip is the enabled one with the oldest last_posted_at, with never-posted
clips first. The platform is due when no clip has posted yet, or when now minus the most recent
post for that platform is at least cadence_days. The Cron posts at most one clip per platform per run.

## Screens
1. Sign in — Supabase magic link. Only the owner's email gets in.
2. Home — a platform switcher (YouTube / Instagram / TikTok). The whole view reflects the selected
   platform: its cadence control, an "Up next" hero card with the clip and a copy-caption button,
   the upcoming queue, and the library with per-platform badges. Match reference/recirculate-ui.jsx
   for layout and feel. Wire it to Supabase instead of browser storage.
3. Add / edit clip — title, caption, hashtags, platform toggles, optional per-platform link, and an
   upload field that puts the video into Supabase Storage and saves its path.
4. Connect accounts — buttons that run the OAuth connect flow for each platform and show connection
   status. Reuse app/api/connect and app/api/callback.
5. History — read post_log so the owner sees what posted, when, and any errors.

## Phases
Phase 1 — Foundation. Next.js app, Tailwind, Supabase client, Auth, upgraded schema with RLS,
library CRUD, video upload to Storage, and the full rotation UI in confirm-to-post mode (no auto
posting yet). Deploy to Vercel as an installable PWA with manifest and icons. Done when the owner
can add clips, see the correct "Up next" per platform, and mark posts by hand.

Phase 2 — Connect accounts. The OAuth connect and callback flows for all three platforms, storing
tokens in platform_accounts, with token refresh. Done when all three show as connected.

Phase 3 — Auto-poster. The daily Cron from app/api/cron, guarded by CRON_SECRET. Turn on one
platform at a time, starting with YouTube (the lowest-friction gate). Done when a due clip posts on
its own and the rotation advances.

Phase 4 — Polish. Push notifications for "time to post," the history screen, empty states, and error
surfacing. Default TikTok to private until the audit clears.

## Definition of done for the whole build
The owner installs the app to his home screen, adds clips once, connects his accounts, and his best
clips recirculate across all three platforms on their own cadences with no new content required.
