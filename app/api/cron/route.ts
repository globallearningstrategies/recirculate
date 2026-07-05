import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { platformStatus } from "@/lib/rotation";
import { getInstagramToken, getYouTubeToken, getTikTokToken } from "@/lib/connections";
import { refreshPostMetrics } from "@/lib/metrics";
import { cred } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

// Daily nudge, not an auto-poster: publishing always stays a human tap in the
// app. This cron checks which platforms are due per the rotation rule, works
// out the suggested next clip, and emails the owner a digest with a link. If
// nothing is due, it sends nothing.
const NAMES: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };

export async function GET(req: Request) {
  // Vercel Cron sends the CRON_SECRET as a bearer token. Fail closed when the
  // secret isn't configured — otherwise "Bearer undefined" would match.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ?force=1 emails the digest even when nothing is due — for testing the
  // pipeline and for "just show me what's up next" moments.
  const force = new URL(req.url).searchParams.get("force") === "1";

  const { data: settings, error } = await db.from("settings").select("user_id, platform, cadence_days, active");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: any[] = [];
  const due: { platform: string; sinceLast: number | null; title: string }[] = [];

  for (const cfg of settings ?? []) {
    if (!NAMES[cfg.platform]) continue;
    if (!cfg.active) { results.push({ platform: cfg.platform, skipped: "inactive" }); continue; }
    const s = await platformStatus(cfg.platform, cfg.cadence_days);
    if (!s.due && !force) {
      results.push({ platform: cfg.platform, skipped: `not due (${s.sinceLast}/${cfg.cadence_days} days)` });
      continue;
    }
    if (!s.next) { results.push({ platform: cfg.platform, skipped: "no clips in rotation" }); continue; }
    due.push({ platform: cfg.platform, sinceLast: s.sinceLast, title: s.next.title });
    results.push({ platform: cfg.platform, due: true, suggested: s.next.title });
  }

  // Connection health: exercise every stored token daily. The refreshers roll
  // tokens forward as a side effect (Instagram's 60-day token, TikTok's
  // rotating refresh token, YouTube's hourly access token), so checking IS
  // maintaining — and a genuine failure gets flagged before a publish hits it.
  const alerts: string[] = [];
  const getters: Record<string, (userId: string) => Promise<string>> = {
    instagram: getInstagramToken,
    youtube: getYouTubeToken,
    tiktok: getTikTokToken,
  };
  const { data: conns } = await db.from("social_connections").select("user_id, platform");
  for (const c of conns ?? []) {
    const check = getters[c.platform];
    if (!check) continue;
    try {
      await check(c.user_id);
      results.push({ connection: c.platform, ok: true });
    } catch (e: any) {
      const msg = e?.message || "token check failed";
      alerts.push(`${NAMES[c.platform] ?? c.platform}: ${msg}`);
      results.push({ connection: c.platform, error: msg });
    }
  }

  let emailed = false;
  if (due.length > 0 || alerts.length > 0) {
    const apiKey = cred("BREVO_API_KEY");
    const to = cred("OWNER_EMAIL");
    if (!apiKey || !to) {
      results.push({ email: "skipped — set BREVO_API_KEY and OWNER_EMAIL in Vercel" });
    } else {
      const appUrl = cred("APP_BASE_URL") || "https://recirculate-globallearningstrategies-projects.vercel.app";
      const items = due
        .map(
          (d) =>
            `<li style="margin:8px 0"><strong>${NAMES[d.platform]}</strong> — up next: “${d.title}”` +
            (d.sinceLast != null ? ` <span style="color:#888">(last post ${d.sinceLast} days ago)</span>` : " <span style=\"color:#888\">(never posted)</span>") +
            ` · <a href="${appUrl}/?review=${d.platform}" style="color:#6b4fd8">Publish&nbsp;→</a>` +
            `</li>`
        )
        .join("");
      const subject =
        due.length > 0
          ? `Recirculate: ${due.map((d) => NAMES[d.platform]).join(" + ")} due today` +
            (alerts.length ? " · connection needs attention" : "")
          : `Recirculate: ${alerts.length === 1 ? "a connection needs" : "connections need"} attention`;
      const alertBlock = alerts.length
        ? `<h3 style="margin:16px 0 4px;color:#c0392b">Needs attention</h3>` +
          `<ul style="padding-left:20px">${alerts.map((a) => `<li style="margin:6px 0">${a}</li>`).join("")}</ul>` +
          `<p style="color:#555">Open the app and reconnect before the next post.</p>`
        : "";
      const dueBlock =
        due.length > 0
          ? `<p style="margin:0 0 12px;color:#555">Nothing posts until you tap Publish.</p>` +
            `<ul style="padding-left:20px">${items}</ul>`
          : "";
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { name: "Recirculate", email: cred("NOTIFY_FROM_EMAIL") || to },
          to: [{ email: to }],
          subject,
          htmlContent:
            `<div style="font-family:sans-serif;max-width:480px">` +
            `<h2 style="margin:0 0 4px">${due.length > 0 ? "Ready to recirculate" : "Recirculate health check"}</h2>` +
            dueBlock +
            alertBlock +
            `<p><a href="${appUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${due.length > 0 ? "Review &amp; publish" : "Open Recirculate"}</a></p>` +
            `</div>`,
        }),
      });
      if (res.ok) {
        emailed = true;
      } else {
        results.push({ email_error: `Brevo ${res.status}: ${(await res.text()).slice(0, 300)}` });
      }
    }
  }

  // ---- Sunday scorecard (force=1 also sends it, for testing) ----
  let scorecarded = false;
  const isSunday = new Date().getUTCDay() === 0;
  const scoreKey = cred("BREVO_API_KEY");
  const scoreTo = cred("OWNER_EMAIL");
  const userId = (settings?.[0] as any)?.user_id as string | undefined;
  if ((isSunday || force) && scoreKey && scoreTo && userId) {
    try {
      // Fresh numbers for recent posts before summarizing them.
      await refreshPostMetrics(userId, 30).catch(() => null);

      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const [{ data: weekPosts }, { data: weekClicks }] = await Promise.all([
        db.from("post_log").select("platform, views, likes").eq("status", "success").gte("posted_at", weekAgo),
        db.from("link_clicks").select("target").gte("created_at", weekAgo),
      ]);
      const posts = weekPosts ?? [];
      const clicks = weekClicks ?? [];
      const postCount = (p: string) => posts.filter((r) => r.platform === p).length;
      const views = posts.reduce((n, r) => n + (r.views ?? 0), 0);
      const likes = posts.reduce((n, r) => n + (r.likes ?? 0), 0);
      const clickBy = (t: string) => clicks.filter((c) => c.target === t).length;

      // Email list size (needs BREVO_LIST_ID).
      let brevoContacts: number | null = null;
      const listId = Number(cred("BREVO_LIST_ID"));
      if (Number.isFinite(listId) && listId > 0) {
        try {
          const l = await (
            await fetch(`https://api.brevo.com/v3/contacts/lists/${listId}`, { headers: { "api-key": scoreKey } })
          ).json();
          brevoContacts = l?.totalSubscribers ?? l?.uniqueSubscribers ?? null;
        } catch {}
      }

      // Spotify follower count (optional: SPOTIFY_CLIENT_ID/SECRET/ARTIST_ID).
      let spotifyFollowers: number | null = null;
      if (cred("SPOTIFY_CLIENT_ID") && cred("SPOTIFY_CLIENT_SECRET") && cred("SPOTIFY_ARTIST_ID")) {
        try {
          const tok = await (
            await fetch("https://accounts.spotify.com/api/token", {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization:
                  "Basic " +
                  Buffer.from(`${cred("SPOTIFY_CLIENT_ID")}:${cred("SPOTIFY_CLIENT_SECRET")}`).toString("base64"),
              },
              body: "grant_type=client_credentials",
            })
          ).json();
          if (tok?.access_token) {
            const artist = await (
              await fetch(`https://api.spotify.com/v1/artists/${cred("SPOTIFY_ARTIST_ID")}`, {
                headers: { Authorization: `Bearer ${tok.access_token}` },
              })
            ).json();
            spotifyFollowers = artist?.followers?.total ?? null;
          }
        } catch {}
      }

      // Deltas vs. the previous snapshot, then record this week's.
      const { data: prev } = await db
        .from("artist_snapshots")
        .select("spotify_followers, brevo_contacts")
        .order("taken_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const delta = (now: number | null, then: number | null | undefined) =>
        now != null && then != null ? ` (${now - then >= 0 ? "+" : ""}${now - then} this week)` : "";
      await db.from("artist_snapshots").insert({ spotify_followers: spotifyFollowers, brevo_contacts: brevoContacts });

      const line = (label: string, value: string) => `<li style="margin:6px 0"><strong>${label}</strong>: ${value}</li>`;
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": scoreKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { name: "Recirculate", email: cred("NOTIFY_FROM_EMAIL") || scoreTo },
          to: [{ email: scoreTo }],
          subject: `Recirculate weekly: ${posts.length} post${posts.length === 1 ? "" : "s"} · ${clicks.length} listen click${clicks.length === 1 ? "" : "s"}`,
          htmlContent:
            `<div style="font-family:sans-serif;max-width:480px">` +
            `<h2 style="margin:0 0 12px">Your week in recirculation</h2>` +
            `<ul style="padding-left:20px">` +
            line("Posts", `${posts.length} — Instagram ${postCount("instagram")} · TikTok ${postCount("tiktok")} · YouTube ${postCount("youtube")}`) +
            line("Repost performance", views || likes ? `${views.toLocaleString()} views · ${likes.toLocaleString()} likes (where measured)` : "no numbers yet") +
            line("Listen clicks", `${clicks.length} — Spotify ${clickBy("spotify")} · Apple ${clickBy("apple")} · YouTube ${clickBy("youtube")}`) +
            (brevoContacts != null ? line("Email list", `${brevoContacts} fans${delta(brevoContacts, prev?.brevo_contacts)}`) : "") +
            (spotifyFollowers != null ? line("Spotify followers", `${spotifyFollowers.toLocaleString()}${delta(spotifyFollowers, prev?.spotify_followers)}`) : "") +
            `</ul>` +
            `<p><a href="${cred("APP_BASE_URL") || "https://recirculate-globallearningstrategies-projects.vercel.app"}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open Recirculate</a></p>` +
            `</div>`,
        }),
      });
      scorecarded = res.ok;
      if (!res.ok) results.push({ scorecard_error: `Brevo ${res.status}` });
    } catch (e: any) {
      results.push({ scorecard_error: e?.message || "scorecard failed" });
    }
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), due: due.length, emailed, scorecarded, results });
}
