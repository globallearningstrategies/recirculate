import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { isDue, nextDueClip, markPosted, logError, caption } from "@/lib/rotation";
import { getValidToken } from "@/lib/tokens";
import { publishYouTube } from "@/lib/publishers/youtube";
import { publishInstagram } from "@/lib/publishers/instagram";
import { publishTikTok } from "@/lib/publishers/tiktok";

export const runtime = "nodejs";
export const maxDuration = 60;

const PLATFORMS = ["youtube", "instagram", "tiktok"] as const;

export async function GET(req: Request) {
  // Vercel Cron sends the CRON_SECRET as a bearer token. Fail closed when the
  // secret isn't configured — otherwise "Bearer undefined" would match.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: any[] = [];

  for (const platform of PLATFORMS) {
    try {
      const { data: cfg } = await db.from("settings").select("*").eq("platform", platform).single();
      if (!cfg?.active) { results.push({ platform, skipped: "inactive" }); continue; }
      if (!(await isDue(platform, cfg.cadence_days))) { results.push({ platform, skipped: "not due" }); continue; }

      const clip = await nextDueClip(platform);
      if (!clip) { results.push({ platform, skipped: "no clips in rotation" }); continue; }

      const { token, externalId } = await getValidToken(platform);
      const body = caption(clip);

      let externalPostId: string;
      if (platform === "youtube") externalPostId = await publishYouTube(token, clip, body);
      else if (platform === "instagram") externalPostId = await publishInstagram(token, externalId, clip, body);
      else externalPostId = await publishTikTok(token, clip, body);

      await markPosted(clip.id, platform, externalPostId);
      results.push({ platform, posted: clip.title, externalPostId });
    } catch (e: any) {
      await logError(null, platform, e.message || String(e));
      results.push({ platform, error: e.message || String(e) });
    }
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), results });
}
