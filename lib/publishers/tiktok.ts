import { db, BUCKET } from "../supabase";

// Posts a video via TikTok's Content Posting API using FILE_UPLOAD — we push
// the bytes ourselves. (PULL_FROM_URL would need the storage domain verified
// in the TikTok dev portal, and supabase.co isn't ours to verify.)
//
// privacy_level MUST be 'SELF_ONLY' until the app passes TikTok's audit —
// unaudited apps are forced private regardless. After the audit clears, flip
// this one constant to 'PUBLIC_TO_EVERYONE' for real public posting.
const PRIVACY = "SELF_ONLY";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// TikTok chunking rules: chunks of 5–64MB, final chunk may run larger, videos
// under 5MB go up whole. One chunk for anything ≤64MB covers every reel we
// handle; bigger files use 50MB chunks with the remainder merged into the last.
const CHUNK = 50 * 1024 * 1024;
const SINGLE_CHUNK_MAX = 64 * 1024 * 1024;

export async function publishTikTok(
  token: string,
  clip: { title: string; video_path: string },
  caption: string
): Promise<string> {
  // 1) pull the bytes from storage (service role)
  const file = await db.storage.from(BUCKET).download(clip.video_path);
  if (file.error || !file.data) {
    throw new Error("Could not read the video from storage: " + file.error?.message);
  }
  const bytes = Buffer.from(await file.data.arrayBuffer());
  const size = bytes.length;

  const singleChunk = size <= SINGLE_CHUNK_MAX;
  const chunkSize = singleChunk ? size : CHUNK;
  const totalChunks = singleChunk ? 1 : Math.floor(size / CHUNK);

  // 2) init the direct post
  const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: { title: caption.slice(0, 2200), privacy_level: PRIVACY, disable_comment: false },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    }),
  });
  const init: any = await initRes.json();
  if (init.error?.code && init.error.code !== "ok") {
    throw new Error("TikTok init failed: " + (init.error.message || init.error.code));
  }
  const publishId = init.data?.publish_id;
  const uploadUrl = init.data?.upload_url;
  if (!publishId || !uploadUrl) throw new Error("TikTok returned no upload target: " + JSON.stringify(init));

  // 3) upload the chunks (the final chunk absorbs any remainder)
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? size : (i + 1) * chunkSize;
    const part = bytes.subarray(start, end);
    const up = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(part.length),
        "Content-Range": `bytes ${start}-${end - 1}/${size}`,
      },
      body: part,
    });
    if (!up.ok && up.status !== 201) {
      throw new Error(`TikTok chunk upload failed (${up.status}): ${await up.text().catch(() => "")}`);
    }
  }

  // 4) poll until TikTok finishes processing (posting is async on their side)
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const st: any = await (
      await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: publishId }),
      })
    ).json();
    const status = st?.data?.status;
    if (status === "PUBLISH_COMPLETE") return publishId;
    if (status === "FAILED") {
      throw new Error("TikTok rejected the post: " + (st?.data?.fail_reason || "unknown reason"));
    }
  }
  // Still processing after ~90s — the upload was accepted; it almost always
  // completes. Return the handle rather than failing a post that will land.
  return publishId;
}
