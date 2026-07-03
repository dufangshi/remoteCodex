import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

type AgentBackendId = 'claude' | 'opencode';

type ThreadSummary = {
  id: string;
  status: string;
  activeTurnId?: string | null;
};

type ThreadDetail = {
  thread: ThreadSummary;
  pendingSteers: Array<{ id: string; prompt: string }>;
  turns: Array<{
    items: Array<{ kind: string; text?: string | null }>;
  }>;
};

const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const workspaceRoot = path.resolve(
  process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
);

test.describe('Phase 4 running-turn queued continuation', () => {
  test.skip(
    process.env.REMOTE_CODEX_REAL_BACKEND_E2E !== '1',
    'Set REMOTE_CODEX_REAL_BACKEND_E2E=1 to run real Claude/OpenCode queued-continuation E2E.',
  );

  for (const scenario of [
    {
      provider: 'claude' as const,
      model: 'haiku',
      startPrefix: 'PHASE4_WEB_CLAUDE_QUEUE_START',
      appendPrefix: 'PHASE4_WEB_CLAUDE_QUEUE_APPEND',
    },
    {
      provider: 'opencode' as const,
      model: 'opencode/mimo-v2.5-free',
      startPrefix: 'PHASE4_WEB_OPENCODE_QUEUE_START',
      appendPrefix: 'PHASE4_WEB_OPENCODE_QUEUE_APPEND',
    },
  ]) {
    test(`queues a ${scenario.provider} continuation from the Web composer`, async ({
      page,
    }) => {
      await requireBackendReady(scenario.provider);

      const suffix = randomUUID().slice(0, 8).toUpperCase();
      const startMarker = `${scenario.startPrefix}_${suffix}`;
      const appendMarker = `${scenario.appendPrefix}_${suffix}`;
      const workspace = await createWorkspace(`phase4-${scenario.provider}-${suffix}`);
      const thread = await createThread({
        workspaceId: workspace.id,
        provider: scenario.provider,
        model: scenario.model,
        title: `Phase 4 ${scenario.provider} queued continuation ${suffix}`,
      });

      await page.goto(`/threads/${thread.id}`);
      await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();

      const startingPrompt = [
        'Run a short blocking command before replying:',
        "python3 - <<'PY'",
        'import time',
        'time.sleep(12)',
        'PY',
        `After the command finishes, reply with exactly: ${startMarker}`,
      ].join('\n');
      await submitPromptFromComposer(page, startingPrompt);
      await waitForThreadActiveTurn(thread.id);

      const queuedPrompt = `After the current turn completes, reply with exactly: ${appendMarker}`;
      await submitPromptFromComposer(page, queuedPrompt);

      await expect(page.getByText(queuedPrompt).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText('Cancel').first()).toBeVisible({
        timeout: 15_000,
      });
      await waitForPendingSteer(thread.id, queuedPrompt);
      await waitForThreadText(thread.id, startMarker, 180_000);
      await waitForThreadText(thread.id, appendMarker, 180_000);

      await page.reload();
      await expect(page.getByText(startMarker).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(appendMarker).first()).toBeVisible({
        timeout: 30_000,
      });
    });
  }
});

async function submitPromptFromComposer(page: Page, prompt: string) {
  const editor = page.getByRole('textbox', { name: 'Prompt' });
  await editor.fill(prompt);
  await page.getByRole('button', { name: 'Send Prompt' }).click();
}

async function createWorkspace(name: string) {
  const absPath = path.join(workspaceRoot, name);
  await fs.mkdir(absPath, { recursive: true });
  await fs.writeFile(path.join(absPath, 'README.md'), `# ${name}\n`);
  return postJson<{ id: string }>('/api/workspaces', {
    absPath,
    label: name,
  });
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

async function waitForPendingSteer(
  threadId: string,
  prompt: string,
  timeoutMs = 30_000,
) {
  await pollUntil(
    async () =>
      (await getThreadDetail(threadId)).pendingSteers.some(
        (steer) => steer.prompt === prompt,
      ),
    `thread ${threadId} to expose pending queued prompt`,
    timeoutMs,
  );
}

async function waitForThreadActiveTurn(threadId: string, timeoutMs = 30_000) {
  await pollUntil(
    async () => Boolean((await getThreadDetail(threadId)).thread.activeTurnId),
    `thread ${threadId} to expose an active turn id`,
    timeoutMs,
  );
}

async function waitForThreadText(
  threadId: string,
  text: string,
  timeoutMs: number,
) {
  await pollUntil(
    async () => detailText(await getThreadDetail(threadId)).includes(text),
    `thread ${threadId} transcript to contain ${text}`,
    timeoutMs,
  );
}

function detailText(detail: ThreadDetail) {
  return detail.turns
    .flatMap((turn) => turn.items)
    .map((item) => item.text ?? '')
    .join('\n');
}

async function getThreadDetail(threadId: string) {
  return getJson<ThreadDetail>(`/api/threads/${threadId}?limit=30`);
}

async function getJson<T>(path: string) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
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
