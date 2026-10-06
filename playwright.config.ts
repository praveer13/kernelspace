import { defineConfig } from '@playwright/test'

// End-to-end keyboard walks (docs/specs/wave-2.md §22.2). `npm run e2e` builds, serves with `vite preview` and runs
// e2e/*.spec.ts at 360 px. The directory sits outside ./tests, so `bun run test` never sees it, and CI runs it
// only in nightly.yml. PW_CHROMIUM_EXECUTABLE points at another Chromium on hosts where the downloaded one
// cannot start (scripts/a11y.mjs reads the same variable).
const PORT = 4173

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 360, height: 800 },
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
})
