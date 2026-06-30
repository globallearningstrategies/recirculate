import { publicUrl } from "../storage";

// Posts a video via TikTok's Content Posting API using PULL_FROM_URL (TikTok fetches the file).
// IMPORTANT: the storage domain must be added as a verified URL prefix in the TikTok dev portal,
// or PULL_FROM_URL is rejected. The alternative is FILE_UPLOAD (chunked byte upload).
//
// privacy_level MUST be 'SELF_ONLY' until your app passes TikTok's audit. After the audit clears,
// switch the default below to 'PUBLIC_TO_EVERYONE' for real public posting.
const PRIVACY = "SELF_ONLY";

export async function publishTikTok(
  token: string,
  clip: { title: string; video_path: string },
  caption: string
): Promise<string> {
  const videoUrl = publicUrl(clip.video_path);

  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: { title: caption.slice(0, 2200), privacy_level: PRIVACY, disable_comment: false },
      source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
    }),
  });
  const j = await res.json();
  if (j.error?.code && j.error.code !== "ok") throw new Error("TikTok init failed: " + JSON.stringify(j.error));
  const publishId = j.data?.publish_id;
  if (!publishId) throw new Error("TikTok returned no publish_id: " + JSON.stringify(j));
  // Posting is async on TikTok's side; publish_id is the handle to check status later if needed.
  return publishId;
}
