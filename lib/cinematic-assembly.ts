import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { run } from "./lyric-video";

export async function assembleScenes(scenes: Buffer[], duration: number) {
  const dir = await mkdtemp(path.join(tmpdir(), "cinematic-"));
  try {
    const inputs: string[] = [], filters: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      await writeFile(path.join(dir, `scene${i}.mp4`), scenes[i]);
      inputs.push("-i", `scene${i}.mp4`);
      filters.push(`[${i}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30,trim=duration=5,setpts=PTS-STARTPTS[v${i}]`);
    }
    filters.push(`${scenes.map((_, i) => `[v${i}]`).join("")}concat=n=${scenes.length}:v=1:a=0[out]`);
    await run(["-y", "-filter_complex_threads", "1", ...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-t", String(duration), "-an", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "background.mp4"], dir);
    return await readFile(path.join(dir, "background.mp4"));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
