import { NextResponse } from "next/server";
import { db, BUCKET } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { publishReel } from "@/lib/instagram";
import { getInstagramToken } from "@/lib/connections";

// Reels need a processing pass on Instagram's side, so allow time.
export const runtime = "nodejs";
export const maxDuration = 300;

// One-click publish of a clip to a platform. Owner-authenticated via session,
// then the privileged work runs with the service role. On success it advances
// the rotation (same bookkeeping as "Mark as posted") and logs to post_log.
export async function POST(req: Request, { params }: { params: { platform: string } }) {
  const platform = params.platform;

  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const userId = user.id;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Server not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel." },
      { status: 500 }
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const clipId = body?.clipId;
  if (!clipId) return NextResponse.json({ error: "Missing clipId." }, { status: 400 });

  if (platform !== "instagram") {
    return NextResponse.json(
      { error: `Publishing to ${platform} isn't connected yet — only Instagram is wired up so far.` },
      { status: 400 }
    );
  }

  // Load the clip and confirm it belongs to the owner.
  const { data: clip } = await db
    .from("clips")
    .select("id, user_id, caption, hashtags, video_path")
    .eq("id", clipId)
    .single();
  if (!clip || clip.user_id !== userId) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }
  if (!clip.video_path) {
    return NextResponse.json({ error: "This clip has no video to post." }, { status: 400 });
  }

  // Get a valid token (auto-refreshes the long-lived token when due).
  let token: string;
  try {
    token = await getInstagramToken(userId);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Instagram connection error." }, { status: 400 });
  }

  const caption = [clip.caption, clip.hashtags].filter(Boolean).join("\n\n");
  const videoUrl = db.storage.from(BUCKET).getPublicUrl(clip.video_path).data.publicUrl;

  // Publish.
  let externalId: string;
  try {
    externalId = await publishReel(token, videoUrl, caption);
  } catch (e: any) {
    await db
      .from("post_log")
      .insert({ user_id: userId, clip_id: clipId, platform, status: "error", error: e?.message || "publish failed" });
    return NextResponse.json({ error: e?.message || "Publish failed." }, { status: 502 });
  }

  // Success: advance the rotation (oldest-first depends on last_posted_at) and log it.
  const { data: cp } = await db
    .from("clip_platforms")
    .select("times_posted")
    .eq("clip_id", clipId)
    .eq("platform", platform)
    .maybeSingle();
  await db.from("clip_platforms").upsert(
    {
      clip_id: clipId,
      platform,
      enabled: true,
      last_posted_at: new Date().toISOString(),
      times_posted: (cp?.times_posted || 0) + 1,
    },
    { onConflict: "clip_id,platform" }
  );
  await db
    .from("post_log")
    .insert({ user_id: userId, clip_id: clipId, platform, status: "success", external_post_id: externalId });

  return NextResponse.json({ ok: true, externalId });
}
