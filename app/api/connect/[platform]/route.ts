import { NextResponse } from "next/server";

// One-time connect flow. Visit /api/connect/youtube (or instagram / tiktok) in a browser,
// approve access, and the matching callback stores the tokens. Protect these routes (or remove
// them after connecting) so only you can run them.
export async function GET(_req: Request, { params }: { params: { platform: string } }) {
  const p = params.platform;
  const V = process.env.META_GRAPH_VERSION || "v21.0";

  if (p === "youtube") {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
    u.searchParams.set("redirect_uri", process.env.GOOGLE_REDIRECT_URI!);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload");
    u.searchParams.set("access_type", "offline"); // needed for a refresh token
    u.searchParams.set("prompt", "consent");      // forces a refresh token every time
    return NextResponse.redirect(u.toString());
  }

  if (p === "instagram") {
    const u = new URL(`https://www.facebook.com/${V}/dialog/oauth`);
    u.searchParams.set("client_id", process.env.META_APP_ID!);
    u.searchParams.set("redirect_uri", process.env.META_REDIRECT_URI!);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "instagram_basic,instagram_content_publish,pages_show_list,business_management");
    return NextResponse.redirect(u.toString());
  }

  if (p === "tiktok") {
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.searchParams.set("client_key", process.env.TIKTOK_CLIENT_KEY!);
    u.searchParams.set("redirect_uri", process.env.TIKTOK_REDIRECT_URI!);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "video.publish");
    u.searchParams.set("state", "recirculate");
    return NextResponse.redirect(u.toString());
  }

  return NextResponse.json({ error: "unknown platform" }, { status: 400 });
}
