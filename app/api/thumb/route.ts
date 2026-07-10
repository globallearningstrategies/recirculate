import { NextResponse } from "next/server";
import { db, BUCKET } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { extractThumb } from "@/lib/lyric-video";

export const runtime = "nodejs";
export const maxDuration = 300;

// Regenerates a clip's thumbnail from its (possibly just-replaced) video.
export async function POST(req: Request) {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const clipId = body?.clipId;
  if (!clipId) return NextResponse.json({ error: "Missing clipId." }, { status: 400 });

  const { data: clip } = await db
    .from("clips")
    .select("id, user_id, video_path, thumb_path")
    .eq("id", clipId)
    .single();
  if (!clip || clip.user_id !== user.id) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  if (!clip.video_path) return NextResponse.json({ error: "Clip has no video." }, { status: 400 });

  const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(clip.video_path);
  if (dlErr || !blob) return NextResponse.json({ error: "Couldn't read the video." }, { status: 500 });

  let thumb: Buffer;
  try {
    thumb = await extractThumb(Buffer.from(await blob.arrayBuffer()), clip.video_path.split(".").pop() ?? "mp4");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Thumbnail extraction failed." }, { status: 500 });
  }

  const thumbPath = `${user.id}/thumbs/clip_${clipId}_${Date.now()}.jpg`;
  const up = await db.storage.from(BUCKET).upload(thumbPath, thumb, { contentType: "image/jpeg" });
  if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });

  if (clip.thumb_path) await db.storage.from(BUCKET).remove([clip.thumb_path]).then(() => {}, () => {});
  await db.from("clips").update({ thumb_path: thumbPath }).eq("id", clipId);

  return NextResponse.json({ ok: true, thumbPath });
}
