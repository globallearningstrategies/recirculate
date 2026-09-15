// Local-only browser test. Generates a temporary development preview route,
// mocks every backend request, and removes the route when finished.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'app', 'studio-preview');
if (fs.existsSync(fixture)) throw new Error('Refusing to overwrite an existing preview route.');
fs.mkdirSync(fixture);
fs.writeFileSync(path.join(fixture, 'page.tsx'), `import { notFound } from 'next/navigation';\nimport Studio from '../studio/studio';\nimport '../studio/studio.css';\nexport default function Preview(){if(process.env.NODE_ENV !== 'development')notFound();return <Studio/>;}`);
const out = path.join(root, '.studio-test'); fs.mkdirSync(out, { recursive: true });
const log = fs.openSync(path.join(out, 'browser-server.log'), 'w');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3011'], { cwd: root, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4101', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only-public-key' } });
let browser;
(async () => {
  try {
    for (let i = 0; i < 90; i++) {
      try { const r = await fetch('http://localhost:3011/studio-preview'); if (r.ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    let jobs = [], prefs = { daily_reminders: false, weekly_summary: false, failure_alerts: true }, scheduleBody;
    const songId = '11111111-1111-4111-8111-111111111111';
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    await page.route('http://127.0.0.1:4101/**', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      let json;
      if (url.includes('/rest/v1/songs?')) json = route.request().method() === 'POST' ? { id: songId, title: route.request().postDataJSON().title, slug: 'new-song' } : [{ id: songId, title: 'Let the music find you', slug: 'music' }];
      else if (url.includes('/rest/v1/song_assets?')) json = { song_id: songId, audio_path: 'test/audio.mp3', audio_name: 'Original master.mp3', duration: 120, artwork_path: null, performance_path: null, lyrics: '' };
      else if (url.includes('/rest/v1/social_connections?')) json = [{ platform: 'instagram', username: 'realjordancohen', external_user_id: 'account-1' }];
      else if (url.includes('/rest/v1/scheduled_posts?')) json = [];
      else if (url.includes('/storage/v1/object/sign/')) json = { signedURL: '/object/test/audio.mp3' };
      else if (url.includes('/storage/v1/object/test/')) return route.fulfill({ path: path.join(out, 'tone.wav'), contentType: 'audio/wav', headers });
      else throw new Error(`Unexpected Supabase request: ${url}`);
      await route.fulfill({ json, headers });
    });
    await page.route('**/api/studio/**', async (route) => {
      const url = route.request().url(), method = route.request().method();
      let json = { ok: true };
      if (url.endsWith('/preferences')) { if (method === 'PUT') prefs = route.request().postDataJSON(); json = prefs; }
      else if (url.endsWith('/batches') && method === 'GET') json = { jobs };
      else if (url.endsWith('/batches')) {
        const body = route.request().postDataJSON();
        assert.equal(body.songId, songId); assert.equal(body.excerpts[0].duration, 10);
        jobs = body.treatments.map((treatment, i) => ({ id: `job-${i}`, batch_id: 'batch-1', song_id: songId, title: `Let the music find you · 1 · ${treatment}`, treatment, start_seconds: 0, duration_seconds: 10, lyrics: body.excerpts[0].lyrics, status: 'queued', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
        json = { batchId: 'batch-1', count: jobs.length };
      } else if (url.endsWith('/render')) {
        const job = jobs.find((j) => j.id === route.request().postDataJSON().jobId);
        job.status = 'ready'; job.clip_id = job.id; job.video_url = '/test-media/kinetic.mp4'; job.thumb_url = '/test-media/kinetic.jpg';
      } else if (url.endsWith('/revisions')) {
        const body = route.request().postDataJSON();
        assert.ok(body.lyrics.includes('אני לדודי ודודי לי'));
        const source = jobs.find(j => j.id === body.jobId);
        jobs.push({ ...source, id: 'revised-job', status: 'queued', lyrics: body.lyrics, video_url: undefined, thumb_url: undefined, clip_id: null });
        json = { jobId: 'revised-job' };
      } else if (url.endsWith('/schedule')) { scheduleBody = route.request().postDataJSON(); json = { count: scheduleBody.jobIds.length, destination: 'realjordancohen' }; }
      else throw new Error(`Unexpected studio request: ${url}`);
      await route.fulfill({ json });
    });
    await page.route('**/test-media/*', (route) => route.fulfill({ path: path.join(out, path.basename(new URL(route.request().url()).pathname)) }));
    await page.goto('http://localhost:3011/studio-preview');
    await page.getByText('One song.', { exact: false }).waitFor();
    await page.getByLabel('New song title').fill('My song');
    assert.equal(await page.getByRole('button', { name: 'Add song', exact: true }).isEnabled(), true);
    await page.getByLabel('Song audio or original video').setInputFiles(path.join(out, 'tone.wav'));
    await page.waitForFunction(() => document.querySelector('audio')?.duration > 0);
    assert.equal(await page.getByRole('button', { name: 'Save song', exact: true }).isEnabled(), true, 'A chosen file can be saved without a separate song-creation step');
    await page.getByRole('button', { name: 'Add song', exact: true }).click();
    await page.getByLabel('New song title').waitFor();
    await page.waitForFunction(() => document.querySelector('.studio-create select').value !== '');
    assert.equal(await page.locator('.studio-panel > audio').count(), 1, 'Creating a song preserves the selected audio');
    assert.equal(await page.getByRole('button', { name: 'Save song', exact: true }).isEnabled(), true);
    await page.locator('.studio-create select').first().selectOption('');
    await page.locator('.studio-create select').first().selectOption(songId);
    await page.getByText('Original master.mp3', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Daily posting reminders').isChecked(), false);
    assert.equal(await page.getByLabel('Weekly performance email').isChecked(), false);
    await page.screenshot({ path: path.join(out, 'studio-desktop.png'), fullPage: true });
    await page.getByLabel('Length (seconds)').fill('10');
    await page.getByText('Paste lyrics to create phrase cards').click();
    await page.getByLabel('Paste lyrics', { exact: true }).fill('[0:00.125] Let the music\n[0:04.750] Find you tonight');
    await page.getByRole('button', { name: 'Replace cards with pasted lyrics' }).click();
    await page.getByLabel('Phrase 1 end', { exact: true }).fill('3');
    assert.equal(await page.getByLabel('Phrase 1 end', { exact: true }).inputValue(), '3');
    assert.equal(await page.getByRole('button', { name: /Cosmic Dreamcore/ }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: /Bold lyrics/ }).click();
    await page.getByRole('button', { name: 'Create 2 drafts' }).click();
    await page.getByText('2 drafts queued.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Render / resume batch' }).click();
    await page.getByText('2/2 ready').waitFor();
    await page.locator('.studio-video-info input[type=checkbox]').first().check();
    assert.equal(await page.getByRole('button', { name: 'Schedule 1 selected clip' }).isEnabled(), false);
    await page.locator('.studio-scheduling select').selectOption('instagram:account-1');
    await page.getByLabel('Publish these clips to realjordancohen on instagram.').check();
    await page.screenshot({ path: path.join(out, 'studio-review.png'), fullPage: true });
    await page.getByRole('button', { name: 'Schedule 1 selected clip' }).click();
    await page.getByText('1 clips scheduled for realjordancohen.').waitFor();
    assert.equal(scheduleBody.accountId, 'account-1'); assert.equal(scheduleBody.jobIds.length, 1);
    await page.getByRole('button', { name: 'Edit lyrics / make new version' }).first().click();
    await page.getByLabel('Phrase 2 text', { exact: true }).fill('אני לדודי ודודי לי');
    assert.equal(await page.getByLabel('Phrase 2 text', { exact: true }).getAttribute('dir'), 'auto');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, 'phrase-editor-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Phrase editor fits mobile');
    await page.getByRole('button', { name: 'Save corrected draft' }).click();
    await page.getByText('Corrected lyrics saved as a new draft.', { exact: false }).waitFor();
    assert.equal(jobs.filter(j => j.status === 'ready').length, 2, 'Original videos remain available');
    assert.equal(jobs.find(j => j.id === 'revised-job').status, 'queued');
    await page.getByLabel('Daily posting reminders').click();
    await page.getByText('Notification preferences saved.').waitFor();
    assert.equal(prefs.daily_reminders, true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '01 Song & excerpts' }).click();
    await page.screenshot({ path: path.join(out, 'studio-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'Mobile horizontal overflow');
    assert.deepEqual(errors, []);
    // A missing JavaScript bundle must leave a usable, server-rendered recovery link.
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const stalled = await noJs.newPage();
    await stalled.goto('http://localhost:3011/studio-preview');
    assert.equal(await stalled.getByRole('link', { name: 'reload the studio', exact: true }).isVisible(), true);
    await noJs.close();
    // A failing optional endpoint must not leave loading forever or block typing a title.
    await page.route('**/api/studio/preferences', route => route.fulfill({ status: 503, json: { error: 'Settings temporarily unavailable ' + 'long-render-error:'.repeat(100) } }));
    await page.reload();
    await page.getByRole('alert').filter({ hasText: 'Settings temporarily unavailable' }).waitFor();
    await page.getByLabel('New song title').fill('Still works');
    assert.equal(await page.getByRole('button', { name: 'Add song', exact: true }).isEnabled(), true);
    assert.equal(await page.getByLabel('Daily posting reminders').isEnabled(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Long errors must not widen the mobile page');
    console.log('PASS: create batch, render/resume, select, destination approval, schedule, quiet preferences, desktop and mobile layout; all backend requests mocked.');
  } finally {
    if (browser) await browser.close();
    server.kill(); fs.closeSync(log);
    fs.unlinkSync(path.join(fixture, 'page.tsx')); fs.rmdirSync(fixture);
    fs.rmSync(path.join(root, '.next', 'types', 'app', 'studio-preview', 'page.ts'), { force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
