import { NextResponse } from "next/server";
import { db, BUCKET } from "@/lib/supabase";
import { studioOwner, ownedAsset } from "@/lib/studio-auth";
import { renderStudioVideo } from "@/lib/studio-render";
import { ASSET_BUCKET, MAX_ASSET_BYTES } from "@/lib/studio";
import { parseCues } from "@/lib/lyric-cues";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  let claimedId: string | null = null;
  try {
    const { user } = await studioOwner();
    const { jobId } = await req.json();
    const { data: found } = await db.from("studio_jobs").select("*").eq("id", jobId).eq("user_id", user.id).single();
    if (!found) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    if (found.status === "ready") return NextResponse.json({ ok: true, clipId: found.clip_id });
    // Compare-and-set claim. A crashed request becomes retryable after ten minutes.
    if (found.status === "rendering" && Date.now() - Date.parse(found.updated_at) < 600000) return NextResponse.json({ error: "This draft is still rendering. Refresh in a few minutes." }, { status: 409 });
    const { data: job, error: claimError } = await db.from("studio_jobs").update({ status: "rendering", error: null, updated_at: new Date().toISOString() }).eq("id", jobId).eq("user_id", user.id).eq("updated_at", found.updated_at).select().maybeSingle();
    if (claimError || !job) return NextResponse.json({ error: "Another request is rendering this draft." }, { status: 409 });
    claimedId = job.id;
    const download = async (assetPath: string) => {
      if (!ownedAsset(assetPath, user.id)) throw new Error("Invalid asset path.");
      const { data, error } = await db.storage.from(ASSET_BUCKET).download(assetPath);
      if (error || !data) throw new Error("A source file is missing. Upload it again and create a new batch.");
      if (data.size > MAX_ASSET_BYTES) throw new Error("Source files must be under 50 MB.");
      return Buffer.from(await data.arrayBuffer());
    };
    const audio = await download(job.audio_path);
    const background = job.treatment === "artwork" ? await download(job.artwork_path) : job.treatment === "performance" ? await download(job.performance_path) : undefined;
    const { video, thumb } = await renderStudioVideo({ audio, background, treatment: job.treatment, title: job.title.split(" · ")[0], lyrics: job.lyrics, start: job.start_seconds, duration: job.duration_seconds });
    const videoPath = `${user.id}/studio/${job.id}.mp4`, thumbPath = `${user.id}/studio/${job.id}.jpg`;
    const videoUpload = await db.storage.from(BUCKET).upload(videoPath, video, { contentType: "video/mp4", upsert: true });
    if (videoUpload.error) throw videoUpload.error;
    const thumbnail = await db.storage.from(BUCKET).upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: true });
    // Deterministic ID prevents duplicate clips when a render response is lost.
    const { error: clipError } = await db.from("clips").upsert({ id: job.id, user_id: user.id, song_id: job.song_id, title: job.title, caption: parseCues(job.lyrics, job.duration_seconds)[0]?.text || "", source: "studio", video_path: videoPath, thumb_path: thumbnail.error ? null : thumbPath }, { onConflict: "id" });
    if (clipError) throw clipError;
    const { error: doneError } = await db.from("studio_jobs").update({ status: "ready", clip_id: job.id, error: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", user.id);
    if (doneError) throw doneError;
    return NextResponse.json({ ok: true, clipId: job.id });
  } catch (e: any) {
    const detail = String(e.message || "Rendering failed.");
    const message = detail.startsWith("ffmpeg") ? "The video renderer failed. Your song and draft are saved; tap Render / resume batch to retry." : detail;
    console.error("Studio render failed", { jobId: claimedId, error: detail });
    if (claimedId) await db.from("studio_jobs").update({ status: "error", error: message.slice(0, 600), updated_at: new Date().toISOString() }).eq("id", claimedId);
    return NextResponse.json({ error: message }, { status: e.message === "Not authorized." ? 401 : 500 });
  }
}
