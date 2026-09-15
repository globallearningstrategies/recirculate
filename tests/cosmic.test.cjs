const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { validateTreatments } = require('../lib/studio.ts');
const { studioSubtitles } = require('../lib/studio-subtitles.ts');
const { parseCues, serializeCues, validateCues, wordCues } = require('../lib/lyric-cues.ts');
test('explicit phrase endings preserve silence, Hebrew and editable timing', () => {
  const cues = [{ text: 'Come to me', start: .125, end: 2.4 }, { text: 'אני לדודי', start: 4.5, end: 6.1 }];
  assert.deepEqual(parseCues(serializeCues(cues), 10), cues);
  validateCues(cues, 10);
  assert.throws(() => validateCues([{ ...cues[0], end: 5 }, cues[1]], 10), /overlap/);
  assert.throws(() => validateCues([{ ...cues[0], end: 11 }], 10));
  const ass = studioSubtitles('Song', cues, 10, true, true);
  assert.match(ass, /0:00:00\.13,0:00:02\.40,Lyrics/);
  assert.match(ass, /0:00:04\.50,0:00:06\.10,Lyrics/);
  assert.match(ass, /0:00:02\.50,Title/);
});
test('word timings stop phrases at singing boundaries and old verses become short phrases', () => {
  const cues = wordCues([{word:'Come',start:0,end:.5},{word:'home.',start:.5,end:1.1},{word:'שלום',start:3,end:3.6}], 10);
  assert.equal(cues.length, 2); assert.equal(cues[0].end, 1.1); assert.equal(cues[1].start, 3);
  const old = parseCues('[0:00] This is a long verse with many words that should never stay on screen together for the entire song', 20);
  assert.ok(old.length > 2); assert.ok(old.every(c => c.text.length <= 42)); validateCues(old,20);
});
test('subtitle timings, bilingual text and literal override characters', () => {
  const ass = studioSubtitles('Title', [{ start: 1.125, end: 5, text: 'Hello שלום\n{\\pos(0,0)} 100%' }], 20, true, true);
  assert.match(ass, /0:00:01\.13,0:00:05\.00/);
  assert.ok(ass.includes('Hello שלום\\N｛＼pos(0,0)｝ 100%'));
  assert.ok(!ass.includes('{\\pos(0,0)}'));
  assert.ok(ass.includes('DejaVu Sans'));
});
test('cosmic animation changes geometry and water between frames without a background upload', () => {
  assert.deepEqual(validateTreatments(['cosmic'], {}), ['cosmic']);
  const { cosmicFrame } = require('../lib/cosmic-motion.ts');
  const a = cosmicFrame(1, 20, .2, 3), b = cosmicFrame(2, 20, .2, 3);
  assert.equal(a.length, 540 * 960 * 3);
  assert.notDeepEqual(a.subarray(0, 540 * 450 * 3), b.subarray(0, 540 * 450 * 3));
  assert.notDeepEqual(a.subarray(540 * 650 * 3), b.subarray(540 * 650 * 3));
  assert.deepEqual(a, cosmicFrame(1, 20, .2, 3));
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
