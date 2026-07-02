import { db } from "./supabase";
import { refreshLongLivedToken } from "./instagram";

const DAY = 86400000;

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
