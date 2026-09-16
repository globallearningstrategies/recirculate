const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop:true } }).outputText, filename);
const { cinematicPlan } = require('../lib/cinematic.ts');
test('quotes every generated second, including rounded final shots', () => {
  assert.equal(cinematicPlan(5).credits,60);
  assert.equal(cinematicPlan(20).credits,240);
  assert.equal(cinematicPlan(21).credits,300);
  assert.equal(cinematicPlan(45).scenes.length,9);
  assert.throws(() => cinematicPlan(46)); assert.throws(() => cinematicPlan(NaN));
  const plan = cinematicPlan(45);
  assert.equal(new Set(plan.scenes.map(s=>s.prompt)).size,9);
  assert.ok(plan.scenes.every(s=>s.prompt.length<=1000));
});
test('paid calls are not automatically retried and keys stay in authorization headers', async () => {
  const originalFetch = global.fetch, originalKey = process.env.RUNWAYML_API_SECRET;
  process.env.RUNWAYML_API_SECRET='test-only'; let calls=0;
  try {
    global.fetch = async (url, options) => { calls++; assert.equal(options.headers.Authorization,'Bearer test-only'); assert.match(url,/api\.dev\.runwayml\.com/); return new Response('provider secret message',{status:500}); };
    await assert.rejects(require('../lib/runway.ts').runway('text_to_video',{model:'gen4.5'}), /HTTP 500/);
    assert.equal(calls,1);
    await assert.rejects(require('../lib/runway.ts').downloadRunwayVideo('https://localhost/video.mp4'), /unsupported/);
  } finally { global.fetch=originalFetch; if(originalKey===undefined) delete process.env.RUNWAYML_API_SECRET; else process.env.RUNWAYML_API_SECRET=originalKey; }
});
if (process.env.TEST_RENDER==='1') test('assembles changing scenes then overlays bilingual lyrics using a nonzero song offset', {timeout:180000}, async () => {
  const { run }=require('../lib/lyric-video.ts');
  const { assembleScenes }=require('../lib/cinematic-assembly.ts');
  const { renderStudioVideo }=require('../lib/studio-render.ts');
  const dir=path.resolve('.studio-test'); fs.mkdirSync(dir,{recursive:true});
  const scenes=[];
  for (const [i,color] of ['red','blue'].entries()) {
    const output=path.join(dir,`cinematic-source-${i}.mp4`);
    await run(['-y','-f','lavfi','-i',`color=c=${color}:s=360x640:r=24:d=5`,'-c:v','libx264','-pix_fmt','yuv420p',output]);
    scenes.push(fs.readFileSync(output));
  }
  const audioPath=path.join(dir,'cinematic-tone.wav');
  await run(['-y','-f','lavfi','-i','sine=frequency=440:duration=30',audioPath]);
  const background=await assembleScenes(scenes,10);
  const result=await renderStudioVideo({audio:fs.readFileSync(audioPath),background,treatment:'cinematic',title:'TEST',lyrics:'[0:01.000 --> 0:03.000] Hello\n[0:06.000 --> 0:08.000] שלום',start:15,duration:10});
  const file=path.join(dir,'cinematic-test.mp4');fs.writeFileSync(file,result.video);
  await run(['-v','error','-i',file,'-f','null','-']);
  const cp=require('node:child_process'), ffmpeg=require('ffmpeg-static');
  const probe=cp.spawnSync(ffmpeg,['-hide_banner','-i',file],{encoding:'utf8',windowsHide:true});
  assert.match(probe.stderr,/Duration: 00:00:10/);assert.match(probe.stderr,/Audio: aac/);assert.match(probe.stderr,/1080x1920/);
  const pixel=t=>cp.spawnSync(ffmpeg,['-v','error','-ss',String(t),'-i',file,'-vf','crop=2:2:10:10','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true}).stdout;
  assert.ok(pixel(2)[0]>pixel(2)[2]); assert.ok(pixel(7)[2]>pixel(7)[0]);
});
