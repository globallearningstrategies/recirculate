import { copyFile, writeFile, readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./lyric-video";
import { parseCues, validateCues } from "./lyric-cues";
import type { Treatment } from "./studio";
import { renderSpiritualMotion } from "./spiritual-motion";
import { cosmicFrame } from "./cosmic-motion";
import { studioSubtitles } from "./studio-subtitles";

type Input = { audio: Buffer; background?: Buffer; treatment: Treatment; title: string; lyrics: string; start: number; duration: number };
const wrap = (value: string, width = 22) => value.split(/\s+/).reduce<string[]>((rows, word) => {
  if (rows.length && rows[rows.length - 1].length + word.length < width) rows[rows.length - 1] += ` ${word}`;
  else rows.push(word);
  return rows;
}, []).join("\n");
function wrapCaption(text: string) {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= 30) return value;
  const spaces = [...value.matchAll(/ /g)].map(m => m.index!);
  if (!spaces.length) return value;
  const split = spaces.reduce((a, b) => Math.abs(a - value.length / 2) < Math.abs(b - value.length / 2) ? a : b);
  return value.slice(0, split) + "\n" + value.slice(split + 1);
}

export async function renderStudioVideo(input: Input) {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-"));
  try {
    // Relative filter paths also work on Windows, where drive letters contain ':'.
    await mkdir(path.join(dir, "fonts"));
    await copyFile(path.join(process.cwd(), "assets/fonts/DejaVuSans-Bold.ttf"), path.join(dir, "fonts", "font.ttf"));
    await writeFile(path.join(dir, "audio"), input.audio);
    await writeFile(path.join(dir, "title.txt"), wrap(input.title, 36));
    if (input.background) await writeFile(path.join(dir, "background"), input.background);
    const lines = parseCues(input.lyrics, input.duration);
    validateCues(lines, input.duration);
    if (!lines.length) throw new Error("No lyrics fall inside this excerpt.");
    const args = ["-y", "-threads", "2", "-filter_complex_threads", "1", "-ss", String(input.start), "-t", String(input.duration), "-i", "audio"];
    let backdrop: string;
    if (input.treatment === "cosmic") {
      await renderSpiritualMotion(dir, input.start, input.duration, cosmicFrame);
      args.push("-i", "spiritual.mp4");
      backdrop = "[1:v]scale=1080:1920:flags=lanczos,setsar=1,fps=30[bg]";
    } else if (input.treatment === "spiritual") {
      await renderSpiritualMotion(dir, input.start, input.duration);
      args.push("-i", "spiritual.mp4");
      backdrop = "[1:v]scale=1080:1920:flags=lanczos,setsar=1,fps=30[bg]";
    } else if (input.treatment === "artwork") {
      args.push("-loop", "1", "-framerate", "30", "-i", "background");
      backdrop = "[1:v]scale=1200:2134:force_original_aspect_ratio=increase,crop=1200:2134,zoompan=z='min(zoom+0.0003,1.15)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=30,setsar=1,drawbox=c=black@0.35:t=fill[bg]";
    } else if (input.treatment === "performance" || input.treatment === "cinematic") {
      // Generated footage starts at zero; the song still starts at its excerpt offset.
      args.push("-ss", String(input.treatment === "cinematic" ? 0 : input.start), "-t", String(input.duration), "-i", "background");
      backdrop = "[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,drawbox=c=black@0.28:t=fill[bg]";
    } else {
      args.push("-f", "lavfi", "-i", "gradients=size=1080x1920:c0=0x100B29:c1=0x513B81:speed=0.015:rate=30");
      backdrop = "[1:v]null[bg]";
    }
    await writeFile(path.join(dir, "lyrics.ass"), studioSubtitles(wrap(input.title, 36), lines.map(line => ({ ...line, text: wrapCaption(line.text) })), input.duration, ["spiritual", "cosmic"].includes(input.treatment), ["kinetic", "spiritual", "cosmic"].includes(input.treatment)));
    const filters = ["drawbox=x=480:y=330:w=120:h=4:color=0xBDA6FF:t=fill", "ass=filename=lyrics.ass:fontsdir=fonts"];
    const audio = `[0:a]afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, input.duration - 0.15)}:d=0.15[a]`;
    let graph = `${backdrop};${audio};[bg]${filters.join(",")}[text]`;
    if (input.treatment === "visualizer") {
      graph = `${backdrop};[0:a]asplit[waveaudio][mainaudio];[mainaudio]afade=t=out:st=${input.duration - 0.15}:d=0.15[a];[waveaudio]showwaves=s=920x220:mode=cline:colors=0xCAB6FF:rate=30[wave];[bg][wave]overlay=80:1320[visual];[visual]${filters.join(",")}[text]`;
    }
    args.push("-filter_complex", graph, "-map", "[text]", "-map", "[a]", "-t", String(input.duration), "-shortest", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "out.mp4");
    await run(args, dir);
    await run(["-y", "-ss", "1", "-i", "out.mp4", "-frames:v", "1", "-vf", "scale=270:-2", "thumb.jpg"], dir);
    return { video: await readFile(path.join(dir, "out.mp4")), thumb: await readFile(path.join(dir, "thumb.jpg")) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
