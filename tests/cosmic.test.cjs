const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { validateTreatments } = require('../lib/studio.ts');
const { studioSubtitles } = require('../lib/studio-subtitles.ts');
test('subtitle timings, bilingual text and literal override characters', () => {
  const ass = studioSubtitles('Title', [{ start: 1.125, end: 5, text: 'Hello שלום\n{\\pos(0,0)} 100%' }], 20, true, true);
  assert.match(ass, /0:00:01\.13,0:00:05\.00/);
  assert.ok(ass.includes('Hello שלום\\N｛＼pos(0,0)｝ 100%'));
  assert.ok(!ass.includes('{\\pos(0,0)}'));
  assert.ok(ass.includes('DejaVu Sans'));
});
test('cosmic backgrounds are bundled and require no uploaded background', () => {
  assert.deepEqual(validateTreatments(['cosmic'], {}), ['cosmic']);
  for (const scene of ['gateway', 'ocean']) assert.ok(fs.statSync(path.join(__dirname, '..', 'public', 'dreamcore', scene + '.jpg')).size > 10000);
});
if (process.env.TEST_RENDER === '1') test('renders both dreamscapes with bilingual lyrics and the complete audio excerpt', { timeout: 240000 }, async () => {
  const { run } = require('../lib/lyric-video.ts');
  const { renderStudioVideo } = require('../lib/studio-render.ts');
  const dir = path.resolve('.studio-test'); fs.mkdirSync(dir, { recursive: true });
  await run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=48', path.join(dir, 'cosmic-tone.wav')]);
  const duration = Number(process.env.COSMIC_TEST_DURATION || 20), before = Date.now();
  const result = await renderStudioVideo({ audio: fs.readFileSync(path.join(dir, 'cosmic-tone.wav')), treatment: 'cosmic', title: 'COSMIC DREAMCORE', lyrics: '[0:00] A light within\n[0:05] אור של תקווה\n[0:10] Together ביחד\n[0:15] Let the light flow', start: 2, duration });
  console.log(`Cosmic ${duration}s render: ${((Date.now()-before)/1000).toFixed(1)}s`);
  const output = path.join(dir, 'cosmic-demo.mp4'); fs.writeFileSync(output, result.video);
  await run(['-v', 'error', '-i', output, '-f', 'null', '-']);
  const probe = require('node:child_process').spawnSync(require('ffmpeg-static'), ['-hide_banner', '-i', output], { encoding: 'utf8', windowsHide: true });
  assert.match(probe.stderr, /1080x1920/); assert.match(probe.stderr, new RegExp(`Duration: 00:00:${duration}`)); assert.match(probe.stderr, /Audio: aac/);
  for (const t of [2, 7, Math.floor(duration/2), duration-3]) await run(['-y', '-ss', String(t), '-i', output, '-frames:v', '1', '-vf', 'scale=540:-2', path.join(dir, `cosmic-${t}.jpg`)]);
});
