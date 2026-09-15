const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { validateExcerpts, validateTreatments, dailySchedule, QUIET_DEFAULTS } = require('../lib/studio.ts');
const { parseLyrics } = require('../lib/lyric-video.ts');
const { energyExcerpts } = require('../lib/suggest-excerpts.ts');

test('rejects excerpts outside the song and non-finite bounds', () => {
  for (const item of [{ start: -1, duration: 20 }, { start: 100, duration: 20 }, { start: 0, duration: 46 }, { start: NaN, duration: 20 }]) assert.throws(() => validateExcerpts([{ ...item, lyrics: 'hello' }], 110));
  assert.equal(validateExcerpts([{ start: 90, duration: 20, lyrics: 'hello' }], 110).length, 1);
  assert.throws(() => validateExcerpts([{ start: 0, duration: 20, lyrics: '' }], 110));
});
test('asset-dependent treatments cannot be queued without their source', () => {
  assert.throws(() => validateTreatments(['artwork'], {}));
  assert.throws(() => validateTreatments(['performance'], {}));
  assert.throws(() => validateTreatments(['__proto__'], {}));
  assert.deepEqual(validateTreatments(['kinetic', 'kinetic', 'visualizer'], {}), ['kinetic', 'visualizer']);
});
test('preserves fractional lyric timing, skips timestamp-only rows and ends at clip boundary', () => {
  const lyrics = parseLyrics('[0:00.125] First\n[0:04.750]\nSecond\n[0:09.900] Last', 10);
  assert.deepEqual(lyrics, [{ text: 'First', start: .125, end: 4.75 }, { text: 'Second', start: 4.75, end: 9.9 }, { text: 'Last', start: 9.9, end: 10 }]);
});
test('posting schedule respects the actual daily UTC job across DST', () => {
  assert.deepEqual(dailySchedule('2026-10-31', 3, Date.parse('2026-10-30')), ['2026-10-31T14:00:00.000Z', '2026-11-01T14:00:00.000Z', '2026-11-02T14:00:00.000Z']);
  assert.throws(() => dailySchedule('2026-02-31', 1, 0));
  assert.throws(() => dailySchedule('2026-01-01', 1, Date.parse('2026-01-02')));
});
test('energy suggestions favor loud sections and do not overlap', () => {
  const samples = new Float32Array(100 * 1000);
  samples.fill(.1); samples.fill(.8, 25000, 45000); samples.fill(1, 65000, 85000);
  const starts = energyExcerpts(samples, 1000, 3, 20);
  assert.ok(starts.includes(25)); assert.ok(starts.includes(65));
  assert.ok(starts.every((start, i) => i === 0 || start - starts[i - 1] >= 20));
});
test('routine notifications default off, failures stay visible', () => {
  assert.deepEqual(QUIET_DEFAULTS, { daily_reminders: false, weekly_summary: false, failure_alerts: true });
});

if (process.env.TEST_RENDER === '1') test('renders every treatment with real FFmpeg at 1080 × 1920', { timeout: 240000 }, async () => {
  const { run } = require('../lib/lyric-video.ts');
  const { renderStudioVideo } = require('../lib/studio-render.ts');
  const dir = path.resolve('.studio-test'); fs.mkdirSync(dir, { recursive: true });
  await run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', path.join(dir, 'tone.wav')]);
  await run(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30', '-t', '12', '-threads', '2', '-c:v', 'libx264', '-preset', 'ultrafast', path.join(dir, 'performance.mp4')]);
  await run(['-y', '-f', 'lavfi', '-i', 'color=c=0x756398:s=1200x1200', '-frames:v', '1', path.join(dir, 'artwork.png')]);
  for (const treatment of ['kinetic', 'visualizer', 'artwork', 'performance']) {
    const background = treatment === 'artwork' ? fs.readFileSync(path.join(dir, 'artwork.png')) : treatment === 'performance' ? fs.readFileSync(path.join(dir, 'performance.mp4')) : undefined;
    const result = await renderStudioVideo({ audio: fs.readFileSync(path.join(dir, 'tone.wav')), background, treatment, title: 'Studio render test', lyrics: '[0:00] Let the music\n[0:04.500] Find you tonight', start: 1, duration: 10 });
    const output = path.join(dir, `${treatment}.mp4`); fs.writeFileSync(output, result.video); fs.writeFileSync(path.join(dir, `${treatment}.jpg`), result.thumb);
    assert.ok(result.video.length > 10000);
    // Decode every frame, then check the container's reported dimensions and duration.
    await run(['-v', 'error', '-i', output, '-f', 'null', '-']);
    const probe = require('node:child_process').spawnSync(require('ffmpeg-static'), ['-hide_banner', '-i', output], { encoding: 'utf8', windowsHide: true });
    assert.match(probe.stderr, /1080x1920/);
    assert.match(probe.stderr, /Duration: 00:00:10/);
  }
});
