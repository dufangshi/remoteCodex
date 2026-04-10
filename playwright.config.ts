import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: {
    timeout: 20_000
  },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'pnpm --filter @remote-codex/supervisor-api dev',
      url: 'http://127.0.0.1:8787/healthz',
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: 'pnpm --filter @remote-codex/supervisor-web dev -- --host localhost --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome']
      }
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5']
      }
    }
  ]
});
