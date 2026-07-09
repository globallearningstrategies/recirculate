# CLAUDE.md — Recirculate

Project context for Claude Code. Read this first every session.

## What this is
Recirculate is a personal tool for one creator. It holds his short-form video clips and reposts the
next-due one to YouTube Shorts, Instagram Reels, and TikTok on a rotation, so he stops making new
content from scratch. Each platform rotates on its own cadence.

## Stack (do not change without asking)
- Next.js (App Router, TypeScript)
- Tailwind CSS
- Supabase: Postgres, Storage (video files), Auth (magic link)
- Vercel: hosting plus Cron for the auto-poster
- Ships as a PWA (installable to the iPhone home screen). This is a web app, not a native app.

## Architecture
- Front end: library manager and rotation viewer. Source of truth is Supabase, not browser storage.
- Backend: a daily Vercel Cron that, per platform, posts the least-recently-posted enabled clip
  when the cadence is up. One post per platform per run.
- Server-only code uses the Supabase service role and must never be imported into client code.

## The three platform gates (state these honestly in any UI copy)
- YouTube: public upload works. While the Google OAuth app is in Testing, refresh tokens die after
  7 days. Move the app to production for durable tokens. Quota ~6 uploads/day by default.
- Instagram: needs a Business/Creator account linked to a Facebook Page, plus App Review for
  content publishing. Video must sit at a public URL. 25 posts/day.
- TikTok: production audit was REJECTED on policy grounds (July 2026 — "personal or internal company
  use" is not supported by TikTok for Developers), so public API posting is off the table. TikTok is
  assisted-manual: the app copies the caption, hands the video to the share sheet, and records the
  post to advance the rotation. Sandbox API posting (private-only) still exists but is unused.

## Reuse, do not reinvent
The repo already contains a working backend scaffold (app/api, lib, supabase/schema.sql) and a
reference UI at reference/recirculate-ui.jsx. Build on these. The schema and rotation logic are
already correct — extend them, do not rewrite from zero.

## Rules
- Never commit secrets. All keys come from env (see .env.example).
- Keep the rotation rule identical wherever it appears.
- Auth-gate the whole app. It is single-user but must not be world-readable.
- TikTok publishes are assisted-manual (share sheet + mark posted) — never auto-post there via API.

## Phase 1
Start from PHASE1_CHECKLIST.md. Build that phase only, then stop for review.
