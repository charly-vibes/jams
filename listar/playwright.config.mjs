// Purpose: configure the chromium acceptance harness for the Listar workspace flows.
// Responsibilities: point Playwright at the browser spec directory with the local static server.
// Rationale: the ticket scope is a minimal reproducible gate; one browser project, no projects to skip.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  timeout: 30_000,
  webServer: {
    command: 'node test/browser/serve.mjs',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
