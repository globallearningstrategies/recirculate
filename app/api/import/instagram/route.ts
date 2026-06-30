import { NextResponse } from "next/server";
import { db, BUCKET } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { listReels, parseCaption, deriveTitle, downloadVideo } from "@/lib/instagram";

// Downloads run inline (CDN bytes), so give the import room to work through a
// back-catalog without timing out.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  // 1) Authenticate the request as the owner (RLS-bound session client), then do
  //    the privileged work (read token, upload, insert) with the service role.
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();

  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const userId = user.id;

  // The import does privileged work (read token, upload, insert) with the service role.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Server not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel." },
      { status: 500 }
    );
  }

  // 2) Read the Instagram connection (token lives per-user, not in env).
  const { data: conn } = await db
    .from("social_connections")
    .select("access_token, token_expires_at, username")
    .eq("user_id", userId)
    .eq("platform", "instagram")
    .maybeSingle();

  if (!conn?.access_token) {
    return NextResponse.json(
      { error: "Connect Instagram first — no instagram row in social_connections." },
      { status: 400 }
    );
  }
  if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "Your Instagram token has expired. Re-insert a fresh long-lived token." },
      { status: 400 }
    );
  }

  // 3) Pull the reel list and the set of already-imported ids (dedupe).
  let reels;
  try {
    reels = await listReels(conn.access_token);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Instagram API error: ${e?.message || "unknown"}` },
      { status: 502 }
    );
  }

  const { data: existingRows } = await db
    .from("clips")
    .select("external_id")
    .eq("user_id", userId)
    .not("external_id", "is", null);
  const seen = new Set((existingRows ?? []).map((r) => r.external_id as string));

  let added = 0;
  let skipped = 0;
  const errors: { id: string; error: string }[] = [];

  // 4) Per reel: skip if known, else download bytes NOW (signed URL expires fast),
  //    upload to the same bucket, and create a normal clip with toggles off.
  for (const reel of reels) {
    if (seen.has(reel.id)) {
      skipped++;
      continue;
    }
    if (!reel.media_url) {
      errors.push({ id: reel.id, error: "no media_url" });
      skipped++;
      continue;
    }

    const path = `${userId}/${Date.now()}-ig_${reel.id}.mp4`;
    try {
      const { bytes, contentType } = await downloadVideo(reel.media_url);
      const up = await db.storage.from(BUCKET).upload(path, Buffer.from(bytes), {
        contentType: contentType || "video/mp4",
        cacheControl: "3600",
        upsert: false,
      });
      if (up.error) throw new Error(up.error.message);

      const { caption, hashtags } = parseCaption(reel.caption);
      const insert = await db.from("clips").insert({
        user_id: userId,
        title: deriveTitle(caption || reel.caption || ""),
        caption,
        hashtags,
        video_path: path,
        source: "instagram",
        external_id: reel.id,
        status: "imported",
        posted_at: reel.timestamp ?? null,
        licensed_audio: false, // IG API exposes no audio attribution; flag manually in the library
      });

      if (insert.error) {
        // Unique index lost a race (already imported): clean up the orphan upload.
        await db.storage.from(BUCKET).remove([path]);
        if (insert.error.code === "23505") {
          skipped++;
        } else {
          errors.push({ id: reel.id, error: insert.error.message });
          skipped++;
        }
        continue;
      }

      seen.add(reel.id);
      added++;
    } catch (e: any) {
      errors.push({ id: reel.id, error: e?.message || "import failed" });
      skipped++;
    }
  }

  return NextResponse.json({ added, skipped, errors });
}
