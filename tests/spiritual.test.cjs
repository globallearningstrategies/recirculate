const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { spiritualFrame } = require('../lib/spiritual-motion.ts');
const { validateTreatments } = require('../lib/studio.ts');

test('spiritual motion needs no uploaded artwork and retains the four-treatment batch cap', () => {
  assert.deepEqual(validateTreatments(['spiritual'], {}), ['spiritual']);
  assert.throws(() => validateTreatments(['spiritual', 'kinetic', 'visualizer', 'artwork', 'performance'], { artwork_path: 'a', performance_path: 'b' }));
});
test('motion frames are reproducible, evolve between scenes, and react to audio', () => {
  const a = spiritualFrame(2, 20, 0, 3);
  assert.equal(a.length, 540 * 960 * 3);
  assert.deepEqual(a, spiritualFrame(2, 20, 0, 3));
  assert.notDeepEqual(a, spiritualFrame(2, 20, 1, 3));
  assert.notDeepEqual(a, spiritualFrame(10, 20, 0, 3));
  assert.notDeepEqual(a, spiritualFrame(16, 20, 0, 3));
});
if (process.env.TEST_RENDER === '1') test('renders a bilingual spiritual sample and decodes the complete MP4', { timeout: 240000 }, async () => {
  const { run } = require('../lib/lyric-video.ts');
  const { renderStudioVideo } = require('../lib/studio-render.ts');
  const dir = path.resolve('.studio-test'); fs.mkdirSync(dir, { recursive: true });
  await run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=23', '-af', 'tremolo=f=1:d=0.7', path.join(dir, 'spiritual-tone.wav')]);
  const before = Date.now();
  const result = await renderStudioVideo({ audio: fs.readFileSync(path.join(dir, 'spiritual-tone.wav')), treatment: 'spiritual', title: 'SPIRITUAL JOURNEY', lyrics: '[0:00] A light within\n[0:05] אור של תקווה\n[0:10] Together ביחד\n[0:15] Let the light flow', start: 2, duration: 20 });
  console.log(`Spiritual render: ${((Date.now() - before) / 1000).toFixed(1)}s`);
  const output = path.join(dir, 'spiritual-demo.mp4'); fs.writeFileSync(output, result.video);
  await run(['-v', 'error', '-i', output, '-f', 'null', '-']);
  const probe = require('node:child_process').spawnSync(require('ffmpeg-static'), ['-hide_banner', '-i', output], { encoding: 'utf8', windowsHide: true });
  assert.match(probe.stderr, /1080x1920/); assert.match(probe.stderr, /Duration: 00:00:20/); assert.match(probe.stderr, /Audio: aac/);
  for (const t of [2, 7, 12, 17]) await run(['-y', '-ss', String(t), '-i', output, '-frames:v', '1', '-vf', 'scale=540:-2', path.join(dir, `spiritual-${t}.jpg`)]);
});
