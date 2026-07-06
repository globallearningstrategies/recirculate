import { NextResponse } from "next/server";
import { db, BUCKET } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { renderLyricVideo, STYLES } from "@/lib/lyric-video";

export const runtime = "nodejs";
export const maxDuration = 300; // rendering a minute of video takes a minute-ish

// Generates a lyric video for a song and drops it into the clip library:
// body { songId, audioPath, lyrics, start?, duration?, style?, licensedAudio? }.
// The audio file is uploaded to storage by the client first; the new clip has
// all platform toggles off — the owner decides where it goes.
export async function POST(req: Request) {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const userId = user.id;

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const { songId, audioPath, lyrics } = body;
  if (!songId || !lyrics?.trim() || typeof audioPath !== "string" || !audioPath.startsWith(`${userId}/`)) {
    return NextResponse.json({ error: "Need a song, an audio file, and lyrics." }, { status: 400 });
  }
  const start = Math.max(0, Number(body.start) || 0);
  const duration = Math.min(90, Math.max(10, Number(body.duration) || 30));
  const style = STYLES[body.style] ? body.style : "midnight";

  const { data: song } = await db
    .from("songs")
    .select("id, user_id, title")
    .eq("id", songId)
    .single();
  if (!song || song.user_id !== userId) {
    return NextResponse.json({ error: "Song not found." }, { status: 404 });
  }

  const { data: audioBlob, error: dlErr } = await db.storage.from(BUCKET).download(audioPath);
  if (dlErr || !audioBlob) {
    return NextResponse.json({ error: "Couldn't read the uploaded audio file." }, { status: 400 });
  }
  const audio = Buffer.from(await audioBlob.arrayBuffer());
  const audioExt = audioPath.split(".").pop() ?? "mp3";

  let video: Buffer, thumb: Buffer;
  try {
    ({ video, thumb } = await renderLyricVideo({
      audio,
      audioExt,
      title: song.title,
      lyrics,
      start,
      duration,
      style,
    }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Rendering failed." }, { status: 500 });
  }

  const stamp = Date.now();
  const videoPath = `${userId}/lyric_${stamp}.mp4`;
  const thumbPath = `${userId}/thumbs/lyric_${stamp}.jpg`;
  const up1 = await db.storage.from(BUCKET).upload(videoPath, video, { contentType: "video/mp4" });
  if (up1.error) return NextResponse.json({ error: `Upload failed: ${up1.error.message}` }, { status: 500 });
  // Only reference the thumb if it actually landed — a clip pointing at a
  // missing file renders as a broken image instead of falling back.
  let thumbOk = false;
  try {
    const up2 = await db.storage.from(BUCKET).upload(thumbPath, thumb, { contentType: "image/jpeg" });
    thumbOk = !up2.error;
  } catch {}

  const { data: clip, error: insErr } = await db
    .from("clips")
    .insert({
      user_id: userId,
      title: `${song.title} — lyric video`,
      caption: "",
      hashtags: "",
      video_path: videoPath,
      thumb_path: thumbOk ? thumbPath : null,
      source: "lyric",
      licensed_audio: !!body.licensedAudio,
      song_id: song.id,
    })
    .select("id")
    .single();
  if (insErr || !clip) {
    return NextResponse.json({ error: insErr?.message || "Couldn't save the clip." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, clipId: clip.id });
}
