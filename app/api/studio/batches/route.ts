import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db, BUCKET } from "@/lib/supabase";
import { studioOwner, ownedAsset } from "@/lib/studio-auth";
import { validateExcerpts, validateTreatments, TREATMENTS } from "@/lib/studio";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { user } = await studioOwner();
    const { data, error } = await db.from("studio_jobs").select("id,batch_id,song_id,title,treatment,start_seconds,duration_seconds,lyrics,status,error,clip_id,created_at,updated_at,clips(video_path,thumb_path)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(120);
    if (error) throw error;
    return NextResponse.json({ jobs: (data ?? []).map((job: any) => ({ ...job, clips: undefined, video_url: job.clips?.video_path ? db.storage.from(BUCKET).getPublicUrl(job.clips.video_path).data.publicUrl : undefined, thumb_url: job.clips?.thumb_path ? db.storage.from(BUCKET).getPublicUrl(job.clips.thumb_path).data.publicUrl : undefined })) });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: e.message === "Not authorized." ? 401 : 500 }); }
}

export async function POST(req: Request) {
  try {
    const { user } = await studioOwner();
    const body = await req.json();
    const { data: asset, error } = await db.from("song_assets").select("*,songs(title)").eq("song_id", body.songId).eq("user_id", user.id).single();
    if (error || !asset) throw new Error("Save this song’s audio first.");
    for (const path of [asset.audio_path, asset.artwork_path, asset.performance_path].filter(Boolean)) if (!ownedAsset(path, user.id)) throw new Error("Invalid song asset.");
    const excerpts = validateExcerpts(body.excerpts, asset.duration);
    const treatments = validateTreatments(body.treatments, asset);
    const batchId = randomUUID();
    const rows = excerpts.flatMap((excerpt, index) => treatments.map((treatment) => ({
      user_id: user.id, song_id: body.songId, batch_id: batchId,
      title: `${asset.songs.title} · ${index + 1} · ${TREATMENTS[treatment].label}`,
      treatment, start_seconds: excerpt.start, duration_seconds: excerpt.duration, lyrics: excerpt.lyrics,
      audio_path: asset.audio_path, artwork_path: asset.artwork_path, performance_path: asset.performance_path,
    })));
    const { error: insertError } = await db.from("studio_jobs").insert(rows);
    if (insertError) throw insertError;
    return NextResponse.json({ batchId, count: rows.length });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: e.message === "Not authorized." ? 401 : 400 }); }
}
