import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const workspaceRoot = path.resolve(
  process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
);

test.describe('runtime install availability', () => {
  test.skip(
    process.env.REMOTE_CODEX_RUNTIME_INSTALL_E2E !== '1',
    'Set REMOTE_CODEX_RUNTIME_INSTALL_E2E=1 with CLAUDE_COMMAND/npm shims to run runtime install E2E.',
  );

  test('shows unavailable Claude, installs it through the UI, and keeps update non-destructive', async ({
    page,
  }) => {
    const stateFile = process.env.REMOTE_CODEX_E2E_CLAUDE_SHIM_STATE;
    expect(
      stateFile,
      'REMOTE_CODEX_E2E_CLAUDE_SHIM_STATE must point at the Claude shim state file.',
    ).toBeTruthy();
    if (!stateFile) {
      return;
    }
    await fs.rm(stateFile, { force: true });

    const workspace = await createWorkspace('runtime-install-availability');
    await pollBackend('claude', (backend) =>
      backend.enabled === false &&
      backend.installation.installed === false &&
      (backend.installation.lastError ?? '').includes('Claude Code command is not available'),
    );

    await page.goto(`/threads/new?workspaceId=${workspace.id}`);
    await expect(page.getByRole('button', { name: /Install Claude/i })).toBeVisible();
    await expect(page.getByText('Not available').filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('select#thread-backend')).not.toHaveValue('claude');

    await page.getByRole('button', { name: /Install Claude/i }).click();
    await expect(page.getByRole('button', { name: /Update Claude/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('select#thread-backend')).toHaveValue('claude');
    await expect(page.locator('select#thread-model')).not.toHaveValue('');

    const installed = await getBackend('claude');
    expect(installed.enabled).toBe(true);
    expect(installed.installation.installed).toBe(true);
    expect(installed.installation.installedVersion).toContain('SDK');

    await page.getByRole('button', { name: /Update Claude/i }).click();
    await expect(page.getByRole('button', { name: /Update Claude/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/Unable to update Claude/i)).toHaveCount(0);

    const updated = await getBackend('claude');
    expect(updated.enabled).toBe(true);
    expect(updated.installation.installed).toBe(true);
  });
});

async function createWorkspace(name: string) {
  const absPath = path.join(workspaceRoot, name);
  await fs.mkdir(absPath, { recursive: true });
  await fs.writeFile(path.join(absPath, 'README.md'), `# ${name}\n`);
  return postJson<{ id: string }>('/api/workspaces', {
    absPath,
    label: name,
  });
}

async function pollBackend(
  provider: string,
  predicate: (backend: AgentBackend) => boolean,
  timeoutMs = 30_000,
) {
  await pollUntil(async () => predicate(await getBackend(provider)), `backend ${provider}`, timeoutMs);
}

async function getBackend(provider: string) {
  const backends = await getJson<Array<AgentBackend & { provider: string }>>(
    '/api/agent-runtimes',
  );
  const backend = backends.find((entry) => entry.provider === provider);
  if (!backend) {
    throw new Error(`Backend not found: ${provider}`);
  }
  return backend;
}

async function getJson<T>(requestPath: string) {
  const response = await fetch(`${apiBaseUrl}${requestPath}`);
  if (!response.ok) {
    throw new Error(
      `${requestPath} failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function postJson<T>(requestPath: string, body: unknown) {
  const response = await fetch(`${apiBaseUrl}${requestPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${requestPath} failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function pollUntil(
  predicate: () => Promise<boolean>,
  description: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ''}`,
  );
}

type AgentBackend = {
  enabled: boolean;
  installation: {
    installed: boolean;
    installedVersion: string | null;
    lastError: string | null;
  };
};
