import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { getInstagramToken, getYouTubeToken } from "@/lib/connections";

export const runtime = "nodejs";
export const maxDuration = 120;

const IG = "https://graph.instagram.com/v22.0";

type Item = {
  id: string;
  platform: "instagram" | "youtube";
  author: string;
  text: string;
  when: string;
  media: string | null;
};

// The comments inbox: recent fan comments across platforms, own comments
// filtered out. Instagram walks the latest media (one call per post — bounded
// at 15); YouTube gets the whole channel in one call. TikTok joins after the
// audit unlocks its scopes.
export async function GET() {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const userId = user.id;

  const items: Item[] = [];
  const errors: string[] = [];

  try {
    const token = await getInstagramToken(userId);
    const { data: conn } = await db
      .from("social_connections")
      .select("username")
      .eq("user_id", userId)
      .eq("platform", "instagram")
      .maybeSingle();
    const me = (conn?.username ?? "").toLowerCase();

    const media = await (
      await fetch(`${IG}/me/media?fields=id,caption,timestamp&limit=15&access_token=${encodeURIComponent(token)}`)
    ).json();
    if (media.error) throw new Error(media.error.message);
    for (const m of media.data ?? []) {
      const cm = await (
        await fetch(`${IG}/${m.id}/comments?fields=id,text,username,timestamp&limit=10&access_token=${encodeURIComponent(token)}`)
      ).json();
      if (cm.error) throw new Error(cm.error.message);
      for (const c of cm.data ?? []) {
        if ((c.username ?? "").toLowerCase() === me) continue;
        items.push({
          id: c.id,
          platform: "instagram",
          author: c.username ?? "someone",
          text: c.text ?? "",
          when: c.timestamp,
          media: (m.caption ?? "").split("\n")[0].slice(0, 60) || null,
        });
      }
    }
  } catch (e: any) {
    errors.push(`Instagram: ${e?.message || "failed"}`);
  }

  try {
    const { data: conn } = await db
      .from("social_connections")
      .select("external_user_id")
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .maybeSingle();
    if (conn?.external_user_id) {
      const token = await getYouTubeToken(userId);
      const res = await (
        await fetch(
          `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&allThreadsRelatedToChannelId=${conn.external_user_id}&order=time&maxResults=25`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
      ).json();
      if (res.error) throw new Error(res.error.message);
      for (const t of res.items ?? []) {
        const s = t.snippet?.topLevelComment?.snippet;
        if (!s) continue;
        if (s.authorChannelId?.value === conn.external_user_id) continue;
        items.push({
          id: t.snippet.topLevelComment.id,
          platform: "youtube",
          author: s.authorDisplayName ?? "someone",
          text: s.textOriginal ?? "",
          when: s.publishedAt,
          media: null,
        });
      }
    }
  } catch (e: any) {
    errors.push(`YouTube: ${e?.message || "failed"}`);
  }

  items.sort((a, b) => (a.when < b.when ? 1 : -1));
  return NextResponse.json({ items: items.slice(0, 50), errors });
}
