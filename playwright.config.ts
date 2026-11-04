import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: 'tests/e2e', timeout: 30000, expect: { timeout: 6000 }, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4320', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: fs.existsSync(chrome) ? { executablePath: chrome } : {} },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 850 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'npm run build && tsx tests/e2e-server.ts', url: 'http://127.0.0.1:4320/api/health', reuseExistingServer: false, timeout: 120000 },
});
