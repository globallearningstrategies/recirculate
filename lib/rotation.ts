import { db } from "./supabase";

const DAY = 86400000;

// Is this platform due to post, given its cadence and the last time anything went out on it.
export async function isDue(platform: string, cadenceDays: number): Promise<boolean> {
  const { data } = await db
    .from("clip_platforms")
    .select("last_posted_at")
    .eq("platform", platform)
    .eq("enabled", true)
    .order("last_posted_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const last = data?.[0]?.last_posted_at;
  if (!last) return true;
  return Date.now() - new Date(last).getTime() >= cadenceDays * DAY;
}

// The clip that should go out next: enabled for this platform, least-recently-posted first
// (never-posted clips sort ahead of everything).
export async function nextDueClip(platform: string) {
  const { data } = await db
    .from("clip_platforms")
    .select("clip_id, link, clips(id, title, caption, hashtags, video_path)")
    .eq("platform", platform)
    .eq("enabled", true)
    .order("last_posted_at", { ascending: true, nullsFirst: true })
    .limit(1);
  if (!data?.length) return null;
  const row: any = data[0];
  return { ...row.clips, link: row.link };
}

// Record a successful post: advance the rotation and write the log.
export async function markPosted(clipId: string, platform: string, externalId: string) {
  const { data: cur } = await db
    .from("clip_platforms")
    .select("times_posted")
    .eq("clip_id", clipId)
    .eq("platform", platform)
    .single();
  await db
    .from("clip_platforms")
    .update({ last_posted_at: new Date().toISOString(), times_posted: (cur?.times_posted || 0) + 1 })
    .eq("clip_id", clipId)
    .eq("platform", platform);
  await db.from("post_log").insert({ clip_id: clipId, platform, status: "success", external_post_id: externalId });
}

export async function logError(clipId: string | null, platform: string, error: string) {
  await db.from("post_log").insert({ clip_id: clipId, platform, status: "error", error });
}

export function caption(clip: { caption?: string; hashtags?: string }): string {
  return [clip.caption, clip.hashtags].filter(Boolean).join("\n\n");
}
