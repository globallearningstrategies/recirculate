import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

const V = process.env.META_GRAPH_VERSION || "v21.0";

async function save(platform: string, fields: any) {
  await db.from("platform_accounts").upsert({ platform, ...fields, updated_at: new Date().toISOString() });
}

export async function GET(req: Request, { params }: { params: { platform: string } }) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.json({ error: "no code" }, { status: 400 });
  const p = params.platform;

  try {
    if (p === "youtube") {
      const tok = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
          grant_type: "authorization_code",
        }),
      }).then((r) => r.json());
      const chan = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      }).then((r) => r.json());
      await save("youtube", {
        external_id: chan.items?.[0]?.id || null,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      });
    } else if (p === "instagram") {
      const short = await fetch(
        `https://graph.facebook.com/${V}/oauth/access_token?client_id=${process.env.META_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI!)}` +
          `&client_secret=${process.env.META_APP_SECRET}&code=${code}`
      ).then((r) => r.json());
      const long = await fetch(
        `https://graph.facebook.com/${V}/oauth/access_token?grant_type=fb_exchange_token` +
          `&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}` +
          `&fb_exchange_token=${short.access_token}`
      ).then((r) => r.json());
      // Find the IG Business account id behind the user's first Page.
      const pages = await fetch(
        `https://graph.facebook.com/${V}/me/accounts?fields=instagram_business_account&access_token=${long.access_token}`
      ).then((r) => r.json());
      const igId = pages.data?.find((pg: any) => pg.instagram_business_account)?.instagram_business_account?.id;
      await save("instagram", {
        external_id: igId,
        access_token: long.access_token,
        refresh_token: null,
        expires_at: new Date(Date.now() + (long.expires_in || 60 * 86400) * 1000).toISOString(),
      });
    } else if (p === "tiktok") {
      const tok = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY!,
          client_secret: process.env.TIKTOK_CLIENT_SECRET!,
          code,
          grant_type: "authorization_code",
          redirect_uri: process.env.TIKTOK_REDIRECT_URI!,
        }),
      }).then((r) => r.json());
      await save("tiktok", {
        external_id: tok.open_id,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      });
    } else {
      return NextResponse.json({ error: "unknown platform" }, { status: 400 });
    }
    return NextResponse.json({ connected: p });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
