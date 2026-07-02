import { NextResponse } from "next/server";
import { db, BUCKET } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { listReels, parseCaption, deriveTitle, downloadVideo, downloadBytes, type IGMedia } from "@/lib/instagram";
import { getInstagramToken } from "@/lib/connections";

// Downloads run inline (CDN bytes), so give the import room to work through a
// back-catalog without timing out.
export const runtime = "nodejs";
export const maxDuration = 300;

// Best-effort thumbnail: grabs the reel's cover image and stores it next to the
// video. Returns the storage path, or null if anything goes wrong (a clip
// without a thumb just falls back to the video element in the UI).
async function storeThumb(userId: string, reel: IGMedia): Promise<string | null> {
  if (!reel.thumbnail_url) return null;
  try {
    const { bytes, contentType } = await downloadBytes(reel.thumbnail_url, "image/jpeg");
    const path = `${userId}/thumbs/ig_${reel.id}.jpg`;
    const up = await db.storage.from(BUCKET).upload(path, Buffer.from(bytes), {
      contentType,
      cacheControl: "31536000",
      upsert: true,
    });
    if (up.error) return null;
    return path;
  } catch {
    return null;
  }
}

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

  // 2) Get a valid token (auto-refreshes the long-lived token when due).
  let token: string;
  try {
    token = await getInstagramToken(userId);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Instagram connection error." }, { status: 400 });
  }

  // 3) Pull the reel list and what we already have (dedupe + thumb backfill).
  let reels: IGMedia[];
  try {
    reels = await listReels(token);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Instagram API error: ${e?.message || "unknown"}` },
      { status: 502 }
    );
  }

  const { data: existingRows } = await db
    .from("clips")
    .select("id, external_id, thumb_path")
    .eq("user_id", userId)
    .not("external_id", "is", null);
  const existing = new Map((existingRows ?? []).map((r) => [r.external_id as string, r]));

  let added = 0;
  let skipped = 0;
  let thumbed = 0;
  const errors: { id: string; error: string }[] = [];

  // 4) Per reel: skip if known (backfilling its thumbnail if missing), else
  //    download bytes NOW (signed URLs expire fast), upload to the same bucket,
  //    and create a normal clip with platform toggles off.
  for (const reel of reels) {
    const known = existing.get(reel.id);
    if (known) {
      skipped++;
      if (!known.thumb_path) {
        const thumbPath = await storeThumb(userId, reel);
        if (thumbPath) {
          await db.from("clips").update({ thumb_path: thumbPath }).eq("id", known.id);
          thumbed++;
        }
      }
      continue;
    }
    if (!reel.media_url) {
      errors.push({ id: reel.id, error: "no media_url" });
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

      const thumbPath = await storeThumb(userId, reel);
      const { caption, hashtags } = parseCaption(reel.caption);
      const insert = await db.from("clips").insert({
        user_id: userId,
        title: deriveTitle(caption || reel.caption || ""),
        caption,
        hashtags,
        video_path: path,
        thumb_path: thumbPath,
        source: "instagram",
        external_id: reel.id,
        status: "imported",
        posted_at: reel.timestamp ?? null,
        licensed_audio: false, // IG API exposes no audio attribution; flag manually in the library
      });

      if (insert.error) {
        // Unique index lost a race (already imported): clean up the orphan upload.
        await db.storage.from(BUCKET).remove([path, ...(thumbPath ? [thumbPath] : [])]);
        if (insert.error.code === "23505") skipped++;
        else errors.push({ id: reel.id, error: insert.error.message });
        continue;
      }

      added++;
    } catch (e: any) {
      errors.push({ id: reel.id, error: e?.message || "import failed" });
    }
  }

  return NextResponse.json({ added, skipped, thumbed, failed: errors.length, errors });
}
