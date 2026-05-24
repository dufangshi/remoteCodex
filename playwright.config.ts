import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const webPort = Number(process.env.E2E_WEB_PORT ?? 5173);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webBaseUrl = `http://localhost:${webPort}`;
const e2eDatabaseUrl = path.resolve(process.env.E2E_DATABASE_URL ?? `.local/e2e-${apiPort}.sqlite`);
const e2eWorkspaceRoot = path.resolve(process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright');

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: {
    timeout: 20_000
  },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: webBaseUrl,
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: `PORT=${apiPort} DATABASE_URL=${e2eDatabaseUrl} WORKSPACE_ROOT=${e2eWorkspaceRoot} pnpm --filter @remote-codex/supervisor-api dev`,
      url: `${apiBaseUrl}/healthz`,
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: `VITE_API_PROXY_TARGET=${apiBaseUrl} VITE_WS_PROXY_TARGET=ws://127.0.0.1:${apiPort} pnpm --filter @remote-codex/supervisor-web exec vite --host localhost --port ${webPort} --strictPort`,
      url: webBaseUrl,
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
