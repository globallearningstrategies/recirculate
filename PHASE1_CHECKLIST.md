# Phase 1 Checklist — Foundation

Build these in order. Check each off as it lands. Use the existing package.json — run
`npm install`, do not re-pick versions. Stop for review when the Done line is met.

## Scaffold
- [ ] Confirm Node 18.18+ and run `npm install`.
- [ ] Create app/layout.tsx that imports app/globals.css, sets the standalone PWA meta, links
      public/manifest.json, and sets viewport plus theme-color #15101B.
- [ ] Add apple-mobile-web-app-capable and apple-touch-icon meta so it installs to the iPhone
      home screen.
- [ ] Generate real icon-192.png and icon-512.png in public/ (plain placeholder is fine for now).
- [ ] Confirm `npm run dev` serves a blank styled page with Tailwind working.

## Supabase and auth
- [ ] Add lib/supabase-browser.ts and lib/supabase-server.ts using @supabase/ssr.
- [ ] Add middleware.ts to refresh the auth session on each request.
- [ ] Build a magic-link sign-in page. Allow only the owner's email (env: OWNER_EMAIL).
- [ ] Wrap the app so an unauthenticated visitor only ever sees the sign-in page.

## Schema and security
- [ ] Extend supabase/schema.sql: add user_id (uuid) to clips, settings, platform_accounts,
      and post_log.
- [ ] Add RLS policies: a row is readable and writable only when user_id = auth.uid().
- [ ] Seed one settings row per platform for the owner (youtube 7, instagram 5, tiktok 4).
- [ ] Run the schema against the Supabase project.

## Storage
- [ ] Create a public Storage bucket named clips.
- [ ] Add an upload helper that puts a video into the bucket and returns its path.

## Library CRUD
- [ ] List the owner's clips from Supabase.
- [ ] Add a clip: title, caption, hashtags, platform toggles, optional per-platform link, and a
      video upload that saves video_path. Write the matching clip_platforms rows.
- [ ] Edit and delete a clip.

## Rotation UI
- [ ] Port reference/recirculate-ui.jsx to a TypeScript component wired to Supabase, not browser
      storage.
- [ ] Keep the platform switcher, the per-platform cadence control (persists to settings), the
      Up next hero, the upcoming queue, and the library badges.
- [ ] Keep the rotation rule exact: oldest last_posted_at first, never-posted ahead of all.
- [ ] Mark as posted writes last_posted_at, increments times_posted, and inserts a post_log row.
      No real platform posting in this phase.

## Deploy
- [ ] Push to Vercel. Confirm the app installs to the home screen and opens full-screen.

## Done
The owner signs in, adds clips with video uploads, sees the correct Up next per platform on its own
cadence, and marks posts by hand. No platform APIs are touched yet. Stop here for review.
