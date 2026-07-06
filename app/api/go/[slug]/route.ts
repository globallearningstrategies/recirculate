import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { originFrom } from "@/lib/origin";

export const runtime = "nodejs";

// Click-through for /listen pages: logs the tap (which song, which streaming
// service, which social platform it came from) and bounces to the target.
// Public by design — fans hit this.
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const url = new URL(req.url);
  const toParam = url.searchParams.get("to") ?? "";
  // Whitelist — a bare object lookup would resolve prototype keys like
  // "constructor" to truthy junk and crash the redirect.
  const to = ["spotify", "apple", "youtube"].includes(toParam) ? toParam : "";
  const src = (url.searchParams.get("src") ?? "direct").slice(0, 24);

  const { data: song } = await db
    .from("songs")
    .select("id, user_id, spotify_url, apple_url, youtube_url")
    .eq("slug", params.slug)
    .maybeSingle();

  const dest =
    song &&
    ({ spotify: song.spotify_url, apple: song.apple_url, youtube: song.youtube_url } as Record<string, string>)[to];
  if (!song || !dest) {
    return NextResponse.redirect(`${originFrom(req)}/listen`);
  }

  await db
    .from("link_clicks")
    .insert({ user_id: song.user_id, song_id: song.id, target: to, src })
    .then(() => {}); // a failed log must never block the fan

  return NextResponse.redirect(dest);
}
