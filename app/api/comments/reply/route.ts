import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { getInstagramToken, getYouTubeToken } from "@/lib/connections";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sends a reply to one comment. Instagram replies nest under the comment;
// YouTube uses comments.insert with the parent id (needs the youtube.force-ssl
// scope — connections made before it was added must reconnect once).
export async function POST(req: Request) {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const { platform, commentId } = body;
  const text = String(body?.text ?? "").trim();
  if (!commentId || !text) return NextResponse.json({ error: "Missing comment or reply text." }, { status: 400 });

  try {
    if (platform === "instagram") {
      const token = await getInstagramToken(user.id);
      const res = await (
        await fetch(`https://graph.instagram.com/v22.0/${commentId}/replies`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ message: text, access_token: token }),
        })
      ).json();
      if (res.error) throw new Error(res.error.message);
      return NextResponse.json({ ok: true });
    }
    if (platform === "youtube") {
      const token = await getYouTubeToken(user.id);
      const res = await (
        await fetch("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ snippet: { parentId: commentId, textOriginal: text } }),
        })
      ).json();
      if (res.error) {
        const msg = String(res.error.message ?? "reply failed");
        throw new Error(
          /insufficient|scope|forbidden/i.test(msg)
            ? "YouTube needs one extra permission for replies — tap Connect on YouTube in the Accounts row to re-authorize, then try again."
            : msg
        );
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown platform." }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Reply failed." }, { status: 502 });
  }
}
