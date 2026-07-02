// Instagram API with Instagram Login (https://graph.instagram.com).
// NOT Basic Display (shut down Dec 2024) and NOT the Facebook-Page Graph path.
// We only ever read the owner's own media, so the Meta app can stay in dev mode.

const GRAPH = "https://graph.instagram.com";
const VERSION = "v22.0";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type IGMedia = {
  id: string;
  caption?: string;
  media_type?: string; // IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type?: string; // FEED | REELS | STORY | AD
  media_url?: string; // signed CDN link — expires fast, never persist
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string; // ISO 8601
};

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";

// Pages through GET /me/media to the very end, following paging.next.
export async function listAllMedia(accessToken: string): Promise<IGMedia[]> {
  const first = new URL(`${GRAPH}/${VERSION}/me/media`);
  first.searchParams.set("fields", MEDIA_FIELDS);
  first.searchParams.set("limit", "50");
  first.searchParams.set("access_token", accessToken);

  const out: IGMedia[] = [];
  let next: string | null = first.toString();
  let guard = 0; // safety: cap pages so a paging bug can't loop forever

  while (next && guard < 200) {
    guard++;
    const res: Response = await fetch(next);
    const body: any = await res.json();
    if (!res.ok) {
      const msg = body?.error?.message || `Instagram API error ${res.status}`;
      throw new Error(msg);
    }
    if (Array.isArray(body?.data)) out.push(...(body.data as IGMedia[]));
    next = body?.paging?.next ?? null;
  }
  return out;
}

// A reel is a VIDEO whose product type is REELS.
export function isReel(m: IGMedia): boolean {
  return m.media_product_type === "REELS";
}

export async function listReels(accessToken: string): Promise<IGMedia[]> {
  return (await listAllMedia(accessToken)).filter(isReel);
}

// Splits an IG caption into body text + a trailing hashtag block.
// Only hashtags that form the contiguous run at the very end are pulled out, so
// inline tags inside a sentence stay in the caption.
export function parseCaption(raw: string | undefined): { caption: string; hashtags: string } {
  const text = (raw ?? "").trim();
  if (!text) return { caption: "", hashtags: "" };

  const tokens = text.split(/\s+/);
  const trailing: string[] = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^#[\p{L}\p{N}_]+$/u.test(tokens[i])) trailing.unshift(tokens[i]);
    else break;
  }
  if (!trailing.length) return { caption: text, hashtags: "" };

  const body = tokens.slice(0, tokens.length - trailing.length).join(" ").trim();
  return { caption: body, hashtags: trailing.join(" ") };
}

// Derives a short, human title from the caption (clips.title is NOT NULL).
export function deriveTitle(caption: string): string {
  const firstLine = (caption || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  if (!firstLine) return "Instagram reel";
  return firstLine.length > 80 ? firstLine.slice(0, 77).trimEnd() + "…" : firstLine;
}

// Downloads the MP4 bytes from the signed CDN URL. This hits the scontent CDN,
// not the Graph API, so it doesn't count against the Graph rate limit. Must be
// done in the same request the media_url came from — the link expires quickly.
export async function downloadVideo(
  mediaUrl: string
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  return downloadBytes(mediaUrl, "video/mp4");
}

// Same, for any CDN asset (e.g. a reel's thumbnail image).
export async function downloadBytes(
  url: string,
  fallbackType: string
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download media: ${res.status}`);
  const contentType = res.headers.get("content-type") || fallbackType;
  return { bytes: await res.arrayBuffer(), contentType };
}

// Extends a long-lived Instagram-Login token for another ~60 days. Instagram
// only refreshes tokens that are at least 24h old and not yet expired.
// Returns null on failure so callers can fall back to the existing token.
export async function refreshLongLivedToken(
  accessToken: string
): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const u = new URL(`${GRAPH}/refresh_access_token`);
    u.searchParams.set("grant_type", "ig_refresh_token");
    u.searchParams.set("access_token", accessToken);
    const res = await fetch(u);
    const body: any = await res.json();
    if (!res.ok || !body?.access_token) return null;
    return { access_token: body.access_token, expires_in: body.expires_in ?? 60 * 86400 };
  } catch {
    return null;
  }
}

// Publishes a reel to the connected account. Three steps, per the Instagram API:
//   1. Create a media container from a PUBLIC video URL (our clips bucket is public).
//   2. Poll the container until Instagram finishes processing the video.
//   3. Publish the container.
// Needs the instagram_business_content_publish permission on the token.
// Rate limit: 25 published posts per 24h. Returns the published media id.
export async function publishReel(
  accessToken: string,
  videoUrl: string,
  caption: string
): Promise<string> {
  // 1) container
  const createRes = await fetch(`${GRAPH}/${VERSION}/me/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "REELS", video_url: videoUrl, caption, access_token: accessToken }),
  });
  const created: any = await createRes.json();
  if (!createRes.ok || !created?.id) {
    throw new Error("Instagram container failed: " + (created?.error?.message || JSON.stringify(created)));
  }

  // 2) wait for processing (reels need a transcode pass)
  let finished = false;
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    const statusUrl = `${GRAPH}/${VERSION}/${created.id}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`;
    const s: any = await (await fetch(statusUrl)).json();
    if (s?.status_code === "FINISHED") {
      finished = true;
      break;
    }
    if (s?.status_code === "ERROR") {
      throw new Error("Instagram hit an error while processing the reel.");
    }
  }
  if (!finished) throw new Error("Instagram took too long to process the reel — try again in a moment.");

  // 3) publish
  const pubRes = await fetch(`${GRAPH}/${VERSION}/me/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: created.id, access_token: accessToken }),
  });
  const published: any = await pubRes.json();
  if (!pubRes.ok || !published?.id) {
    throw new Error("Instagram publish failed: " + (published?.error?.message || JSON.stringify(published)));
  }
  return published.id as string;
}
