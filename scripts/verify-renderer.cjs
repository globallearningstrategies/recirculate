// Run on the deployment's OS with the actual binary that ships to production.
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['--test', 'tests/cosmic.test.cjs', 'tests/cinematic.test.cjs', 'tests/cinematic-api.test.cjs'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, TEST_RENDER: '1', COSMIC_TEST_DURATION: '20' },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
// Production preflight is read-only: verify the saved key without generating media.
if (process.env.VERCEL_ENV === 'production') {
  (async () => {
    const key = process.env.RUNWAYML_API_SECRET?.trim();
    if (!key) throw new Error('RUNWAYML_API_SECRET is missing from Production.');
    const response = await fetch('https://api.dev.runwayml.com/v1/organization', { headers: { Authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Runway connection check failed (HTTP ${response.status}).`);
    const org = await response.json();
    if (typeof org.creditBalance !== 'number') throw new Error('Runway returned an invalid organization response.');
    console.log('Runway API connection verified; no generation submitted.');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
