import { NextResponse } from "next/server";
import { db, BUCKET } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { extractThumb } from "@/lib/lyric-video";

export const runtime = "nodejs";
export const maxDuration = 300;

// Videos are pulled fully into memory for ffmpeg, so work in small batches;
// the client keeps calling until `remaining` hits zero.
const BATCH = 5;

// Generates thumbnails for clips that have a video but no thumb — clips
// uploaded or imported before auto-thumbnailing existed.
export async function POST() {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const { data: clips, count } = await db
    .from("clips")
    .select("id, video_path", { count: "exact" })
    .eq("user_id", user.id)
    .is("thumb_path", null)
    .not("video_path", "is", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  const missing = count ?? clips?.length ?? 0;
  let done = 0;
  let failed = 0;

  for (const clip of clips ?? []) {
    try {
      const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(clip.video_path!);
      if (dlErr || !blob) throw new Error(dlErr?.message || "download failed");

      const thumb = await extractThumb(
        Buffer.from(await blob.arrayBuffer()),
        clip.video_path!.split(".").pop() ?? "mp4"
      );

      const thumbPath = `${user.id}/thumbs/clip_${clip.id}_${Date.now()}.jpg`;
      const up = await db.storage.from(BUCKET).upload(thumbPath, thumb, { contentType: "image/jpeg" });
      if (up.error) throw new Error(up.error.message);

      await db.from("clips").update({ thumb_path: thumbPath }).eq("id", clip.id);
      done++;
    } catch {
      failed++; // stays thumb_path-null; the client stops once a pass makes no progress
    }
  }

  return NextResponse.json({ ok: true, done, failed, remaining: Math.max(0, missing - done - failed) });
}
