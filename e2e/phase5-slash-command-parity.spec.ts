import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

type AgentBackendId = 'claude' | 'opencode';

type ThreadSummary = {
  id: string;
  title: string;
  status: string;
};

type ThreadDetail = {
  thread: ThreadSummary;
  turns: Array<{
    items: Array<{ kind: string; text?: string | null }>;
  }>;
};

const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const workspaceRoot = path.resolve(
  process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
);

test.describe('Phase 5 slash command parity', () => {
  test.skip(
    process.env.REMOTE_CODEX_REAL_BACKEND_E2E !== '1',
    'Set REMOTE_CODEX_REAL_BACKEND_E2E=1 to run real Claude/OpenCode slash-command E2E.',
  );

  test('shows Claude SDK slash commands and unsupported /btw in the Web composer', async ({
    page,
  }) => {
    await requireBackendReady('claude');
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const workspace = await createWorkspace(`phase5-claude-${suffix}`);
    const thread = await createThread({
      workspaceId: workspace.id,
      provider: 'claude',
      model: 'haiku',
      title: `Phase 5 Claude slash parity ${suffix}`,
    });

    const initMarker = `PHASE5_CLAUDE_SLASH_INIT_${suffix}`;
    await postJson(`/api/threads/${thread.id}/prompt`, {
      prompt: `Reply with exactly ${initMarker}.`,
    });
    await waitForThreadText(thread.id, initMarker, 120_000);
    await waitForBackendToolbox('claude', ['/compact', '/btw']);

    await page.goto(`/threads/${thread.id}`);
    await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();

    await waitForSlashToolboxReady(page, /\/compact/i);
    await closeSlashMenu(page);
    await openSlashMenuByTypingSlash(page);
    await expect(page.getByRole('button', { name: /\/compact/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /\/btw/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /\/mcp/i })).toBeVisible();

    await page.getByRole('button', { name: /\/compact/i }).click();
    await expect(page.getByRole('textbox', { name: 'Prompt' })).toContainText(
      '/compact',
    );

    await clearPrompt(page);
    await openSlashMenuByTypingSlash(page);
    await page.getByRole('button', { name: /\/mcp/i }).click();
    await expect(
      page.getByText(/MCP servers|No MCP servers|Loading MCP servers/i).first(),
    ).toBeVisible();
  });

  test('shows OpenCode slash commands without Claude-only entries in the Web composer', async ({
    page,
  }) => {
    await requireBackendReady('opencode');
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const workspace = await createWorkspace(`phase5-opencode-${suffix}`);
    const thread = await createThread({
      workspaceId: workspace.id,
      provider: 'opencode',
      model: 'opencode/mimo-v2.5-free',
      title: `Phase 5 OpenCode slash parity ${suffix}`,
    });

    await page.goto(`/threads/${thread.id}`);
    await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();

    await waitForSlashToolboxReady(page, /\/compact/i);
    await closeSlashMenu(page);
    await openSlashMenuByTypingSlash(page);
    await expect(page.getByRole('button', { name: /\/compact/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /\/fork/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /\/mcp/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /\/btw/i })).toHaveCount(0);
  });
});

async function openSlashMenuByTypingSlash(page: Page) {
  const editor = page.getByRole('textbox', { name: 'Prompt' });
  await editor.click();
  await editor.press('/');
}

async function waitForSlashToolboxReady(page: Page, itemName: RegExp) {
  await page.getByRole('button', { name: 'Open slash toolbox' }).click();
  await expect(page.getByRole('button', { name: itemName })).toBeVisible();
}

async function closeSlashMenu(page: Page) {
  await page.getByRole('button', { name: 'Open slash toolbox' }).click();
  await expect(page.getByText('Slash toolbox')).toHaveCount(0);
}

async function clearPrompt(page: Page) {
  const editor = page.getByRole('textbox', { name: 'Prompt' });
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
}

async function createWorkspace(name: string) {
  const absPath = path.join(workspaceRoot, name);
  await fs.mkdir(absPath, { recursive: true });
  await fs.writeFile(path.join(absPath, 'README.md'), `# ${name}\n`);
  const workspace = await postJson<{ id: string }>('/api/workspaces', {
    absPath,
    label: name,
  });
  return { ...workspace, absPath };
}

async function createThread(input: {
  workspaceId: string;
  provider: AgentBackendId;
  model: string;
  title: string;
}) {
  return postJson<ThreadSummary>('/api/threads/start', {
    workspaceId: input.workspaceId,
    title: input.title,
    provider: input.provider,
    model: input.model,
    approvalMode: 'yolo',
  });
}

async function requireBackendReady(provider: AgentBackendId) {
  const backends = await getJson<Array<{
    provider: string;
    enabled: boolean;
    installation?: { installed?: boolean; lastError?: string | null } | null;
  }>>('/api/agent-runtimes');
  const backend = backends.find((entry) => entry.provider === provider);
  expect(
    backend?.enabled && backend.installation?.installed,
    `${provider} backend must be enabled and installed. lastError=${backend?.installation?.lastError ?? '<none>'}`,
  ).toBe(true);
}

async function waitForBackendToolbox(
  provider: AgentBackendId,
  commands: string[],
  timeoutMs = 30_000,
) {
  await pollUntil(async () => {
    const runtime = await getJson<{
      managementSchema: { toolboxItems: Array<{ command: string }> };
    }>(`/api/agent-runtimes/${provider}/status`);
    const available = new Set(
      runtime.managementSchema.toolboxItems.map((item) => item.command),
    );
    return commands.every((command) => available.has(command));
  }, `${provider} toolbox to include ${commands.join(', ')}`, timeoutMs);
}

async function waitForThreadText(
  threadId: string,
  text: string,
  timeoutMs: number,
) {
  await pollUntil(async () => {
    const detail = await getThreadDetail(threadId);
    return (
      detail.thread.status === 'idle' &&
      JSON.stringify(detail.turns).includes(text)
    );
  }, `thread ${threadId} to contain ${text}`, timeoutMs);
}

async function getThreadDetail(threadId: string) {
  return getJson<ThreadDetail>(`/api/threads/${threadId}?limit=30`);
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
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ''}`,
  );
}
