import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { run } from "./lyric-video";

// A small software motion-graphics engine: no browser, native canvas, or paid API.
// Backgrounds render at 540p; captions are added at the final 1080p resolution.
const W = 540, H = 960, FPS = 24;
type Color = [number, number, number];
const gold: Color = [255, 201, 125], ivory: Color = [255, 241, 210];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { n = clamp(n); return n * n * (3 - 2 * n); };
const random = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

class Paint {
  constructor(public pixels: Buffer) {}
  dot(x: number, y: number, c: Color, alpha: number) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= W || y < 0 || y >= H || alpha <= 0) return;
    const i = (y * W + x) * 3, a = clamp(alpha);
    for (let k = 0; k < 3; k++) this.pixels[i + k] += (c[k] - this.pixels[i + k]) * a;
  }
  glow(x: number, y: number, radius: number, c: Color, alpha: number) {
    for (let yy = Math.max(0, Math.floor(y - radius)); yy < Math.min(H, y + radius); yy++) {
      for (let xx = Math.max(0, Math.floor(x - radius)); xx < Math.min(W, x + radius); xx++) {
        const d = ((xx - x) ** 2 + (yy - y) ** 2) / (radius * radius);
        if (d < 1) this.dot(xx, yy, c, alpha * (1 - d) ** 3);
      }
    }
  }
  line(x: number, y: number, xx: number, yy: number, c: Color, a: number) {
    const steps = Math.ceil(Math.max(Math.abs(xx - x), Math.abs(yy - y)) * 1.5);
    for (let j = 0; j <= steps; j++) this.dot(x + (xx - x) * j / Math.max(1, steps), y + (yy - y) * j / Math.max(1, steps), c, a);
  }
  polygon(points: number[][], c: Color, a: number) {
    const lo = Math.max(0, Math.floor(Math.min(...points.map(p => p[1]))));
    const hi = Math.min(H - 1, Math.ceil(Math.max(...points.map(p => p[1]))));
    for (let y = lo; y <= hi; y++) {
      const hits: number[] = [];
      for (let j = 0; j < points.length; j++) {
        const p = points[j], q = points[(j + 1) % points.length];
        if ((p[1] > y) !== (q[1] > y)) hits.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
      }
      hits.sort((a, b) => a - b);
      for (let j = 0; j + 1 < hits.length; j += 2) for (let x = Math.max(0, Math.ceil(hits[j])); x <= Math.min(W - 1, hits[j + 1]); x++) this.dot(x, y, c, a);
    }
  }
}

function sky(top: Color, bottom: Color) {
  const b = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const f = smooth(y / H), vignette = 1 - .4 * ((x - W / 2) / W) ** 2;
    for (let k = 0; k < 3; k++) b[(y * W + x) * 3 + k] = (top[k] * (1 - f) + bottom[k] * f) * vignette;
  }
  return b;
}
const skies = [sky([4, 9, 26], [22, 46, 65]), sky([15, 20, 43], [147, 79, 43]), sky([4, 19, 37], [12, 72, 82])];

