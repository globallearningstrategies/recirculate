import { NextResponse } from "next/server";
import { db, BUCKET } from "@/lib/supabase";
import { createSupabaseServer } from "@/lib/supabase-server";
import { extractAudioSegment } from "@/lib/lyric-video";
import { cred } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

// CapCut-style auto-captions: trims the chosen audio segment, sends it to
// Whisper, and returns lyrics as "[m:ss] line" rows ready for the lyric-video
// form — the owner reviews/edits before rendering. Whisper auto-detects the
// language (Hebrew, English, and French all work); an explicit language hint
// improves accuracy on sung vocals.
export async function POST(req: Request) {
  const ssr = await createSupabaseServer();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const key = cred("OPENAI_API_KEY");
  if (!key) {
    return NextResponse.json(
      { error: "Add OPENAI_API_KEY in Vercel first — transcription runs on OpenAI Whisper (costs pennies per song)." },
      { status: 400 }
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const { audioPath } = body;
  if (!audioPath) return NextResponse.json({ error: "Missing audio file." }, { status: 400 });
  const start = Math.max(0, Number(body.start) || 0);
  const duration = Math.min(90, Math.max(10, Number(body.duration) || 30));
  const language = ["he", "en", "fr"].includes(body.language) ? body.language : undefined;

  const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(audioPath);
  if (dlErr || !blob) return NextResponse.json({ error: "Couldn't read the uploaded audio." }, { status: 400 });

  let segment: Buffer;
  try {
    segment = await extractAudioSegment(
      Buffer.from(await blob.arrayBuffer()),
      audioPath.split(".").pop() ?? "mp3",
      start,
      duration
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Couldn't trim the audio." }, { status: 500 });
  }

  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(segment)], { type: "audio/mpeg" }), "segment.mp3");
  fd.append("model", "whisper-1");
  fd.append("response_format", "verbose_json");
  fd.append("temperature", "0");
  if (language) fd.append("language", language);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: json?.error?.message || `Transcription failed (${res.status}).` },
      { status: 502 }
    );
  }

  const lines: string[] = [];
  for (const seg of json.segments ?? []) {
    const text = String(seg.text ?? "").trim();
    if (!text) continue;
    const s = Math.max(0, Math.floor(Number(seg.start) || 0));
    lines.push(`[${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}] ${text}`);
    if (lines.length >= 40) break;
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "Whisper couldn't make out any lyrics in that segment — try a section with clearer vocals." }, { status: 422 });
  }

  return NextResponse.json({ ok: true, lyrics: lines.join("\n"), detected: json.language ?? null });
}
