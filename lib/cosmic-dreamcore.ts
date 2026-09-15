import { copyFile } from "node:fs/promises";
import path from "node:path";

/** Original, bundled artwork. Each scene is animated locally; no paid API calls. */
export async function cosmicBackdrop(dir: string, duration: number, start: number) {
  const scenes = Math.floor(start) % 2 ? ["ocean", "gateway"] : ["gateway", "ocean"];
  await Promise.all(scenes.map((name, i) => copyFile(path.join(process.cwd(), "public", "dreamcore", `${name}.jpg`), path.join(dir, `cosmic-${i}.jpg`))));
  const dissolve = 1.2, cut = duration / 2 - dissolve / 2;
  const length = duration / 2 + dissolve / 2;
  const frames = Math.ceil(length * 24);
  const args = scenes.flatMap((_, i) => ["-loop", "1", "-framerate", "24", "-i", `cosmic-${i}.jpg`]);
  const filters = scenes.map((_, i) => {
    const zoom = i === 0 ? `1.02+0.12*on/${frames}` : `1.14-0.12*on/${frames}`;
    return `[${i + 1}:v]scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,zoompan=z='${zoom}':x='(iw-iw/zoom)/2+sin(on/${frames}*1.5)*12':y='(ih-ih/zoom)/2':d=1:s=720x1280:fps=24,trim=duration=${length},setpts=PTS-STARTPTS,fps=24,settb=1/24,setsar=1,format=yuv420p[scene${i}]`;
  });
  // Slowly changing light and a vignette keep the foreground lyrics readable.
  filters.push(`[scene0][scene1]xfade=transition=fade:duration=${dissolve}:offset=${cut},eq=brightness='0.008*sin(t*0.45)':eval=frame,vignette=PI/5,scale=1080:1920:flags=lanczos,fps=30,setsar=1[bg]`);
  return { args, backdrop: filters.join(";") };
}
