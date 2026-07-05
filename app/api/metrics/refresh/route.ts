import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { fetchMediaStats } from "@/lib/instagram";
import { getInstagramToken, getYouTubeToken } from "@/lib/connections";

export const runtime = "nodejs";
export const maxDuration = 300;

const STALE_MS = 12 * 3600 * 1000; // don't re-fetch originals more than ~2×/day

// Pulls performance numbers back from the platforms:
//  - Instagram: the imported ORIGINALS (ranks the library by real audience
//    data) and every reel republished through the app.
//  - YouTube: every Short published through the app (one batched call).
//  - TikTok: needs the video.list scope, which we deliberately left out of
//    the audit application — post-audit backlog.
export async function POST() {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const userId = user.id;
  const errors: string[] = [];
  let igOriginals = 0;
  let igPosts = 0;
  let ytPosts = 0;

  // ---- Instagram ----
  try {
    const token = await getInstagramToken(userId);

    const cutoff = new Date(Date.now() - STALE_MS).toISOString();
    const { data: originals } = await db
      .from("clips")
      .select("id, external_id, metrics_at")
      .eq("user_id", userId)
      .eq("source", "instagram")
      .not("external_id", "is", null);
    for (const c of originals ?? []) {
      if (c.metrics_at && c.metrics_at > cutoff) continue;
      const s = await fetchMediaStats(token, c.external_id);
      if (s.views == null && s.likes == null) continue;
      await db
        .from("clips")
        .update({ source_views: s.views, source_likes: s.likes, metrics_at: new Date().toISOString() })
        .eq("id", c.id);
      igOriginals++;
    }

    const { data: igLog } = await db
      .from("post_log")
      .select("id, external_post_id")
      .eq("user_id", userId)
      .eq("platform", "instagram")
      .eq("status", "success")
      .not("external_post_id", "is", null);
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

  // ---- YouTube ----
  try {
    const { data: ytLog } = await db
      .from("post_log")
      .select("id, external_post_id")
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .eq("status", "success")
      .not("external_post_id", "is", null);
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

  return NextResponse.json({
    instagram_originals: igOriginals,
    instagram_posts: igPosts,
    youtube_posts: ytPosts,
    tiktok: "needs video.list scope — after the audit",
    errors,
  });
}
