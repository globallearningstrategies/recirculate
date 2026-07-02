import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { platformStatus } from "@/lib/rotation";
import { cred } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const { data: settings, error } = await db.from("settings").select("platform, cadence_days, active");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: any[] = [];
  const due: { platform: string; sinceLast: number | null; title: string }[] = [];

  for (const cfg of settings ?? []) {
    if (!NAMES[cfg.platform]) continue;
    if (!cfg.active) { results.push({ platform: cfg.platform, skipped: "inactive" }); continue; }
    const s = await platformStatus(cfg.platform, cfg.cadence_days);
    if (!s.due) {
      results.push({ platform: cfg.platform, skipped: `not due (${s.sinceLast}/${cfg.cadence_days} days)` });
      continue;
    }
    if (!s.next) { results.push({ platform: cfg.platform, skipped: "no clips in rotation" }); continue; }
    due.push({ platform: cfg.platform, sinceLast: s.sinceLast, title: s.next.title });
    results.push({ platform: cfg.platform, due: true, suggested: s.next.title });
  }

  let emailed = false;
  if (due.length > 0) {
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
            `</li>`
        )
        .join("");
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { name: "Recirculate", email: cred("NOTIFY_FROM_EMAIL") || to },
          to: [{ email: to }],
          subject: `Recirculate: ${due.map((d) => NAMES[d.platform]).join(" + ")} due today`,
          htmlContent:
            `<div style="font-family:sans-serif;max-width:480px">` +
            `<h2 style="margin:0 0 4px">Ready to recirculate</h2>` +
            `<p style="margin:0 0 12px;color:#555">Nothing posts until you tap Publish.</p>` +
            `<ul style="padding-left:20px">${items}</ul>` +
            `<p><a href="${appUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review &amp; publish</a></p>` +
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

  return NextResponse.json({ ran_at: new Date().toISOString(), due: due.length, emailed, results });
}
