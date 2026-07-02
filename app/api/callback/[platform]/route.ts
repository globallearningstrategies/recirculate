import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { originFrom } from "@/lib/origin";
import { cred } from "@/lib/env";

export const runtime = "nodejs";

// Finishes the OAuth connect flow started by /api/connect/[platform]:
// verifies the CSRF state, exchanges the code for tokens, fetches the account
// identity for display, and upserts the owner's social_connections row.
export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  const platform = params.platform;
  const origin = originFrom(req);
  const fail = (msg: string) =>
    NextResponse.redirect(`${origin}/?connect_error=${encodeURIComponent(msg)}`);

  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(`oauth_state_${platform}`)?.value;
  if (!code) {
    const err = url.searchParams.get("error_description") || url.searchParams.get("error") || "no code returned";
    return fail(`${platform} connect was cancelled or failed: ${err}`);
  }
  if (!state || !cookieState || state !== cookieState) {
    return fail("Security check failed (state mismatch) — start the connect again.");
  }

  const redirectUri = `${origin}/api/callback/${platform}`;

  try {
    let row: {
      external_user_id: string | null;
      username: string | null;
      access_token: string;
      refresh_token: string | null;
      token_expires_at: string;
    };

    if (platform === "youtube") {
      const tok = await (
        await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: cred("GOOGLE_CLIENT_ID"),
            client_secret: cred("GOOGLE_CLIENT_SECRET"),
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        })
      ).json();
      if (!tok.access_token) throw new Error("Google token exchange failed: " + JSON.stringify(tok));
      if (!tok.refresh_token) throw new Error("Google returned no refresh token — remove the app's access at myaccount.google.com/permissions and connect again.");

      const chan = await (
        await fetch("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", {
          headers: { Authorization: `Bearer ${tok.access_token}` },
        })
      ).json();
      const channel = chan.items?.[0];

      row = {
        external_user_id: channel?.id ?? null,
        username: channel?.snippet?.title ?? null,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      };
    } else if (platform === "tiktok") {
      const tok = await (
        await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: cred("TIKTOK_CLIENT_KEY"),
            client_secret: cred("TIKTOK_CLIENT_SECRET"),
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }),
        })
      ).json();
      if (!tok.access_token) throw new Error("TikTok token exchange failed: " + JSON.stringify(tok));

      let displayName: string | null = null;
      try {
        const info = await (
          await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
            headers: { Authorization: `Bearer ${tok.access_token}` },
          })
        ).json();
        displayName = info?.data?.user?.display_name ?? null;
      } catch {}

      row = {
        external_user_id: tok.open_id ?? null,
        username: displayName,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? null,
        token_expires_at: new Date(Date.now() + (tok.expires_in ?? 86400) * 1000).toISOString(),
      };
    } else {
      return fail("unknown platform");
    }

    const up = await db.from("social_connections").upsert(
      { user_id: user.id, platform, ...row, updated_at: new Date().toISOString() },
      { onConflict: "user_id,platform" }
    );
    if (up.error) throw new Error(up.error.message);

    const done = NextResponse.redirect(`${origin}/?connected=${platform}`);
    done.cookies.set(`oauth_state_${platform}`, "", { maxAge: 0, path: "/" });
    return done;
  } catch (e: any) {
    return fail(e?.message || `${platform} connect failed`);
  }
}
