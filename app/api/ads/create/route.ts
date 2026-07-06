import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { adsConfigured, createDraftCampaign } from "@/lib/meta-ads";
import { cred } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300; // video processing on Meta's side takes a bit

// Creates a PAUSED campaign → ad set → ad promoting one clip, with a Listen
// Now button to its song's tracked /listen page. Nothing spends until the
// owner reviews and publishes in Ads Manager.
export async function POST(req: Request) {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  if (!adsConfigured()) {
    return NextResponse.json(
      { error: "Set META_ADS_TOKEN, META_AD_ACCOUNT_ID, and META_PAGE_ID in Vercel first." },
      { status: 400 }
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const clipId = body?.clipId;
  const dailyBudget = Number(body?.dailyBudget); // dollars
  const days = Math.min(30, Math.max(1, Number(body?.days) || 7));
  if (!clipId) return NextResponse.json({ error: "Missing clipId." }, { status: 400 });
  if (!Number.isFinite(dailyBudget) || dailyBudget < 1 || dailyBudget > 500) {
    return NextResponse.json({ error: "Daily budget must be between $1 and $500." }, { status: 400 });
  }

  const { data: clip } = await db
    .from("clips")
    .select("id, user_id, title, caption, hashtags, video_path, thumb_path, songs(slug)")
    .eq("id", clipId)
    .single();
  if (!clip || clip.user_id !== user.id) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }
  if (!clip.video_path) {
    return NextResponse.json({ error: "This clip has no video." }, { status: 400 });
  }

  const base = cred("APP_BASE_URL") || "https://recirculate-globallearningstrategies-projects.vercel.app";
  const slug = (clip as any).songs?.slug as string | undefined;
  const listenUrl = slug ? `${base}/listen/${slug}?src=ad` : `${base}/listen?src=ad`;

  try {
    const result = await createDraftCampaign({
      clip: clip as any,
      listenUrl,
      dailyBudgetCents: Math.round(dailyBudget * 100),
      days,
      audience:
        body?.audienceId && (body?.audienceKind === "saved" || body?.audienceKind === "custom")
          ? { kind: body.audienceKind, id: body.audienceId }
          : null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Campaign creation failed." }, { status: 502 });
  }
}
