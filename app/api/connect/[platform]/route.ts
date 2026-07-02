import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createSupabaseServer } from "@/lib/supabase-server";
import { originFrom } from "@/lib/origin";
import { cred } from "@/lib/env";

export const runtime = "nodejs";

// Starts the OAuth connect flow for a platform. Owner-only: visiting this
// while signed out bounces to /login. The matching /api/callback route
// finishes the dance and stores tokens in social_connections.
//
// Redirect URIs are derived from the request origin (APP_BASE_URL overrides),
// so the SAME URL must be registered in the provider's dev portal:
//   https://<app>/api/callback/youtube   (Google Cloud OAuth client)
//   https://<app>/api/callback/tiktok    (TikTok for Developers)
export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  const platform = params.platform;
  const origin = originFrom(req);

  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const redirectUri = `${origin}/api/callback/${platform}`;
  const state = randomBytes(16).toString("hex");

  let authUrl: URL;
  if (platform === "youtube") {
    if (!cred("GOOGLE_CLIENT_ID") || !cred("GOOGLE_CLIENT_SECRET")) {
      return NextResponse.redirect(
        `${origin}/?connect_error=${encodeURIComponent("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel first.")}`
      );
    }
    authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", cred("GOOGLE_CLIENT_ID"));
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set(
      "scope",
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly"
    );
    authUrl.searchParams.set("access_type", "offline"); // needed for a refresh token
    authUrl.searchParams.set("prompt", "consent");      // forces a refresh token every time
    authUrl.searchParams.set("state", state);
  } else if (platform === "tiktok") {
    if (!cred("TIKTOK_CLIENT_KEY") || !cred("TIKTOK_CLIENT_SECRET")) {
      return NextResponse.redirect(
        `${origin}/?connect_error=${encodeURIComponent("Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in Vercel first.")}`
      );
    }
    authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
    authUrl.searchParams.set("client_key", cred("TIKTOK_CLIENT_KEY"));
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "user.info.basic,video.publish");
    authUrl.searchParams.set("state", state);
  } else {
    return NextResponse.json({ error: "unknown platform" }, { status: 400 });
  }

  const res = NextResponse.redirect(authUrl.toString());
  // CSRF: the callback must present the same state we hand out here.
  res.cookies.set(`oauth_state_${platform}`, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