export function spiritualFrame(t: number, duration: number, energy = 0, seed = 1): Buffer {
  // Soft scene dissolves, leaving enough time to read each caption.
  const progress = t / duration;
  const city = smooth((progress - .27) / .09) * (1 - smooth((progress - .61) / .09));
  const water = smooth((progress - .61) / .09) * (1 - smooth((progress - .90) / .10));
  const cosmos = 1 - city - water;
  const out = Buffer.allocUnsafe(W * H * 3);
  for (let i = 0; i < out.length; i++) out[i] = skies[0][i] * cosmos + skies[1][i] * city + skies[2][i] * water;
  const p = new Paint(out), pulse = clamp(energy), cx = W / 2;
  // Broad translucent aurora curtains give the abstract scenes depth.
  for (let band = 0; band < 9; band++) {
    const edge: number[][] = [], back: number[][] = [];
    for (let x = -20; x <= W + 20; x += 16) {
      const y = 250 + Math.sin(x * .009 + t * .18 + band * .13) * 150 + band * 9;
      edge.push([x, y]); back.unshift([x, y + 24 + pulse * 12]);
    }
    p.polygon([...edge, ...back], band % 3 ? [36, 148, 173] : [176, 127, 196], (.055 + pulse * .025) * (1 - city));
  }
  p.glow(cx + 40 * Math.sin(t * .15), 300, 230, [109, 124, 183], .17 * cosmos);
  p.glow(cx, 420, 240, gold, .35 * city);
  // Stars flow outward in perspective. A deterministic seed varies each excerpt.
  for (let i = 0; i < 160; i++) {
    const angle = random(i + seed) * Math.PI * 2;
    const z = (random(i + 800 + seed) + t * .017) % 1;
    const radius = 22 + z * z * 650, x = cx + Math.cos(angle) * radius, y = 315 + Math.sin(angle) * radius * 1.4;
    const a = (.25 + .65 * z) * (1 - .65 * city) * (.8 + .2 * Math.sin(t + i));
    p.glow(x, y, 1.5 + z * 2, ivory, a);
    if (z > .8) p.line(x, y, x - Math.cos(angle) * z * 6, y - Math.sin(angle) * z * 8, gold, a * .35);
  }
  // Orbiting arcs and a six-pointed star, kept above the lyric area.
  if (cosmos > .001) {
    p.glow(cx, 310, 125 + pulse * 14, gold, .13 * cosmos);
    for (let ring = 0; ring < 4; ring++) {
      const r = 102 + ring * 24 + pulse * 3, spin = t * (.045 + ring * .01) * (ring % 2 ? -1 : 1);
      for (let j = 0; j < 210; j++) {
        const angle = j / 210 * Math.PI * 2 + spin;
        const a = cosmos * (.35 + .4 * (Math.sin(j * .09 + t) + 1) / 2);
        p.dot(cx + Math.cos(angle) * r, 310 + Math.sin(angle) * r * .78, gold, a);
      }
    }
    for (const phase of [-Math.PI / 2, Math.PI / 2]) {
      const pts = Array.from({ length: 3 }, (_, j) => [cx + Math.cos(phase + j * Math.PI * 2 / 3) * 76, 310 + Math.sin(phase + j * Math.PI * 2 / 3) * 76]);
      for (let j = 0; j < 3; j++) {
        p.line(...pts[j] as [number, number], ...pts[(j + 1) % 3] as [number, number], gold, cosmos * (.8 + pulse * .2));
        p.glow(pts[j][0], pts[j][1], 9, gold, cosmos * .6);
      }
    }
  }
  // Stylized old Jerusalem: layered stone buildings, parapets and warm windows.
  if (city > .001) {
    p.glow(cx, 425, 72, [255, 218, 153], .9 * city);
    for (let layer = 0; layer < 3; layer++) {
      const base = 560 + layer * 58, shift = Math.sin(t * .09) * (layer + 1) * 7;
      p.polygon([[0, base], [W, base], [W, H], [0, H]], [39 - layer * 9, 32 - layer * 7, 35 - layer * 7], city);
      for (let j = -1; j < 12; j++) {
        const x = j * 52 + shift, height = 40 + random(j + layer * 31 + 300) * 92;
        const c: Color = [68 - layer * 17, 49 - layer * 12, 43 - layer * 10];
        p.polygon([[x, base], [x, base - height], [x + 48, base - height], [x + 48, base], [x, base]], c, city);
        p.line(x, base - height, x + 48, base - height, gold, city * .23);
        for (let yy = base - height + 12; yy < base; yy += 13) {
          p.line(x, yy, x + 48, yy, gold, city * .065);
          p.line(x + 16, yy, x + 16, yy - 11, gold, city * .065);
          p.line(x + 34, yy, x + 34, yy - 11, gold, city * .065);
        }
        for (let k = 0; k < 3; k++) p.polygon([[x+k*17,base-height],[x+k*17,base-height-7],[x+k*17+9,base-height-7],[x+k*17+9,base-height]], c, city);
        p.glow(x + 24, base - 25, 5, gold, city * .45);
      }
    }
  }
  // Luminous currents form a moving sea; perspective pushes detail to the horizon.
  for (let row = 0; row < 44; row++) {
    const depth = row / 44, y = 620 + depth * depth * 340;
    const a = (.07 + water * .38) * (.3 + depth * .7);
    for (let x = 0; x < W; x += 2) {
      const wave = Math.sin(x * .017 + t * .75 + row * .3) * (3 + depth * 12) + Math.sin(x * .035 - t * .4 + row) * 2;
      const light = .3 + .7 * Math.max(0, Math.cos((x - cx) / (40 + depth * 160)));
      p.dot(x, y + wave, row % 3 ? [100, 197, 197] : gold, a * light);
    }
  }
  // Flowing ribbons join the scenes, with brightness responding to the real audio.
  for (let ribbon = 0; ribbon < 3; ribbon++) {
    let prev: number[] | undefined;
    for (let y = 60; y < 910; y += 3) {
      const x = cx + Math.sin(y * .006 + t * .28 + ribbon * 2.1) * (140 + 35 * Math.cos(t * .13));
      if (prev) p.line(prev[0], prev[1], x, y, ribbon === 1 ? [99, 189, 203] : gold, (.09 + pulse * .1) * (1 - city * .7));
      if (y % 15 === 0) p.glow(x, y, 8, gold, .06 + pulse * .04);
      prev = [x, y];
    }
  }
  return out;
}

export async function renderSpiritualMotion(dir: string, start: number, duration: number) {
  await run(["-y", "-ss", String(start), "-t", String(duration), "-i", "audio", "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "energy.pcm"], dir);
  const pcm = await readFile(`${dir}/energy.pcm`), levels: number[] = [];
  for (let frame = 0; frame < Math.ceil(duration * FPS); frame++) {
    let sum = 0, count = 0;
    for (let i = Math.floor(frame * 8000 / FPS); i < Math.floor((frame + 1) * 8000 / FPS) && i * 2 + 1 < pcm.length; i++) { sum += (pcm.readInt16LE(i * 2) / 32768) ** 2; count++; }
    levels.push(Math.sqrt(sum / Math.max(1, count)));
  }
  const peak = Math.max(.02, ...levels), seed = Math.floor(start * 100) + pcm.length % 997;
  const child = spawn(ffmpegPath!, ["-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "pipe:0", "-an", "-threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "spiritual.mp4"], { cwd: dir, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
  let failure: Error | undefined, stderr = "", timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 150000);
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-3000); });
  child.stdin.on("error", (e) => { failure = e; });
  const done = new Promise<void>((resolve) => {
    child.on("error", (e) => { failure = e; resolve(); });
    child.on("close", (code) => { if (code !== 0) failure = new Error(timedOut ? "Motion rendering timed out." : `Motion rendering failed: ${stderr}`); resolve(); });
  });
  try {
    let energy = 0;
    for (let i = 0; i < levels.length; i++) {
      if (failure || child.exitCode !== null || child.killed) throw failure || new Error("Motion renderer stopped.");
      energy += (levels[i] / peak - energy) * .2;
      const frame = spiritualFrame(i / FPS, duration, energy, seed);
      // Await each write callback to cap memory and propagate broken-pipe failures.
      await new Promise<void>((resolve, reject) => child.stdin.write(frame, (error) => error ? reject(error) : resolve()));
    }
    child.stdin.end(); await done;
    if (failure) throw failure;
  } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill(); await done; } }
}
