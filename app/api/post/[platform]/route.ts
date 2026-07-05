import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { publishClipTo } from "@/lib/publish";

// Reels need a processing pass on Instagram's side, so allow time.
export const runtime = "nodejs";
export const maxDuration = 300;

// One-click publish of a clip to a platform. Owner-authenticated via session,
// then lib/publish.ts does the privileged work with the service role.
export async function POST(req: Request, { params }: { params: { platform: string } }) {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

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
  if (!body?.clipId) return NextResponse.json({ error: "Missing clipId." }, { status: 400 });

  try {
    const externalId = await publishClipTo(user.id, params.platform, body.clipId);
    return NextResponse.json({ ok: true, externalId });
  } catch (e: any) {
    const msg = e?.message || "Publish failed.";
    const status = msg === "Unknown platform." || msg === "This clip has no video to post." ? 400 : msg === "Clip not found." ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
