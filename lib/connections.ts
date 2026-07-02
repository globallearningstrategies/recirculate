import { db } from "./supabase";
import { refreshLongLivedToken } from "./instagram";

const DAY = 86400000;
const EXPIRY_BUFFER = 5 * 60 * 1000; // refresh when under 5 minutes left

type ConnectionRow = {
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  updated_at: string | null;
};

async function loadConnection(userId: string, platform: string): Promise<ConnectionRow | null> {
  const { data } = await db
    .from("social_connections")
    .select("access_token, refresh_token, token_expires_at, updated_at")
    .eq("user_id", userId)
    .eq("platform", platform)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

async function saveTokens(
  userId: string,
  platform: string,
  tokens: { access_token: string; refresh_token?: string | null; expires_in: number }
) {
  await db
    .from("social_connections")
    .update({
      access_token: tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("platform", platform);
}

// Returns a valid Instagram access token for the user, keeping it alive:
// long-lived Instagram-Login tokens last ~60 days, and any use of the app more
// than 7 days after the last refresh rolls it forward another 60. As long as
// the owner imports or publishes at least every couple of months, the token
// never has to be re-pasted by hand. Throws a friendly error when missing or
// truly expired.
export async function getInstagramToken(userId: string): Promise<string> {
  const { data: conn } = await db
    .from("social_connections")
    .select("access_token, token_expires_at, updated_at")
    .eq("user_id", userId)
    .eq("platform", "instagram")
    .maybeSingle();

  if (!conn?.access_token) {
    throw new Error("Connect Instagram first — no instagram row in social_connections.");
  }
  if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now()) {
    throw new Error("Your Instagram token has expired. Re-insert a fresh long-lived token.");
  }

  // Instagram refuses to refresh tokens younger than 24h; weekly is plenty.
  const ageMs = conn.updated_at ? Date.now() - new Date(conn.updated_at).getTime() : Infinity;
  if (ageMs > 7 * DAY) {
    const next = await refreshLongLivedToken(conn.access_token);
    if (next) {
      await db
        .from("social_connections")
        .update({
          access_token: next.access_token,
          token_expires_at: new Date(Date.now() + next.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("platform", "instagram");
      return next.access_token;
    }
    // Refresh failed (e.g. token <24h old): the current one is still valid.
  }
  return conn.access_token;
}

// YouTube: Google access tokens live ~1 hour; the refresh token is long-lived
// (but dies after 7 days while the OAuth app is in "Testing" mode — moving the
// app to production in Google Cloud fixes that permanently).
export async function getYouTubeToken(userId: string): Promise<string> {
  const conn = await loadConnection(userId, "youtube");
  if (!conn?.access_token) {
    throw new Error("Connect YouTube first — use the Connect button in the Accounts row.");
  }

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > EXPIRY_BUFFER) return conn.access_token;

  if (!conn.refresh_token) {
    throw new Error("YouTube session expired and no refresh token is stored — reconnect YouTube.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const tok: any = await res.json();
  if (!tok?.access_token) {
    throw new Error(
      "YouTube token refresh failed — reconnect YouTube. (While the Google OAuth app is in Testing mode, tokens die after 7 days.)"
    );
  }
  await saveTokens(userId, "youtube", { access_token: tok.access_token, expires_in: tok.expires_in ?? 3600 });
  return tok.access_token;
}

// TikTok: access tokens live 24h and the refresh token ROTATES on every
// refresh — always store the new one or the connection bricks itself.
export async function getTikTokToken(userId: string): Promise<string> {
  const conn = await loadConnection(userId, "tiktok");
  if (!conn?.access_token) {
    throw new Error("Connect TikTok first — use the Connect button in the Accounts row.");
  }

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > EXPIRY_BUFFER) return conn.access_token;

  if (!conn.refresh_token) {
    throw new Error("TikTok session expired and no refresh token is stored — reconnect TikTok.");
  }
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
    }),
  });
  const tok: any = await res.json();
  if (!tok?.access_token) {
    throw new Error("TikTok token refresh failed — reconnect TikTok.");
  }
  await saveTokens(userId, "tiktok", {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? null,
    expires_in: tok.expires_in ?? 86400,
  });
  return tok.access_token;
}
