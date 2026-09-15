import { copyFile, writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseLyrics, run } from "./lyric-video";
import type { Treatment } from "./studio";
import { renderSpiritualMotion } from "./spiritual-motion";
import { cosmicBackdrop } from "./cosmic-dreamcore";

type Input = { audio: Buffer; background?: Buffer; treatment: Treatment; title: string; lyrics: string; start: number; duration: number };
const wrap = (value: string, width = 22) => value.split(/\s+/).reduce<string[]>((rows, word) => {
  if (rows.length && rows[rows.length - 1].length + word.length < width) rows[rows.length - 1] += ` ${word}`;
  else rows.push(word);
  return rows;
}, []).join("\n");

export async function renderStudioVideo(input: Input) {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-"));
  try {
    // Relative filter paths also work on Windows, where drive letters contain ':'.
    await copyFile(path.join(process.cwd(), "assets/fonts/DejaVuSans-Bold.ttf"), path.join(dir, "font.ttf"));
    await writeFile(path.join(dir, "audio"), input.audio);
    await writeFile(path.join(dir, "title.txt"), wrap(input.title, 36));
    if (input.background) await writeFile(path.join(dir, "background"), input.background);
    const lines = parseLyrics(input.lyrics, input.duration);
    if (!lines.length) throw new Error("No lyrics fall inside this excerpt.");
    const args = ["-y", "-threads", "2", "-filter_complex_threads", "1", "-ss", String(input.start), "-t", String(input.duration), "-i", "audio"];
    let backdrop: string;
    if (input.treatment === "cosmic") {
      const cosmic = await cosmicBackdrop(dir, input.duration, input.start);
      args.push(...cosmic.args); backdrop = cosmic.backdrop;
    } else if (input.treatment === "spiritual") {
      await renderSpiritualMotion(dir, input.start, input.duration);
      args.push("-i", "spiritual.mp4");
      backdrop = "[1:v]scale=1080:1920:flags=lanczos,setsar=1,fps=30[bg]";
    } else if (input.treatment === "artwork") {
      args.push("-loop", "1", "-framerate", "30", "-i", "background");
      backdrop = "[1:v]scale=1200:2134:force_original_aspect_ratio=increase,crop=1200:2134,zoompan=z='min(zoom+0.0003,1.15)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=30,setsar=1,drawbox=c=black@0.35:t=fill[bg]";
    } else if (input.treatment === "performance") {
      args.push("-ss", String(input.start), "-t", String(input.duration), "-i", "background");
      backdrop = "[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,drawbox=c=black@0.28:t=fill[bg]";
    } else {
      args.push("-f", "lavfi", "-i", "gradients=size=1080x1920:c0=0x100B29:c1=0x513B81:speed=0.015:rate=30");
      backdrop = "[1:v]null[bg]";
    }
    const common = "fontfile=font.ttf:text_shaping=1:expansion=none:fontcolor=white:shadowcolor=black@0.55:shadowx=2:shadowy=3";
    const filters = [`drawtext=${common}:textfile=title.txt:fontsize=38:x=(w-text_w)/2:y=210:line_spacing=12`,
      "drawbox=x=480:y=330:w=120:h=4:color=0xBDA6FF:t=fill"];
    for (const [i, line] of lines.entries()) {
      await writeFile(path.join(dir, `line${i}.txt`), wrap(line.text));
      const start = line.start.toFixed(3), end = line.end.toFixed(3);
      const movement = ["kinetic", "spiritual", "cosmic"].includes(input.treatment) ? `+24*exp(-8*max(0,t-${start}))` : "";
      const position = ["spiritual", "cosmic"].includes(input.treatment) ? "h*0.68-text_h/2" : "(h-text_h)/2";
      const box = ["spiritual", "cosmic"].includes(input.treatment) ? ":box=1:boxcolor=0x050C19@0.58:boxborderw=22" : "";
      filters.push(`drawtext=${common}${box}:textfile=line${i}.txt:fontsize=78:line_spacing=26:x=(w-text_w)/2:y='${position}${movement}':alpha='min(1,max(0,(t-${start})/0.12))':enable='gte(t,${start})*lt(t,${end})'`);
    }
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
