import { db, BUCKET } from "./supabase";
import { publishReel } from "./instagram";
import { publishYouTube } from "./publishers/youtube";
import { publishTikTok } from "./publishers/tiktok";
import { getInstagramToken, getYouTubeToken, getTikTokToken } from "./connections";
import { youtubeSearchMeta } from "./yt-seo";
import { cred } from "./env";

// The one publish engine — used by the Publish button (/api/post) and by the
// cron for scheduled posts. Loads the clip, builds the caption (with the
// song's tracked listen link when assigned), posts, advances the rotation,
// and writes post_log. Throws on failure AFTER logging the error row.
export async function publishClipTo(userId: string, platform: string, clipId: string): Promise<string> {
  if (!["instagram", "tiktok", "youtube"].includes(platform)) {
    throw new Error("Unknown platform.");
  }

  const { data: clip } = await db
    .from("clips")
    .select("id, user_id, title, caption, hashtags, video_path, songs(title, slug, spotify_url, apple_url, youtube_url)")
    .eq("id", clipId)
    .single();
  if (!clip || clip.user_id !== userId) throw new Error("Clip not found.");
  if (!clip.video_path) throw new Error("This clip has no video to post.");

  const token =
    platform === "instagram"
      ? await getInstagramToken(userId)
      : platform === "youtube"
        ? await getYouTubeToken(userId)
        : await getTikTokToken(userId);

  const song: any = (clip as any).songs;
  const listenLink =
    song && (song.spotify_url || song.apple_url || song.youtube_url)
      ? `\n\n🎧 Full song: ${
          cred("APP_BASE_URL") || "https://recirculate-globallearningstrategies-projects.vercel.app"
        }/listen/${song.slug}?src=${platform}`
      : "";
  const caption = [clip.caption, clip.hashtags].filter(Boolean).join("\n\n") + listenLink;

  let externalId: string;
  try {
    if (platform === "instagram") {
      const videoUrl = db.storage.from(BUCKET).getPublicUrl(clip.video_path).data.publicUrl;
      externalId = await publishReel(token, videoUrl, caption);
    } else if (platform === "youtube") {
      // Search-optimized title/description/tags — YouTube is a search engine
      // and covers get typed into it every day. Falls back to the clip's own
      // metadata if generation fails; SEO never blocks a post.
      const seo = await youtubeSearchMeta({
        clipTitle: clip.title ?? "Untitled",
        songTitle: song?.title ?? null,
        caption,
      });
      externalId = await publishYouTube(token, clip as any, seo?.description ?? caption, seo);
    } else {
      externalId = await publishTikTok(token, clip as any, caption);
    }
  } catch (e: any) {
    await db
      .from("post_log")
      .insert({ user_id: userId, clip_id: clipId, platform, status: "error", error: e?.message || "publish failed" });
    throw e;
  }

  const { data: cp } = await db
    .from("clip_platforms")
    .select("times_posted")
    .eq("clip_id", clipId)
    .eq("platform", platform)
    .maybeSingle();
  await db.from("clip_platforms").upsert(
    {
      clip_id: clipId,
      platform,
      enabled: true,
      last_posted_at: new Date().toISOString(),
      times_posted: (cp?.times_posted || 0) + 1,
    },
    { onConflict: "clip_id,platform" }
  );
  await db
    .from("post_log")
    .insert({ user_id: userId, clip_id: clipId, platform, status: "success", external_post_id: externalId });

  return externalId;
}
