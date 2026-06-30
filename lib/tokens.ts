import { db } from "./supabase";

// Returns a valid access token for the platform, refreshing first if it is close to expiry.
// Each platform refreshes differently, so the logic is split by case.
export async function getValidToken(platform: string): Promise<{ token: string; externalId: string; meta: any }> {
  const { data: acct } = await db.from("platform_accounts").select("*").eq("platform", platform).single();
  if (!acct) throw new Error(`No connected account for ${platform}. Run the OAuth connect flow first.`);

  const buffer = 5 * 60 * 1000; // refresh if under 5 minutes left
  const expiresSoon = acct.expires_at && new Date(acct.expires_at).getTime() - Date.now() < buffer;
  if (!expiresSoon) return { token: acct.access_token, externalId: acct.external_id, meta: acct.meta };

  let next: { access_token: string; refresh_token?: string; expires_in: number };

  if (platform === "youtube") {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: acct.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    next = await r.json();
  } else if (platform === "instagram") {
    // Meta long-lived user tokens are refreshed by re-exchanging the current token.
    const v = process.env.META_GRAPH_VERSION || "v21.0";
    const u = new URL(`https://graph.facebook.com/${v}/oauth/access_token`);
    u.searchParams.set("grant_type", "fb_exchange_token");
    u.searchParams.set("client_id", process.env.META_APP_ID!);
    u.searchParams.set("client_secret", process.env.META_APP_SECRET!);
    u.searchParams.set("fb_exchange_token", acct.access_token);
    const r = await fetch(u);
    const j = await r.json();
    next = { access_token: j.access_token, expires_in: j.expires_in || 60 * 86400 };
  } else {
    // TikTok rotates the refresh token on every refresh — store the new one.
    const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: acct.refresh_token,
      }),
    });
    next = await r.json();
  }

  if (!next.access_token) throw new Error(`Token refresh failed for ${platform}: ${JSON.stringify(next)}`);

  const expires_at = new Date(Date.now() + next.expires_in * 1000).toISOString();
  await db
    .from("platform_accounts")
    .update({
      access_token: next.access_token,
      refresh_token: next.refresh_token || acct.refresh_token,
      expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq("platform", platform);

  return { token: next.access_token, externalId: acct.external_id, meta: acct.meta };
}
