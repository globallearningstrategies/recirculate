import webpush from "web-push";
import { db } from "./supabase";
import { cred } from "./env";

// Sends a Web Push notification to every subscribed device. Dead
// subscriptions (uninstalled PWA, expired endpoint) are pruned as we go.
// No-ops silently when VAPID keys aren't configured.
export async function sendPushToOwner(payload: { title: string; body: string; url?: string }): Promise<number> {
  const pub = cred("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const priv = cred("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return 0;
  webpush.setVapidDetails(`mailto:${cred("OWNER_EMAIL") || "owner@example.com"}`, pub, priv);

  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        try {
          await db.from("push_subscriptions").delete().eq("id", s.id);
        } catch {}
      }
    }
  }
  return sent;
}
