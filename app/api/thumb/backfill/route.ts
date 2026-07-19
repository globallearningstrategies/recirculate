import { NextResponse } from "next/server";
import { db, BUCKET } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { extractThumb } from "@/lib/lyric-video";

export const runtime = "nodejs";
export const maxDuration = 300;

// Stop starting new clips this long before Vercel's maxDuration kills the
// function, so an in-flight extraction can finish and the response gets out.
const DEADLINE_MS = 240_000;

// Generates thumbnails for clips that have a video but no thumb — clips
// uploaded or imported before auto-thumbnailing existed. One call works the
// whole backlog within its time budget (videos are processed one at a time,
// so memory stays bounded), and it keeps running server-side even if the
// phone that triggered it locks or backgrounds the app mid-run.
export async function POST() {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const started = Date.now();
  const { data: clips } = await db
    .from("clips")
    .select("id, video_path")
    .eq("user_id", user.id)
    .is("thumb_path", null)
    .not("video_path", "is", null)
    .order("created_at", { ascending: true });

  const missing = clips?.length ?? 0;
  let done = 0;
  let failed = 0;

  for (const clip of clips ?? []) {
    if (Date.now() - started > DEADLINE_MS) break;
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
    } catch (e: any) {
      failed++; // stays thumb_path-null; the client stops once a pass makes no progress
      console.error(`thumb backfill failed for clip ${clip.id}:`, e?.message || e);
    }
  }

  return NextResponse.json({ ok: true, done, failed, remaining: Math.max(0, missing - done - failed) });
}
