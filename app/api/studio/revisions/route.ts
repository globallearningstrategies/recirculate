import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { studioOwner, ownedAsset } from "@/lib/studio-auth";
import { validateExcerpts } from "@/lib/studio";

// A correction makes a new draft; existing downloads and scheduled clips stay intact.
export async function POST(req: Request) {
  try {
    const { user } = await studioOwner();
    const { jobId, lyrics } = await req.json();
    const { data: source, error } = await db.from("studio_jobs").select("*").eq("id", jobId).eq("user_id", user.id).single();
    if (error || !source) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    if (source.status === "rendering") throw new Error("Wait for this render to finish before editing its lyrics.");
    const [excerpt] = validateExcerpts([{ start: 0, duration: source.duration_seconds, lyrics }], source.duration_seconds);
    if (![source.audio_path, source.artwork_path, source.performance_path].filter(Boolean).every(p => ownedAsset(p, user.id))) throw new Error("Invalid song asset.");
    const { data: job, error: insertError } = await db.from("studio_jobs").insert({
      user_id: user.id, batch_id: source.batch_id, song_id: source.song_id,
      title: source.title, treatment: source.treatment,
      start_seconds: source.start_seconds, duration_seconds: source.duration_seconds,
      audio_path: source.audio_path, artwork_path: source.artwork_path, performance_path: source.performance_path,
      lyrics: excerpt.lyrics, status: "queued",
    }).select("id").single();
    if (insertError) throw insertError;
    return NextResponse.json({ jobId: job.id });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Could not save corrected lyrics." }, { status: e.message === "Not authorized." ? 401 : 400 }); }
}
