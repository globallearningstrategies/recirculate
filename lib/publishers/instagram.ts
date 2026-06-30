import { publicUrl } from "../storage";

const V = process.env.META_GRAPH_VERSION || "v21.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Publishes a Reel. Two steps: create a media container from a PUBLIC video URL, wait for Meta to
// finish processing it, then publish the container. Requires an IG Business/Creator account.
// Rate limit: 25 published posts per 24 hours.
export async function publishInstagram(
  token: string,
  igUserId: string,
  clip: { video_path: string },
  caption: string
): Promise<string> {
  const videoUrl = publicUrl(clip.video_path);

  const create = await fetch(`https://graph.facebook.com/${V}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "REELS", video_url: videoUrl, caption, access_token: token }),
  });
  const created = await create.json();
  if (!created.id) throw new Error("IG container failed: " + JSON.stringify(created));

  // Poll until the container is FINISHED (Reels need processing time).
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    const s = await fetch(
      `https://graph.facebook.com/${V}/${created.id}?fields=status_code&access_token=${token}`
    ).then((r) => r.json());
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error("IG processing error for container " + created.id);
    if (i === 29) throw new Error("IG container did not finish processing in time");
  }

  const pub = await fetch(`https://graph.facebook.com/${V}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: created.id, access_token: token }),
  });
  const published = await pub.json();
  if (!published.id) throw new Error("IG publish failed: " + JSON.stringify(published));
  return published.id;
}
