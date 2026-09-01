import { deflateSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

const enabled = process.env.REMOTE_CODEX_REAL_ACP_E2E === '1';
const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const workspaceRoot = path.resolve(
  process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
);

interface ThreadSummary {
  id: string;
  status: string;
  activeTurnId: string | null;
  agentId: string | null;
  fastMode: boolean;
  lastError: string | null;
}

interface ThreadDetail {
  thread: ThreadSummary;
  turns: Array<{
    items: Array<{ kind: string; text: string }>;
  }>;
  pendingRequests: Array<{ id: string }>;
  goal: { objective: string; status: string } | null;
}

function crc32(value: Buffer) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function solidRedPng(width = 24, height = 24) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      scanlines[offset + 1 + x * 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test.describe('real Codex ACP Web parity', () => {
  test.setTimeout(10 * 60_000);
  test.skip(!enabled, 'Set REMOTE_CODEX_REAL_ACP_E2E=1 to run real Codex ACP Web E2E.');

  test('uses negotiated capabilities on desktop and mobile', async ({ page }, testInfo) => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const workspacePath = path.join(
      workspaceRoot,
      `acp-codex-web-${testInfo.project.name}-${suffix.toLowerCase()}`,
    );
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(path.join(workspacePath, 'README.md'), '# Real Codex ACP Web E2E\n');
    await fs.writeFile(path.join(workspacePath, 'solid-red.png'), solidRedPng());
    const threadIds: string[] = [];
    try {
      const workspace = await postJson<{ id: string }>('/api/workspaces', {
        absPath: workspacePath,
        label: `ACP Codex Web ${testInfo.project.name} ${suffix}`,
      });
      const thread = await postJson<ThreadSummary>('/api/threads/start', {
        workspaceId: workspace.id,
        provider: 'acp',
        agentId: 'codex',
        model: 'default',
        approvalMode: 'yolo',
        title: `ACP Codex ${testInfo.project.name} ${suffix}`,
      });
      threadIds.push(thread.id);
      await page.goto(`/threads/${thread.id}`);
      await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
      await assertCodexToolbox(page);

      if (testInfo.project.name === 'mobile-chromium') {
        const marker = `MOBILE_ACP_OK_${suffix}`;
        await submitPrompt(page, `Reply exactly ${marker}.`);
        await expect(page.getByText(marker, { exact: true })).toBeVisible({
          timeout: 180_000,
        });
        await page.reload();
        await expect(page.getByText(marker, { exact: true })).toBeVisible();
        const composer = await page.getByRole('textbox', { name: 'Prompt' }).boundingBox();
        expect(composer).not.toBeNull();
        expect(composer!.x).toBeGreaterThanOrEqual(0);
        expect(composer!.x + composer!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
        return;
      }

      await toggleFastMode(page);
      await pollUntil(async () => (await getThread(thread.id)).thread.fastMode, 'fast mode');

      await page.locator('input[type="file"][accept="image/*"]').setInputFiles(
        path.join(workspacePath, 'solid-red.png'),
      );
      await submitPrompt(
        page,
        `Inspect the attached image. If it is red, reply exactly WEB_IMAGE_OK_${suffix}.`,
      );
      await expect(page.getByText(`WEB_IMAGE_OK_${suffix}`, { exact: true })).toBeVisible({
        timeout: 180_000,
      });
      await waitForThreadIdle(thread.id);

      await submitPrompt(
        page,
        `Run a shell sleep for 3 seconds, then reply exactly WEB_STEER_BASE_${suffix}.`,
      );
      await pollUntil(
        async () => Boolean((await getThread(thread.id)).thread.activeTurnId),
        'active turn before steering',
      );
      await submitPrompt(
        page,
        `Replace the final reply with exactly WEB_STEER_OK_${suffix}.`,
      );
      await expect(page.getByText(`WEB_STEER_OK_${suffix}`, { exact: true })).toBeVisible({
        timeout: 180_000,
      });
      await waitForThreadIdle(thread.id);

      await runToolboxAction(page, /\/compact/i);
      await pollUntil(
        async () => (await getThread(thread.id)).thread.status !== 'running',
        'compact completion',
        180_000,
      );
      await submitPrompt(page, `Reply exactly WEB_COMPACT_OK_${suffix}.`);
      await expect(page.getByText(`WEB_COMPACT_OK_${suffix}`, { exact: true })).toBeVisible({
        timeout: 180_000,
      });
      await waitForThreadIdle(thread.id);

      await page.getByRole('button', { name: 'Open slash toolbox' }).click();
      await page.getByRole('button', { name: 'Open goal composer' }).click();
      const goalObjective = `Keep WEB_GOAL_OK_${suffix} as the current objective.`;
      await page.getByRole('textbox', { name: 'Prompt' }).fill(goalObjective);
      await page.getByRole('button', { name: /Set goal/i }).click();
      await pollUntil(
        async () => (await getThread(thread.id)).goal?.objective === goalObjective,
        'goal state',
        180_000,
      );
      await api(`/api/threads/${thread.id}/goal`, { method: 'DELETE' });

      await page.reload();
      const loadEarlier = page.getByRole('button', { name: /Load \d+ earlier/i });
      await loadEarlier.waitFor({ state: 'visible', timeout: 20_000 });
      while (await loadEarlier.isVisible().catch(() => false)) {
        await loadEarlier.click();
      }
      for (const marker of [
        `WEB_IMAGE_OK_${suffix}`,
        `WEB_STEER_OK_${suffix}`,
        `WEB_COMPACT_OK_${suffix}`,
      ]) {
        await expect(page.getByText(marker, { exact: true })).toHaveCount(1);
      }

      const guarded = await postJson<ThreadSummary>('/api/threads/start', {
        workspaceId: workspace.id,
        provider: 'acp',
        agentId: 'codex',
        model: 'default',
        approvalMode: 'guarded',
        title: `ACP guarded ${suffix}`,
      });
      threadIds.push(guarded.id);
      await api(`/api/threads/${guarded.id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ sandboxMode: 'read-only', fastMode: false }),
      });
      await page.goto(`/threads/${guarded.id}`);
      await submitPrompt(
        page,
        `Create approval-${suffix.toLowerCase()}.txt containing ${suffix}, then reply exactly WEB_APPROVAL_OK_${suffix}.`,
      );
      await expect(page.getByRole('button', { name: /Allow once/i })).toBeVisible({
        timeout: 180_000,
      });
      await page.getByRole('button', { name: /Allow once/i }).click();
      await page.getByRole('button', { name: 'Submit' }).click();
      await expect(page.getByText(`WEB_APPROVAL_OK_${suffix}`, { exact: true })).toBeVisible({
        timeout: 180_000,
      });
      expect(
        await fs.readFile(
          path.join(workspacePath, `approval-${suffix.toLowerCase()}.txt`),
          'utf8',
        ),
      ).toContain(suffix);
    } finally {
      for (const threadId of threadIds.reverse()) {
        await api(`/api/threads/${threadId}`, { method: 'DELETE' }).catch(() => undefined);
      }
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  });
});

async function assertCodexToolbox(page: Page) {
  const fast = page.getByRole('button', { name: /\/fast/i });
  const compact = page.getByRole('button', { name: /\/compact/i });
  const goal = page.getByRole('button', { name: 'Open goal composer' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await fast.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Open slash toolbox' }).click();
    }
    try {
      await expect(fast).toBeVisible({ timeout: 5_000 });
      await expect(compact).toBeVisible({ timeout: 5_000 });
      await expect(goal).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('button', { name: /\/fork/i })).toHaveCount(0);
      await page.getByRole('button', { name: 'Open slash toolbox' }).click();
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
    }
  }
}

async function toggleFastMode(page: Page) {
  await runToolboxAction(page, /\/fast/i);
}

async function runToolboxAction(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Open slash toolbox' }).click();
  await page.getByRole('button', { name }).click();
}

async function submitPrompt(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: 'Prompt' }).fill(prompt);
  await page.getByRole('button', { name: 'Send Prompt' }).click();
}

async function getThread(threadId: string) {
  return api<ThreadDetail>(`/api/threads/${threadId}?limit=30`);
}

async function waitForThreadIdle(threadId: string) {
  await pollUntil(
    async () => (await getThread(threadId)).thread.status !== 'running',
    `thread ${threadId} to become idle`,
    180_000,
  );
}

async function postJson<T>(pathname: string, body: unknown) {
  return api<T>(pathname, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function api<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...init,
    headers: init?.body
      ? {
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        }
      : init?.headers,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${pathname}: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) as T : {} as T;
}

async function pollUntil(
  predicate: () => Promise<boolean>,
  description: string,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ''}`,
  );
}
