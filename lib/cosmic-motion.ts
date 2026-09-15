import { Paint, type Color } from "./spiritual-motion";

const W = 540, H = 960, TAU = Math.PI * 2;
const gold: Color = [255, 213, 143], cyan: Color = [94, 224, 238];
const fract = (x: number) => x - Math.floor(x);
const rand = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

// Every frame is constructed from moving geometry and light; no still images.
// A flight through luminous gates above a rolling sea under orbiting planets.
export function cosmicFrame(t: number, duration: number, energy = 0, seed = 1): Buffer {
  const out = Buffer.allocUnsafe(W * H * 3), p = new Paint(out);
  const beat = Math.max(0, Math.min(1, energy));
  const cx = 270 + Math.sin(t * .32) * 38, horizon = 488 + Math.sin(t * .23) * 16;
  for (let y = 0; y < H; y++) {
    const sea = y > horizon, depth = Math.max(0, (y - horizon) / (H - horizon));
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const wave = sea ? Math.sin(x * .028 + t * 1.8 + depth * 24) * Math.sin(depth * 65 - t * 2.6) : 0;
      const reflection = sea ? Math.exp(-(((x - cx + wave * 20) / (24 + depth * 145)) ** 2)) * Math.max(0, wave) : 0;
      const haze = Math.max(0, 1 - Math.abs(y - horizon) / 310);
      out[i] = 4 + haze * 14 + reflection * 75;
      out[i + 1] = 8 + haze * 20 + reflection * 85 + (sea ? depth * 5 : 0);
      out[i + 2] = 25 + haze * 38 + reflection * 100;
    }
  }
  // Nebula ribbons change shape and drift independently of the camera.
  for (let band = 0; band < 12; band++) {
    const a: number[][] = [], b: number[][] = [];
    for (let x = -20; x <= W + 20; x += 14) {
      const y = 150 + band * 12 + Math.sin(x * .008 + t * .42 + band * .08) * 85 + Math.sin(x * .018 - t * .23) * 26;
      a.push([x, y]); b.unshift([x, y + 12]);
    }
    p.polygon([...a, ...b], band % 2 ? cyan : [172, 104, 220], .10 + beat * .035);
  }
  // Stars travel through depth, with short trails rather than blinking cuts.
  for (let i = 0; i < 230; i++) {
    const z = .2 + fract(rand(i + seed) - t * .035) * 4;
    const x = cx + (rand(i + 800) - .5) * 650 / z;
    const y = horizon - (30 + rand(i + 1800) * 500) / z;
    p.glow(x, y, 1 + 2 / z, i % 3 ? gold : cyan, .45);
    if (z < 1) p.line(x, y, x + (x - cx) * .012, y + (y - horizon) * .012, gold, .4);
  }
  // A shaded sphere with independently rotating bands and a tilted orbit.
  const planetX = 396 + Math.sin(t * .17) * 45, planetY = 173 + Math.cos(t * .2) * 23, r = 51;
  p.glow(planetX, planetY, 88, [127, 131, 237], .3);
  for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
    const rr = (xx * xx + yy * yy) / (r * r);
    if (rr > 1) continue;
    const light = Math.max(.05, (-xx / r * .45 - yy / r * .35 + Math.sqrt(1 - rr) * .7));
    const bands = .7 + .3 * Math.sin(yy * .19 + Math.sin(xx * .05 + t * .7));
    p.dot(planetX + xx, planetY + yy, [130 * light * bands, 148 * light * bands, 235 * light * bands], 1);
  }
  for (let j = 0; j < 520; j++) {
    const a = j / 520 * TAU + t * .25;
    p.dot(planetX + Math.cos(a) * 87, planetY + Math.sin(a) * 20 + Math.cos(a) * 19, gold, .35 + .3 * Math.sin(a + t));
  }
  // Perspective gates advance toward the camera, turning in three dimensions.
  for (let gate = 5; gate >= 0; gate--) {
    const z = .35 + fract(gate / 6 - t * .047) * 6;
    const radius = 260 / z, centerY = horizon - 120 / z;
    const spin = Math.sin(t * .37 + gate * .6) * .38;
    const points: number[][] = [];
    for (let j = 0; j <= 100; j++) {
      const a = j / 100 * TAU;
      const x = Math.cos(a) * radius, y = Math.sin(a) * radius * 1.3;
      points.push([cx + x * Math.cos(spin) - y * Math.sin(spin) * .3, centerY + y]);
    }
    for (let j = 1; j < points.length; j++) {
      const c = gate % 2 ? cyan : gold;
      p.line(points[j-1][0], points[j-1][1], points[j][0], points[j][1], c, Math.min(.85, .3 + .2 / z));
      if (j % 5 === 0) p.glow(points[j][0], points[j][1], 3 + beat * 4, c, .5);
    }
    // Six-pointed star made from orbiting light, above the caption area.
    if (z > 1.6 && z < 3.6) for (const phase of [-Math.PI / 2, Math.PI / 2]) {
      const pts = Array.from({ length: 3 }, (_, j) => [cx + Math.cos(phase + j * TAU / 3 + t * .06) * radius * .48, centerY + Math.sin(phase + j * TAU / 3 + t * .06) * radius * .48]);
      for (let j = 0; j < 3; j++) p.line(pts[j][0], pts[j][1], pts[(j+1)%3][0], pts[(j+1)%3][1], gold, .6);
    }
  }
  // Foreground currents move toward the viewer as the wave surface undulates.
  for (let row = 0; row < 45; row++) {
    const d = fract(row / 45 + t * .035), y = horizon + d * d * (H - horizon);
    for (let x = 0; x < W; x += 2) {
      const wave = Math.sin(x * .028 + t * 1.8 + row) * (2 + d * 13);
      p.dot(x, y + wave, row % 4 ? cyan : gold, (.08 + beat * .07) * d);
    }
  }
  return out;
}
