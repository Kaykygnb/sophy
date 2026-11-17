module.exports = {
  testDir: 'tests/e2e',
  testMatch: '*.spec.js',
  globalTeardown: './tests/e2e/teardown.js',
  workers: 1,
  timeout: 60000,
  reporter: 'list',
};
