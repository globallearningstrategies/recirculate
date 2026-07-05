import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { refreshOriginals, refreshPostMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const maxDuration = 300;

// Pulls performance numbers back from the platforms — see lib/metrics.ts.
export async function POST() {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const errors: string[] = [];
  let igOriginals = 0;
  try {
    igOriginals = await refreshOriginals(user.id);
  } catch (e: any) {
    errors.push(`Instagram: ${e?.message || "failed"}`);
  }
  const posts = await refreshPostMetrics(user.id);

  return NextResponse.json({
    instagram_originals: igOriginals,
    instagram_posts: posts.igPosts,
    youtube_posts: posts.ytPosts,
    tiktok: "needs video.list scope — after the audit",
    errors: [...errors, ...posts.errors],
  });
}
