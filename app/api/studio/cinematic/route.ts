import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/supabase";
import { studioOwner, ownedAsset } from "@/lib/studio-auth";
import { ASSET_BUCKET, MAX_ASSET_BYTES } from "@/lib/studio";
import { cinematicPlan, CINEMATIC_VERSION } from "@/lib/cinematic";
import { runway, downloadRunwayVideo } from "@/lib/runway";
import { assembleScenes } from "@/lib/cinematic-assembly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function failure(e: any) {
  return NextResponse.json({ error: e.message || "Could not complete this step. Your saved scenes are kept." }, { status: e.message === "Not authorized." ? 401 : 400 });
}
async function list(userId: string) {
  const { data, error } = await db.from("cinematic_runs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error("Could not load cinematic projects.");
  return Promise.all((data || []).map(async r => {
    const { data: signed } = r.background_path ? await db.storage.from(ASSET_BUCKET).createSignedUrl(r.background_path, 3600) : { data: null };
    return { id: r.id, title: r.source?.title || "Five-second visual test", status: r.status, error: r.error, plan: r.plan,
      done: r.scenes.filter((s: any) => s.path).length, preview: signed?.signedUrl,
      batchId: r.source?.batch_id, jobId: r.source && r.status === "ready" ? r.id : null,
      taskIds: r.scenes.map((s: any) => s.taskId).filter(Boolean), created_at: r.created_at };
  }));
}
export async function GET() {
  try {
    const { user } = await studioOwner();
    let connection = "", credits: number | null = null;
    try { const org = await runway("organization"); credits = org.creditBalance; connection = "Connected"; }
    catch (e: any) { connection = e.message; }
    return NextResponse.json({ connection, credits, runs: await list(user.id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return failure(e); }
}

export async function POST(req: Request) {
  try {
    const { user } = await studioOwner();
    const body = await req.json();
    if (!uuid(body.id)) throw new Error("Invalid cinematic request.");
    if (body.action === "create") {
      // Stable browser request ID makes a double tap or a lost response safe.
      const { data: previous } = await db.from("cinematic_runs").select("id").eq("id", body.id).eq("user_id", user.id).maybeSingle();
      if (previous) return NextResponse.json({ id: previous.id });
      let source = null;
      if (body.jobId) {
        if (!uuid(body.jobId)) throw new Error("Invalid draft.");
        const { data } = await db.from("studio_jobs").select("song_id,batch_id,title,start_seconds,duration_seconds,lyrics,audio_path,artwork_path").eq("id", body.jobId).eq("user_id", user.id).single();
        if (!data || !ownedAsset(data.audio_path, user.id)) throw new Error("Draft not found.");
        source = data;
      }
      const plan = cinematicPlan(source?.duration_seconds || 5);
      if (body.confirmed !== true || body.version !== CINEMATIC_VERSION || body.credits !== plan.credits) throw new Error("Review the current price and confirm generation first.");
      const org = await runway("organization");
      if (!Number.isFinite(org.creditBalance) || org.creditBalance < plan.credits) throw new Error(`This project needs ${plan.credits} Runway API credits. Add credits in the developer portal first.`);
      const { error } = await db.from("cinematic_runs").insert({ id: body.id, user_id: user.id, source, plan, scenes: plan.scenes.map(() => ({ state: "queued" })) });
      if (error) throw new Error(error.code === "23505" ? "A cinematic project is already in progress. Resume it below." : "Could not save this project. No generation was started.");
      return NextResponse.json({ id: body.id });
    }
    if (body.action !== "advance") throw new Error("Unknown cinematic action.");
    const { data: found } = await db.from("cinematic_runs").select("*").eq("id", body.id).eq("user_id", user.id).single();
    if (!found) throw new Error("Cinematic project not found.");
    if (found.status !== "active") return NextResponse.json({ status: found.status, jobId: found.source && found.status === "ready" ? found.id : null });
    if (found.lock_until && Date.parse(found.lock_until) > Date.now()) return NextResponse.json({ status: "active" });
    const token = randomUUID();
    let query = db.from("cinematic_runs").update({ lock_id: token, lock_until: new Date(Date.now() + 360000).toISOString() }).eq("id", found.id).eq("user_id", user.id).eq("status", "active");
    query = found.lock_id ? query.eq("lock_id", found.lock_id) : query.is("lock_id", null);
    const { data: r, error: claimError } = await query.select().maybeSingle();
    if (claimError) throw new Error("Could not claim this project. Try Resume again.");
    if (!r) return NextResponse.json({ status: "active" });
    const save = async (values: Record<string, unknown>) => {
      const { data, error } = await db.from("cinematic_runs").update(values).eq("id", r.id).eq("user_id", user.id).eq("lock_id", token).select("id").maybeSingle();
      if (error || !data) throw new Error("Could not save progress. Resume later; do not start a replacement generation.");
    };
    try {
      const index = r.scenes.findIndex((s: any) => !s.path);
      if (index >= 0) {
        const scene = r.scenes[index];
        if (scene.state === "submitting" && !scene.taskId) {
          await save({ status: "attention", error: "The submission result is uncertain. To prevent another charge, this project has stopped. Check Runway’s developer task history before creating a replacement." });
          return NextResponse.json({ status: "attention" });
        }
        if (!scene.taskId) {
          // Persist the intent BEFORE the non-idempotent paid call. Never auto-retry it.
          scene.state = "submitting"; await save({ scenes: r.scenes, error: null });
          try {
            const task = await runway("text_to_video", { model: "gen4.5", duration: 5, ratio: "720:1280", promptText: r.plan.scenes[index].prompt });
            if (!uuid(task.id)) throw new Error("Runway returned an invalid task ID.");
            scene.taskId = task.id; scene.state = "pending";
            await save({ scenes: r.scenes });
          } catch (e: any) {
            await save({ status: "attention", error: `${e.message} Submission was not retried. Check Runway task history before starting a replacement.` });
            return NextResponse.json({ status: "attention" });
          }
        } else {
          const task = await runway(`tasks/${scene.taskId}`);
          if (["FAILED", "CANCELLED"].includes(task.status)) {
            await save({ status: "attention", error: `Runway ${task.status === "FAILED" ? "could not generate" : "canceled"} scene ${index + 1}. Earlier scenes are saved. No paid retry was started. Check task ${scene.taskId} in Runway.` });
            return NextResponse.json({ status: "attention" });
          }
          if (task.status === "SUCCEEDED") {
            if (!task.output?.[0]) throw new Error("Runway returned no video. Check its task history.");
            const video = await downloadRunwayVideo(task.output[0]);
            const assetPath = `${user.id}/cinematic/${r.id}/scene-${index}.mp4`;
            const { error } = await db.storage.from(ASSET_BUCKET).upload(assetPath, video, { contentType: "video/mp4", upsert: true });
            if (error) throw new Error("Could not save the generated scene. Resume to retry saving; it will not be generated again.");
            scene.path = assetPath; scene.state = "ready"; scene.credits = task.cost?.credits;
            await save({ scenes: r.scenes, error: null });
          }
        }
        return NextResponse.json({ status: "active" });
      }
      const backgroundPath = `${user.id}/cinematic/${r.id}/background.mp4`;
      if (!r.background_path) {
        const buffers: Buffer[] = [];
        for (const scene of r.scenes) {
          if (!ownedAsset(scene.path, user.id)) throw new Error("Invalid scene path.");
          const { data, error } = await db.storage.from(ASSET_BUCKET).download(scene.path);
          if (error || !data || data.size > MAX_ASSET_BYTES) throw new Error("Could not load a saved scene.");
          buffers.push(Buffer.from(await data.arrayBuffer()));
        }
        const background = await assembleScenes(buffers, r.plan.duration);
        if (background.length > MAX_ASSET_BYTES) throw new Error("The assembled background exceeds 50 MB.");
        const { error } = await db.storage.from(ASSET_BUCKET).upload(backgroundPath, background, { contentType: "video/mp4", upsert: true });
        if (error) throw new Error("Could not save the background. Resume to retry assembly without new generation charges.");
        await save({ background_path: backgroundPath });
      }
      if (r.source) {
        // Ignore duplicates: never reset an already rendered or edited job on recovery.
        const { error } = await db.from("studio_jobs").upsert({ ...r.source, id: r.id, user_id: user.id,
          title: `${r.source.title.split(" · ")[0]} · Cinematic AI`, treatment: "cinematic", performance_path: backgroundPath,
        }, { onConflict: "id", ignoreDuplicates: true });
        if (error) throw new Error("Footage is saved. Resume to finish creating the lyric-video draft.");
      }
      await save({ status: "ready", error: null });
      return NextResponse.json({ status: "ready", jobId: r.source ? r.id : null });
    } finally {
      await db.from("cinematic_runs").update({ lock_id: null, lock_until: null }).eq("id", r.id).eq("user_id", user.id).eq("lock_id", token);
    }
  } catch (e) { return failure(e); }
}
