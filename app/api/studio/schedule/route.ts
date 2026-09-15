import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { studioOwner } from "@/lib/studio-auth";
import { dailySchedule } from "@/lib/studio";

export async function POST(req: Request) {
  try {
    const { user } = await studioOwner();
    const { jobIds, platform, accountId, firstDate } = await req.json();
    if (!Array.isArray(jobIds) || jobIds.length < 1 || jobIds.length > 12 || new Set(jobIds).size !== jobIds.length || !["instagram", "youtube"].includes(platform)) throw new Error("Choose 1–12 completed clips and an Instagram or YouTube destination.");
    const dates = dailySchedule(firstDate, jobIds.length);
    const { data: connection } = await db.from("social_connections").select("external_user_id,username").eq("user_id", user.id).eq("platform", platform).single();
    if (!accountId || !connection || connection.external_user_id !== accountId) throw new Error("The connected account changed. Refresh and choose the destination again.");
    const { data: jobs, error } = await db.from("studio_jobs").select("id,clip_id,status").eq("user_id", user.id).in("id", jobIds);
    if (error || jobs?.length !== jobIds.length || jobs.some((job) => job.status !== "ready" || !job.clip_id)) throw new Error("Every selected clip must finish rendering first.");
    const rows = jobIds.map((id: string, i: number) => ({ user_id: user.id, clip_id: jobs.find((j) => j.id === id)!.clip_id, studio_job_id: id, platform, destination_account_id: accountId, run_at: dates[i], status: "pending" }));
    const { error: insertError } = await db.from("scheduled_posts").insert(rows);
    if (insertError?.code === "23505") throw new Error("One of these clips is already scheduled or published to this platform.");
    if (insertError) throw insertError;
    return NextResponse.json({ ok: true, count: rows.length, destination: connection.username, dates });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: e.message === "Not authorized." ? 401 : 400 }); }
}
