import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { adsConfigured, createFanLookalike } from "@/lib/meta-ads";

export const runtime = "nodejs";
export const maxDuration = 120;

// One tap: engagement audience of everyone who interacted with the Instagram
// account → 1% lookalike in the chosen country. Idempotent.
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
    return NextResponse.json({ error: "Meta ads env vars aren't configured." }, { status: 400 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  try {
    const result = await createFanLookalike(String(body?.country ?? "US").toUpperCase());
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Lookalike creation failed." }, { status: 502 });
  }
}
