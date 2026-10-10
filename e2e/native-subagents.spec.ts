import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test.use({ timezoneId: 'UTC' });
const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
for (const backend of ['codex', 'claude'])
  test(`native ${backend} subagent inspection shows progress, usage and completion on desktop and touch`, async ({
    page,
    request,
  }, testInfo) => {
    const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT!, randomUUID());
    await mkdir(absPath, { recursive: true });
    const workspace = await (
      await request.post(`${base}/api/workspaces`, {
        data: { absPath, label: 'Native agents' },
      })
    ).json();
    const response = await request.post(`${base}/api/threads/start`, {
      data: {
        workspaceId: workspace.id,
        title: 'Native agent inspection',
        provider: backend,
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      },
    });
    expect(response.ok()).toBeTruthy();
    const thread = await response.json();
    const id = thread.id ?? thread.thread.id;
    const agent = {
      id: 'native-child',
      name: 'Review runtime changes',
      provider: backend,
      nativeSessionId: 'native-child',
      model: backend === 'codex' ? 'gpt-6.1-sol' : 'claude-sonnet-4-5',
      status: 'running',
      isBackground: true,
      startedAt: '2026-10-09T06:00:00Z',
      updatedAt: '2026-10-09T06:01:12Z',
      latestActivity: 'cargo test — 16 checks passed',
      activityCount: 3,
      detailsAvailable: true,
      prompt:
        'Review the runtime changes, check regressions, and report any issues.',
      tokenUsage: {
        total: {
          totalTokens: 26500,
          inputTokens: 24000,
          cachedInputTokens: 20000,
          outputTokens: 2500,
          reasoningOutputTokens: 1000,
        },
      },
      priceEstimate: {
        currency: 'USD',
        totalUsd: 0.12,
        inputUsd: 0.02,
        cachedInputUsd: 0.01,
        outputUsd: 0.09,
      },
    };
    let complete = false;
    let detailLoads = 0;
    let itemLoads = 0;
    const summary = () => ({
      ...agent,
      status: complete ? 'completed' : 'running',
      updatedAt: complete ? '2026-10-09T06:02:30Z' : agent.updatedAt,
    });
    await page.addInitScript(() =>
      localStorage.setItem('remote-codex-theme-mode', 'dark'),
    );
    await page.route(`**/api/threads/${id}/subagents`, (route) =>
      route.fulfill({
        json: {
          agents: [
            summary(),
            {
              ...agent,
              id: 'earlier-child',
              name: 'Inspect API contracts',
              status: 'completed',
              latestActivity: 'API review completed',
              tokenUsage: null,
              priceEstimate: null,
            },
          ],
        },
      }),
    );
    await page.route(`**/api/threads/${id}/subagents/native-child*`, (route) => {
      const itemId = new URL(route.request().url()).searchParams.get('itemId');
      if (itemId) { itemLoads++; return route.fulfill({ json: { id: itemId, kind: 'agentMessage', text: 'Selected full execution body', status: 'completed' } }); }
      detailLoads++;
      return route.fulfill({
        json: {
          historyMode: 'lazy-v1',
          agent: summary(),
          hasEarlierItems: false,
          items: [
            {
              id: 'read',
              kind: 'toolCall',
              text: 'exec_command\nrg -n "native_subagents" crates/runtime/src\n\nFound runtime service and transcript reader.',
              status: 'completed',
              createdAt: '2026-10-09T06:00:30Z',
            },
            {
              id: 'test',
              kind: 'toolCall',
              text: 'exec_command\ncargo test -p remote-codex-runtime native_subagents\n\n16 checks passed. No failures.',
              status: 'completed',
              createdAt: '2026-10-09T06:01:12Z',
            },
            {
              id: 'note',
              kind: 'agentMessage',
              text: complete
                ? 'Review complete. No blocking issues found.'
                : 'Transcript parsing and usage accounting checks passed. Reviewing the API boundary next.',
              status: 'completed',
              createdAt: '2026-10-09T06:01:12Z',
            },
          ],
        },
      });
    });
    await page.route(`**/api/threads/${id}/subagents/earlier-child`, (route) =>
      route.fulfill({
        json: {
          agent: {
            ...agent,
            id: 'earlier-child',
            name: 'Inspect API contracts',
            status: 'completed',
            tokenUsage: null,
            priceEstimate: null,
          },
          items: [],
          hasEarlierItems: false,
        },
      }),
    );
    await page.goto(`/threads/${id}`);
    await page
      .getByRole('button', { name: 'Subagents (1)', exact: true })
      .click();
    const panel = page.getByRole('dialog', {
      name: 'Native subagents',
      exact: true,
    });
    await expect(panel).toContainText('1 running · 2 total');
    expect(detailLoads).toBe(0);
    expect(itemLoads).toBe(0);
    await expect(panel.locator('.native-agents-row-meta').first()).toContainText('Created');
    await expect(panel.locator('.native-agents-row-meta').first()).toContainText(/Updated .* ago/);
    const screenshotDir = path.resolve('.temp/native-subagents/screenshots');
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `${testInfo.project.name}-${backend}-list.png`,
      ),
      scale: 'css',
    });
    await panel.getByRole('button', { name: /Review runtime changes/ }).click();
    await expect(
      panel.getByText(/Transcript parsing and usage accounting/),
    ).toBeVisible();
    await expect(panel.getByText('Tokens & estimated cost')).toBeVisible();
    expect(itemLoads).toBe(0);
    await expect(panel.locator('.native-agents-record pre')).toHaveCount(0);
    await panel.locator('.native-agents-record-toggle').last().click();
    await expect(panel.getByText('Selected full execution body', { exact: true })).toBeVisible();
    expect(itemLoads).toBe(1);
    await expect(panel.locator('.thread-turn-usage-price')).toContainText(
      '$0.12',
    );
    await expect(panel.locator('.native-agents-cost')).toContainText(
      '26,500 tok',
    );
    await panel.locator('.thread-turn-usage-price').click();
    const tooltip = page.locator('[data-slot="tooltip-content"] > div').first();
    await expect(
      tooltip.getByLabel('Input: 4,000 tokens', { exact: true }),
    ).toBeVisible();
    await panel.locator('.thread-turn-usage-price').click();
    await expect(tooltip).toBeHidden();
    await expect(panel.getByText('Last update')).toBeVisible();
    await expect(panel.locator('.native-agents-metrics')).toContainText(
      '6:01:12',
    );
    const width = await page.evaluate(() => innerWidth);
    expect(
      await panel.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const bounds = (await panel.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `${testInfo.project.name}-${backend}-detail.png`,
      ),
      scale: 'css',
    });
    complete = true;
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      panel.getByText('Review complete. No blocking issues found.'),
    ).toBeVisible();
    await expect(panel.locator('.native-agents-overview')).toContainText(
      'Completed',
    );
    await panel
      .getByRole('button', { name: 'Back to subagents', exact: true })
      .click();
    await expect(panel).toContainText('0 running · 2 total');
    await panel.getByRole('button', { name: /Inspect API contracts/ }).click();
    await expect(panel.getByText('Cost unavailable')).toBeVisible();
    await panel
      .getByRole('button', { name: 'Close subagents dialog', exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Subagents (0)', exact: true }),
    ).toBeVisible();
  });
