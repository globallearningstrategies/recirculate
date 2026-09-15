// Run on the deployment's OS with the actual binary that ships to production.
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['--test', 'tests/cosmic.test.cjs'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, TEST_RENDER: '1', COSMIC_TEST_DURATION: '20' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
