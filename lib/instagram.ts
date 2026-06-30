// Instagram API with Instagram Login (https://graph.instagram.com).
// NOT Basic Display (shut down Dec 2024) and NOT the Facebook-Page Graph path.
// We only ever read the owner's own media, so the Meta app can stay in dev mode.

const GRAPH = "https://graph.instagram.com";
const VERSION = "v22.0";

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
  const res = await fetch(mediaUrl);
  if (!res.ok) throw new Error(`Could not download reel video: ${res.status}`);
  const contentType = res.headers.get("content-type") || "video/mp4";
  return { bytes: await res.arrayBuffer(), contentType };
}
