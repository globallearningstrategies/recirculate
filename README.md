# Recirculate — auto-posting backend

A Vercel + Supabase backend that publishes your next-due short-form clip to YouTube, Instagram,
and TikTok on a schedule. It runs the same rotation rule as the Recirculate app: for each platform,
when the cadence is up, it posts the clip that has gone the longest without being posted there.

## The honest part: three approval gates

The code is the easy bit. Each platform makes you clear its own gate before real public posting works.

| Platform | What works | The gate |
|----------|-----------|----------|
| YouTube Shorts | Public upload via the Data API | OAuth app must be moved to "In production." While it is in "Testing," refresh tokens expire after 7 days. Upload quota is ~6/day by default. |
| Instagram Reels | Container + publish via Graph API | Needs an IG Business/Creator account linked to a Facebook Page, and App Review for content publishing. 25 posts/day. |
| TikTok | Direct post via Content Posting API | Until your app passes TikTok's audit, posts are forced to SELF_ONLY (private). PULL_FROM_URL also needs your storage domain verified in the dev portal. |

Until a gate clears, keep that platform on confirm-to-post in the app. Flip it on here once it does.

## How it works

1. `vercel.json` runs `/api/cron` once a day.
2. The cron checks each platform in `settings`: is it `active`, and is it past its `cadence_days`?
3. If due, `nextDueClip` picks the least-recently-posted enabled clip.
4. `getValidToken` refreshes the OAuth token if needed, then the platform publisher posts the video.
5. `markPosted` advances the rotation and writes to `post_log`.

## Setup

1. `npm install @supabase/supabase-js googleapis` (Next.js App Router project).
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Create a public Storage bucket named `clips` and upload your videos. Put each video's path in
   `clips.video_path`.
4. Copy `.env.example` to your Vercel project env and fill it in.
5. Register the OAuth apps (Google Cloud, Meta, TikTok) and set their redirect URIs to the
   `/api/callback/...` routes.
6. Connect each account once by visiting `/api/connect/youtube`, `/api/connect/instagram`,
   `/api/connect/tiktok` in a browser and approving. Tokens land in `platform_accounts`.
7. Add `CRON_SECRET` — Vercel Cron sends it as a bearer token, and the handler rejects anything else.

## Gotchas worth knowing up front

- YouTube: the "Testing" 7-day refresh-token expiry is the one that bites people. Verify and
  publish the app for durable tokens.
- Instagram: the video URL must be publicly reachable, which is why the `clips` bucket is public.
- TikTok: the refresh token rotates on every refresh — `getValidToken` already saves the new one.
- The cron posts at most one clip per platform per run, which keeps you well under every rate limit.

## Connecting the app

The Recirculate front end currently keeps its library in the browser (window.storage). To make
this backend the source of truth, point the app at these same Supabase tables — read `clips` /
`clip_platforms` / `settings`, and "Mark as posted" becomes optional once the cron handles it.
That wiring is the next step if you want it.
