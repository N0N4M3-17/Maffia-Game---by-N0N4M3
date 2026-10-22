const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/ui', timeout: 30000, workers: 1,
  outputDir: 'artifacts/playwright',
  use: { baseURL: 'http://127.0.0.1:3028', browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : process.env.CI ? {} : { channel: 'chrome' } },
  webServer: { command: 'node scripts/preview-host.cjs', url: 'http://127.0.0.1:3028', reuseExistingServer: !process.env.CI, timeout: 30000 },
});
