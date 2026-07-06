import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

// Server-side lyric-video renderer: animated gradient background + timed
// lyric lines + the song audio, out as a 9:16 MP4 ready for Reels/Shorts.
// 720x1280 keeps render times inside serverless limits; platforms re-encode
// uploads anyway.

const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const W = 720;
const H = 1280;

export const STYLES: Record<string, { c0: string; c1: string }> = {
  midnight: { c0: "0x1A1035", c1: "0x7A3BC8" },
  sunset: { c0: "0xB92B27", c1: "0xFFA24C" },
  ocean: { c0: "0x0F2027", c1: "0x2C5364" },
  forest: { c0: "0x0B3D2E", c1: "0x11998E" },
};

type Line = { text: string; start: number; end: number };

// drawtext has no auto-wrap; break long lines at ~22 chars on word bounds.
function wrap(text: string, max = 22): string {
  const words = text.split(/\s+/);
  const rows: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      rows.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) rows.push(cur);
  return rows.join("\n");
}

// Lines may carry [m:ss] stamps (video-relative). With stamps, each line runs
// until the next stamp; without, lines get equal slots across the duration.
export function parseLyrics(raw: string, duration: number): Line[] {
  const rows = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
  if (rows.length === 0) return [];

  const stamped = rows.map((r) => {
    const m = r.match(/^\[(\d+):(\d{1,2})\]\s*(.*)$/);
    return m ? { at: Number(m[1]) * 60 + Number(m[2]), text: m[3] } : { at: null as number | null, text: r };
  });

  if (stamped.some((s) => s.at != null)) {
    const lines: Line[] = [];
    for (let i = 0; i < stamped.length; i++) {
      const start = stamped[i].at ?? (i === 0 ? 0 : lines[i - 1].end);
      const nextAt = stamped.slice(i + 1).find((s) => s.at != null)?.at;
      const end = Math.min(duration, nextAt ?? duration);
      if (stamped[i].text) lines.push({ text: stamped[i].text, start: Math.min(start, duration), end });
    }
    return lines.filter((l) => l.end > l.start);
  }

  const slot = duration / rows.length;
  return rows.map((text, i) => ({ text, start: i * slot, end: (i + 1) * slot }));
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary missing on this deployment"));
    const p = spawn(ffmpegPath as string, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 8000) err = err.slice(-8000);
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-600)}`))
    );
  });
}

// Trim the chosen segment to a small mono MP3 — what we feed the transcriber.
// Timestamps in the transcript come back relative to this slice, which is
// exactly the video clock the lyric lines run on.
export async function extractAudioSegment(
  audio: Buffer,
  audioExt: string,
  start: number,
  duration: number
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "seg-"));
  try {
    const inFile = path.join(dir, `in.${audioExt.replace(/[^a-z0-9]/gi, "") || "mp3"}`);
    await writeFile(inFile, audio);
    const out = path.join(dir, "seg.mp3");
    await run([
      "-y",
      "-ss", String(Math.max(0, start)),
      "-t", String(Math.min(90, Math.max(5, duration))),
      "-i", inFile,
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function renderLyricVideo(opts: {
  audio: Buffer;
  audioExt: string; // "mp3" | "m4a" | "wav" …
  title: string;
  lyrics: string;
  start: number; // offset into the audio file, seconds
  duration: number; // video length, seconds
  style: string;
}): Promise<{ video: Buffer; thumb: Buffer }> {
  const dur = Math.min(90, Math.max(10, opts.duration));
  const style = STYLES[opts.style] ?? STYLES.midnight;
  const lines = parseLyrics(opts.lyrics, dur);

  const dir = await mkdtemp(path.join(tmpdir(), "lyric-"));
  try {
    const audioFile = path.join(dir, `in.${opts.audioExt.replace(/[^a-z0-9]/gi, "") || "mp3"}`);
    await writeFile(audioFile, opts.audio);

    // Text goes in files — sidesteps drawtext's escaping rules entirely.
    const titleFile = path.join(dir, "title.txt");
    await writeFile(titleFile, wrap(opts.title, 26));
    const lineFiles: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const f = path.join(dir, `line${i}.txt`);
      await writeFile(f, wrap(lines[i].text));
      lineFiles.push(f);
    }

    const common = `fontfile=${FONT}:fontcolor=white:shadowcolor=black@0.55:shadowx=2:shadowy=3`;
    const filters = [
      `drawtext=${common}:textfile=${titleFile}:fontsize=30:alpha=0.85:x=(w-text_w)/2:y=120:line_spacing=10`,
      ...lines.map(
        (l, i) =>
          `drawtext=${common}:textfile=${lineFiles[i]}:fontsize=58:line_spacing=16:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${l.start.toFixed(2)},${l.end.toFixed(2)})'`
      ),
    ].join(",");

    const out = path.join(dir, "out.mp4");
    await run([
      "-y",
      "-f", "lavfi",
      "-i", `gradients=size=${W}x${H}:c0=${style.c0}:c1=${style.c1}:speed=0.01:rate=30`,
      "-ss", String(Math.max(0, opts.start)),
      "-t", String(dur),
      "-i", audioFile,
      "-filter_complex",
      `[0:v]${filters}[v];[1:a]afade=t=in:st=0:d=0.8,afade=t=out:st=${(dur - 1.2).toFixed(2)}:d=1.2[a]`,
      "-map", "[v]",
      "-map", "[a]",
      "-t", String(dur),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "25",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      out,
    ]);

    const thumbOut = path.join(dir, "thumb.jpg");
    await run(["-y", "-ss", "0.5", "-i", out, "-frames:v", "1", "-q:v", "4", thumbOut]);

    return { video: await readFile(out), thumb: await readFile(thumbOut) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
