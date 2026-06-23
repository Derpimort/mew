import { defineConfig, devices } from '@playwright/test'

/* End-to-end config — the three core user journeys (talk-to-schedule, a mew,
   drift) driven through the REAL built app with the deterministic, keyless
   rules floor (no model key → no network) and a fixed clock (`?t=HH:MM`).
   These supplement the unit suites: they verify the UI→adapter→store glue,
   never re-test domain logic. See app/e2e/core-flows.spec.ts.

   The webServer serves the BUILT bundle (acceptance: "against the built app"):
   `pnpm build` then `vite preview` on PORT. Locally a dev server already on
   PORT is reused; CI always builds fresh. Traces + a video are captured on
   failure so a flake is root-caused from the artifact, never guessed at. */

const PORT = Number(process.env.E2E_PORT ?? 5173)
export const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  /* a deterministic suite has no business being flaky — never silently retry it
     into green; a real failure must surface (exit 1). One worker keeps the
     shared port + fixed clock unambiguous. */
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: './e2e/.artifacts/report' }]]
    : [['list']],
  outputDir: './e2e/.artifacts/results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
