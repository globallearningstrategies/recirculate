import { db } from "./supabase";
import { fetchMediaStats } from "./instagram";
import { getInstagramToken, getYouTubeToken } from "./connections";

const STALE_MS = 12 * 3600 * 1000; // don't re-fetch originals more than ~2×/day
const DAY = 86400000;

// Stats for the imported ORIGINAL Instagram reels — ranks the library by
// real audience data. One API round-trip per media, so respect staleness.
export async function refreshOriginals(userId: string): Promise<number> {
  const token = await getInstagramToken(userId);
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data: originals } = await db
    .from("clips")
    .select("id, external_id, metrics_at")
    .eq("user_id", userId)
    .eq("source", "instagram")
    .not("external_id", "is", null);
  let n = 0;
  for (const c of originals ?? []) {
    if (c.metrics_at && c.metrics_at > cutoff) continue;
    const s = await fetchMediaStats(token, c.external_id);
    if (s.views == null && s.likes == null) continue;
    await db
      .from("clips")
      .update({ source_views: s.views, source_likes: s.likes, metrics_at: new Date().toISOString() })
      .eq("id", c.id);
    n++;
  }
  return n;
}

// Stats for posts published through the app (post_log rows). Instagram is one
// call per media; YouTube batches 50 ids per call. TikTok needs the
// video.list scope — post-audit backlog.
export async function refreshPostMetrics(
  userId: string,
  sinceDays?: number
): Promise<{ igPosts: number; ytPosts: number; errors: string[] }> {
  const errors: string[] = [];
  let igPosts = 0;
  let ytPosts = 0;
  const since = sinceDays ? new Date(Date.now() - sinceDays * DAY).toISOString() : null;

  try {
    const token = await getInstagramToken(userId);
    let q = db
      .from("post_log")
      .select("id, external_post_id")
      .eq("user_id", userId)
      .eq("platform", "instagram")
      .eq("status", "success")
      .not("external_post_id", "is", null);
    if (since) q = q.gte("posted_at", since);
    const { data: igLog } = await q;
    for (const row of igLog ?? []) {
      const s = await fetchMediaStats(token, row.external_post_id);
      if (s.views == null && s.likes == null) continue;
      await db
        .from("post_log")
        .update({ views: s.views, likes: s.likes, comments: s.comments, metrics_at: new Date().toISOString() })
        .eq("id", row.id);
      igPosts++;
    }
  } catch (e: any) {
    errors.push(`Instagram: ${e?.message || "failed"}`);
  }

  try {
    let q = db
      .from("post_log")
      .select("id, external_post_id")
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .eq("status", "success")
      .not("external_post_id", "is", null);
    if (since) q = q.gte("posted_at", since);
    const { data: ytLog } = await q;
    if (ytLog?.length) {
      const token = await getYouTubeToken(userId);
      for (let i = 0; i < ytLog.length; i += 50) {
        const batch = ytLog.slice(i, i + 50);
        const ids = batch.map((r) => r.external_post_id).join(",");
        const res = await (
          await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json();
        const stats: Record<string, any> = {};
        for (const item of res.items ?? []) stats[item.id] = item.statistics;
        for (const row of batch) {
          const s = stats[row.external_post_id];
          if (!s) continue;
          await db
            .from("post_log")
            .update({
              views: s.viewCount != null ? Number(s.viewCount) : null,
              likes: s.likeCount != null ? Number(s.likeCount) : null,
              comments: s.commentCount != null ? Number(s.commentCount) : null,
              metrics_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          ytPosts++;
        }
      }
    }
  } catch (e: any) {
    errors.push(`YouTube: ${e?.message || "failed"}`);
  }

  return { igPosts, ytPosts, errors };
}
