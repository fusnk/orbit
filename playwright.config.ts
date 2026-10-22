import { defineConfig, devices } from '@playwright/test';

// Layout tests: the real pages in Chromium (what WebView2 runs), with Rust faked (tests/ui/*-fixture.ts).
// Their own port, so they run beside `pnpm tauri dev` on 1420.
const PORT = 1421;

export default defineConfig({
  testDir: 'tests/ui',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1920, height: 1080 },
    // Kept in test-results/, which CI uploads when a layout test fails.
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/tests/ui/player.html`,
    // Never someone else's: another checkout serving on this port would be tested instead,
    // so a busy port fails the run (strictPort) rather than passing on the wrong code.
    reuseExistingServer: false,
  },
});
