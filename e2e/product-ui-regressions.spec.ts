import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import type {
  AgentBackendDto,
  AgentBackendIdDto,
  ModelOptionDto,
} from '../packages/shared/src/index';

import { api, ensureWorkspaceDir } from './helpers';

const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const workspaceRoot = path.resolve(
  process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
);

type SeededWorkspace = {
  id: string;
  label: string;
  absPath: string;
};

let workspace: SeededWorkspace;

function importBackend(
  provider: AgentBackendIdDto,
  importLocal: boolean,
): AgentBackendDto {
  return {
    provider,
    displayName: provider === 'acp' ? 'ACP Agent' : 'Claude',
    description: 'Import capability regression fixture.',
    enabled: true,
    isDefault: true,
    status: {
      state: 'ready',
      transport: provider === 'claude' ? 'sdk' : 'stdio',
      lastStartedAt: null,
      lastError: null,
      restartCount: 0,
    },
    capabilities: {
      sessions: { list: true, read: true, resume: true, importLocal },
      turns: {
        start: true,
        streamInput: false,
        steer: true,
        interrupt: true,
        compact: true,
      },
      branching: {
        fork: true,
        hardRollback: true,
        resumeAt: false,
        rewindFiles: false,
      },
      controls: {
        planMode: true,
        permissionRequests: true,
        sandboxMode: true,
        performanceMode: true,
        goals: true,
      },
      management: {
        models: true,
        mcpStatus: true,
        skills: true,
        hooks: true,
        hookTrust: true,
        hostConfigFiles: true,
        providerSettings: false,
      },
      usage: { contextWindow: true, tokenUsage: true, costUsd: false },
    },
    managementSchema: {
      hostConfigFiles: [],
      toolboxItems: [],
      hookCommandTemplates: [],
      providerConfigFormat: 'none',
      mcpConfigFormat: 'none',
      configArchives: false,
      buildRestart: false,
    },
    installation: {
      packageName: null,
      installed: true,
      installedVersion: 'e2e',
      latestVersion: 'e2e',
      installCommand: null,
      updateCommand: null,
      busy: false,
      lastError: null,
    },
  };
}

const unavailableAcpAgent = {
  id: 'adapter-agent',
  model: 'adapter-agent',
  displayName: 'Adapter agent',
  description: 'Adapter is unavailable in this fixture.',
  isDefault: true,
  hidden: false,
  supportedReasoningEfforts: [],
  defaultReasoningEffort: null,
  selectionKind: 'agent',
  acpAgent: {
    transport: 'adapter',
    availability: 'adapter_missing',
    baseCommand: 'adapter-agent',
    baseProbeCommand: 'adapter-agent --version',
    serverCommand: 'adapter-agent-acp',
    serverProbeCommand: 'adapter-agent-acp --version',
    baseVersion: null,
    serverVersion: null,
    installCommand: null,
    busy: false,
    statusMessage: 'ACP adapter is not installed.',
  },
} satisfies ModelOptionDto;

async function installImportCapabilityMocks(
  page: Page,
  backends: AgentBackendDto[],
  agents: ModelOptionDto[] = [],
) {
  const importRequests: unknown[] = [];

  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/agent-runtimes') {
      return route.fulfill({ json: backends });
    }
    if (pathname === '/api/agent-runtimes/acp/agents') {
      return route.fulfill({ json: agents });
    }
    if (pathname === '/api/threads/import-candidates') {
      return route.fulfill({ json: [] });
    }
    if (pathname === '/api/threads/import' && request.method() === 'POST') {
      importRequests.push(request.postDataJSON());
      return route.fulfill({
        status: 500,
        json: { message: 'Import should be blocked by the client.' },
      });
    }

    return route.continue();
  });

  return { importRequests };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function expectMinimumTouchTarget(
  locator: Locator,
  name: string,
  minimum = 44,
) {
  await expect(locator, `${name} should be visible`).toBeVisible();
  const box = await locator.boundingBox();

  expect(box, `${name} should have a measurable hit area`).not.toBeNull();
  expect.soft(box!.width, `${name} should be at least ${minimum}px wide`).toBeGreaterThanOrEqual(
    minimum,
  );
  expect.soft(box!.height, `${name} should be at least ${minimum}px tall`).toBeGreaterThanOrEqual(
    minimum,
  );
}

async function expectMobileTouchTargets(
  isMobile: boolean,
  targets: Array<[name: string, locator: Locator]>,
) {
  if (!isMobile) {
    return;
  }

  for (const [name, locator] of targets) {
    await expectMinimumTouchTarget(locator, name);
  }
}

test.beforeAll(async () => {
  const label = `product-ui-${randomUUID().slice(0, 8)}`;
  const absPath = await ensureWorkspaceDir(workspaceRoot, label);
  workspace = await api<SeededWorkspace>(apiBaseUrl, '/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ absPath, label }),
  });
});

test.afterAll(async () => {
  if (!workspace) {
    return;
  }

  try {
    await api(apiBaseUrl, `/api/workspaces/${workspace.id}`, {
      method: 'DELETE',
      body: JSON.stringify({
        confirmWorkspaceId: workspace.id,
        confirmLabel: workspace.label,
      }),
    });
  } finally {
    await fs.rm(workspace.absPath, { recursive: true, force: true });
  }
});

test.describe('non-thread product UI regressions', () => {
  test('terminal plugin can be disabled and restored from settings', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chromium',
      'One browser project is sufficient for the persisted plugin toggle.',
    );

    await api(apiBaseUrl, '/api/plugins/remote-codex.terminal', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true }),
    });

    try {
      await page.goto('/workspaces');
      await page.getByRole('button', { name: 'Open Navigation' }).click();
      await page.getByRole('button', { name: 'Settings' }).click();

      const terminalToggle = page.getByRole('checkbox', {
        name: 'Terminal enabled',
      });
      await expect(terminalToggle).toBeChecked();
      await terminalToggle.click();
      await expect(terminalToggle).not.toBeChecked();

      await page
        .getByRole('dialog', { name: 'Settings' })
        .getByRole('button', { name: 'Close Settings' })
        .click();
      await page.reload();
      await page.getByRole('button', { name: 'Open Navigation' }).click();
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(
        page.getByRole('checkbox', { name: 'Terminal enabled' }),
      ).not.toBeChecked();
    } finally {
      await api(apiBaseUrl, '/api/plugins/remote-codex.terminal', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: true }),
      });
    }
  });

  test('keeps harness and plan controls out of the prompt toolbar', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chromium',
      'One browser project is sufficient for composer control placement.',
    );

    const thread = await api<{ id: string }>(apiBaseUrl, '/api/threads/start', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspace.id,
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'guarded',
        title: 'Composer control placement',
      }),
    });

    try {
      await page.goto(`/threads/${thread.id}`);
      await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
      const promptToolbar = page.locator(
        '.thread-composer-toolbar, .thread-graph-composer-toolbar',
      );
      await expect(promptToolbar).toBeVisible();
      await expect(
        promptToolbar.getByRole('button', { name: /^Agent:/ }),
      ).toHaveCount(0);
      await expect(
        promptToolbar.getByRole('button', { name: 'Plan', exact: true }),
      ).toHaveCount(0);

      await promptToolbar
        .getByRole('button', { name: 'Open slash toolbox' })
        .click();
      const planToggle = page.getByRole('button', { name: /^\/plan/ });
      await expect(planToggle).toBeVisible();
      await expect(planToggle).toHaveAttribute('aria-pressed', 'false');
      await planToggle.click();
      await promptToolbar
        .getByRole('button', { name: 'Open slash toolbox' })
        .click();
      await expect(
        page.getByRole('button', { name: /^\/plan/ }),
      ).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await api(apiBaseUrl, `/api/threads/${thread.id}`, { method: 'DELETE' });
    }
  });

  test('enables always approval when Full access is selected', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chromium',
      'One browser project is sufficient for the permission policy transition.',
    );
    const thread = await api<{ id: string }>(apiBaseUrl, '/api/threads/start', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspace.id,
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'guarded',
        title: 'Full access approval policy',
      }),
    });

    try {
      await api(apiBaseUrl, `/api/threads/${thread.id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ sandboxMode: 'workspace-write' }),
      });
      await page.goto(`/threads/${thread.id}`);
      await page.getByRole('button', { name: 'Sandbox: Workspace' }).click();
      await page.getByRole('button', { name: 'Danger', exact: true }).click();

      await expect
        .poll(async () => {
          const detail = await api<{
            thread: { sandboxMode: string; approvalMode: string };
          }>(apiBaseUrl, `/api/threads/${thread.id}`);
          return [detail.thread.sandboxMode, detail.thread.approvalMode];
        })
        .toEqual(['danger-full-access', 'yolo']);
    } finally {
      await api(apiBaseUrl, `/api/threads/${thread.id}`, { method: 'DELETE' });
    }
  });

  test('downloads valid PDF and standalone HTML thread exports', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chromium',
      'One browser project is sufficient for binary download validation.',
    );
    const thread = await api<{ id: string }>(apiBaseUrl, '/api/threads/start', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspace.id,
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'guarded',
        title: 'Unicode export 测试',
      }),
    });

    try {
      await page.goto(`/threads/${thread.id}`);
      await page.getByRole('button', { name: 'Thread actions' }).click();
      let dialog = page.getByRole('dialog', { name: 'Thread actions' });
      const pdfDownloadPromise = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Export PDF' }).click();
      const pdfDownload = await pdfDownloadPromise;
      expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/);
      const pdfPath = await pdfDownload.path();
      expect(pdfPath).not.toBeNull();
      const pdf = await fs.readFile(pdfPath!);
      expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(pdf.subarray(-5).toString('ascii')).toBe('%%EOF');

      await page.getByRole('button', { name: 'Thread actions' }).click();
      dialog = page.getByRole('dialog', { name: 'Thread actions' });
      await dialog.getByRole('button', { name: 'HTML', exact: true }).click();
      const htmlDownloadPromise = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Export HTML' }).click();
      const htmlDownload = await htmlDownloadPromise;
      expect(htmlDownload.suggestedFilename()).toMatch(/\.html$/);
      const htmlPath = await htmlDownload.path();
      expect(htmlPath).not.toBeNull();
      const html = await fs.readFile(htmlPath!, 'utf8');
      expect(html).toMatch(/^<!doctype html>/);
      expect(html).toContain('Unicode export 测试');
      expect(html).not.toContain('%PDF-');
    } finally {
      await api(apiBaseUrl, `/api/threads/${thread.id}`, { method: 'DELETE' });
    }
  });

  test('core product routes reflow across the target width matrix', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chromium',
      'One browser project is sufficient for the explicit viewport matrix.',
    );

    const paths = [
      '/workspaces',
      '/workspaces/new',
      `/threads/new?workspaceId=${encodeURIComponent(workspace.id)}`,
      '/threads/import',
      '/relay-guide',
    ];

    for (const width of [320, 375, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const pathname of paths) {
        await page.goto(pathname);
        await expect(page.locator('body')).toBeVisible();
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect.soft(
          dimensions.scrollWidth,
          `${pathname} should not overflow at ${width}px`,
        ).toBeLessThanOrEqual(dimensions.clientWidth);
      }
      await page.evaluate(() => {
        window.localStorage.removeItem('remote-codex-relay-mode');
      });
    }
  });

  test('workspace rows are real links with separate actions', async ({ page }, testInfo) => {
    await page.goto('/workspaces');
    await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();

    const row = page
      .getByRole('article')
      .filter({ hasText: workspace.label });
    await expect(row).toBeVisible();

    const workspaceLink = row.getByRole('link', {
      name: new RegExp(escapeRegExp(workspace.label)),
    });
    expect(await workspaceLink.evaluate((element) => element.tagName)).toBe('A');
    await expect(workspaceLink).toHaveAttribute(
      'href',
      `/threads?workspaceId=${encodeURIComponent(workspace.id)}`,
    );
    await expect(workspaceLink.locator('button, [role="button"]')).toHaveCount(0);
    await expect(row.locator('a button, button a')).toHaveCount(0);

    const pinButton = row.getByRole('button', { name: `Pin ${workspace.label}` });
    const actionsButton = row.getByRole('button', {
      name: `More actions for ${workspace.label}`,
    });
    await expect(pinButton).toBeVisible();
    await expect(actionsButton).toBeVisible();

    await expectMobileTouchTargets(Boolean(testInfo.project.use.isMobile), [
      ['navigation menu', page.getByRole('button', { name: 'Open Navigation' })],
      ['import session', page.getByRole('link', { name: 'Import session' })],
      ['add workspace', page.getByRole('link', { name: 'Add workspace' })],
      ['workspace link', workspaceLink],
      ['pin workspace', pinButton],
      ['workspace actions', actionsButton],
    ]);

    await actionsButton.click();
    const actionsMenu = page.getByRole('menu', {
      name: `Actions for ${workspace.label}`,
    });
    await actionsMenu.getByRole('menuitem', { name: 'Delete workspace' }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Delete workspace?' });
    await expect(confirmDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmDialog).toHaveCount(0);
    await expect(actionsButton).toBeFocused();
  });

  test('new workspace offers three source modes and inline validation', async ({ page }, testInfo) => {
    await page.goto('/workspaces/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Add a workspace' })).toBeVisible();

    const newFolder = page.getByRole('button', { name: 'New folder' });
    const existingPath = page.getByRole('button', { name: 'Existing path' });
    const gitRepository = page.getByRole('button', { name: 'Git repository' });
    const backButton = page.getByRole('button', { name: 'Back to workspaces' });
    const cancelButton = page.getByRole('button', { name: 'Cancel' });

    await expect(newFolder).toHaveAttribute('aria-pressed', 'true');
    const folderInput = page.getByRole('textbox', { name: 'Folder name' });
    const createFolder = page.getByRole('button', { name: 'Create folder' });
    await expect(createFolder).toBeDisabled();
    await folderInput.fill('nested/folder');
    await createFolder.click();
    await expect(page.getByRole('alert')).toHaveText(
      'Use 1-128 letters, numbers, periods, underscores, or hyphens.',
    );
    await expect(folderInput).toHaveAttribute('aria-invalid', 'true');

    await existingPath.click();
    await expect(existingPath).toHaveAttribute('aria-pressed', 'true');
    const pathInput = page.getByRole('textbox', { name: 'Absolute path' });
    const addWorkspace = page.getByRole('button', { name: 'Add workspace' });
    await expect(addWorkspace).toBeDisabled();
    await pathInput.fill('relative/path');
    await addWorkspace.click();
    await expect(page.getByRole('alert')).toHaveText(
      'Enter an absolute path, such as /Users/name/project.',
    );
    await expect(pathInput).toHaveAttribute('aria-invalid', 'true');

    await gitRepository.click();
    await expect(gitRepository).toHaveAttribute('aria-pressed', 'true');
    const repositoryInput = page.getByRole('textbox', { name: 'Repository URL' });
    const cloneRepository = page.getByRole('button', { name: 'Clone repository' });
    await expect(cloneRepository).toBeDisabled();
    await repositoryInput.fill('owner/repository');
    await cloneRepository.click();
    await expect(page.getByRole('alert')).toHaveText(
      'Enter an HTTPS or SSH Git repository URL.',
    );
    await expect(repositoryInput).toHaveAttribute('aria-invalid', 'true');

    await expectMobileTouchTargets(Boolean(testInfo.project.use.isMobile), [
      ['back to workspaces', backButton],
      ['new folder mode', newFolder],
      ['existing path mode', existingPath],
      ['Git repository mode', gitRepository],
      ['repository input', repositoryInput],
      ['display label input', page.getByRole('textbox', { name: /Display label/ })],
      ['cancel workspace creation', cancelButton],
      ['clone repository', cloneRepository],
    ]);
  });

  test('new thread defaults to Guarded and renders one backend chooser', async ({ page }, testInfo) => {
    await page.goto(`/threads/new?workspaceId=${encodeURIComponent(workspace.id)}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Start a backend session' }),
    ).toBeVisible();

    const backendFieldset = page.locator('fieldset').filter({
      has: page.locator('legend').filter({ hasText: /^Backend$/ }),
    });
    await expect(backendFieldset).toHaveCount(1);
    await expect(backendFieldset.getByRole('radiogroup', { name: 'Backend' })).toHaveCount(1);
    await expect(backendFieldset.getByRole('combobox')).toHaveCount(0);

    const guarded = page.getByRole('radio', { name: 'Guarded' });
    const fullAccess = page.getByRole('radio', { name: 'Full access' });
    await expect(guarded).toBeChecked();
    await expect(fullAccess).not.toBeChecked();

    const workspaceSelect = page.getByRole('combobox', { name: 'Workspace' });
    await expect(workspaceSelect).toHaveValue(workspace.id);

    const backendHitTarget = backendFieldset.locator('label').first();
    const guardedHitTarget = guarded.locator('xpath=..');
    const fullAccessHitTarget = fullAccess.locator('xpath=..');
    await expectMobileTouchTargets(Boolean(testInfo.project.use.isMobile), [
      ['back to threads', page.getByRole('button', { name: 'Back to threads' })],
      ['backend option', backendHitTarget],
      ['workspace selector', workspaceSelect],
      ['thread title', page.getByRole('textbox', { name: 'Title' })],
      ['Guarded mode', guardedHitTarget],
      ['Full access mode', fullAccessHitTarget],
      ['create thread', page.getByRole('button', { name: 'Create Thread' })],
      ['cancel thread creation', page.getByRole('button', { name: 'Cancel' })],
    ]);
  });

  test('import supports back navigation, conditional search, and blocks an empty ID', async ({
    page,
  }, testInfo) => {
    await page.goto('/workspaces');
    await page.getByRole('link', { name: 'Import session' }).click();
    await expect(page).toHaveURL(/\/threads\/import$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Import a backend session' }),
    ).toBeVisible();

    const backButton = page.getByRole('button', { name: 'Back to workspaces' });
    const sessionId = page.getByRole('textbox', { name: 'Session ID' });
    const submit = page.getByRole('button', { name: 'Import session', exact: true });
    await expect(backButton).toBeVisible();
    await expect(sessionId).toHaveValue('');
    await expect(submit).toBeDisabled();

    const sessionCount = page.getByText(/^\d+ of \d+ sessions$/);
    await expect(sessionCount).toBeVisible();
    const countText = (await sessionCount.textContent()) ?? '';
    const total = Number(countText.match(/^\d+ of (\d+) sessions$/)?.[1] ?? 0);
    const search = page.getByRole('searchbox', { name: 'Search sessions' });
    if (total > 8) {
      await expect(search).toBeVisible();
    } else {
      await expect(search).toHaveCount(0);
    }

    const touchTargets: Array<[string, Locator]> = [
      ['back from import', backButton],
      ['backend selector', page.getByRole('combobox', { name: 'Backend' })],
      ['available session selector', page.getByRole('combobox', { name: 'Available session' })],
      ['session ID', sessionId],
      ['cancel import', page.getByRole('button', { name: 'Cancel' })],
      ['import session', submit],
    ];
    if (total > 8) {
      touchTargets.push(['session search', search]);
    }
    await expectMobileTouchTargets(Boolean(testInfo.project.use.isMobile), touchTargets);

    await backButton.click();
    await expect(page).toHaveURL(/\/workspaces$/);
  });

  test('import blocks an enabled backend without local import capability', async ({ page }) => {
    const backend = importBackend('claude', false);
    const mocks = await installImportCapabilityMocks(page, [backend]);

    await page.goto('/threads/import');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Import a backend session' }),
    ).toBeVisible();

    const backendSelect = page.getByRole('combobox', { name: 'Backend' });
    await expect(backendSelect).toHaveValue('claude');
    await expect(backendSelect.locator('option[value="claude"]')).toBeDisabled();
    await expect(backendSelect).toContainText('Claude (import unavailable)');

    await page
      .getByRole('textbox', { name: 'Session ID' })
      .fill('01a0634a-23df-7191-acd2-1fca43a10418');
    const submit = page.getByRole('button', { name: 'Import session', exact: true });
    await expect(submit).toBeDisabled();

    await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.getByRole('alert')).toHaveText(
      'Choose a backend that supports local session import.',
    );
    expect(mocks.importRequests).toHaveLength(0);
  });

  test('import blocks ACP when no agent is ready', async ({ page }) => {
    const backend = importBackend('acp', true);
    const mocks = await installImportCapabilityMocks(page, [backend], [
      unavailableAcpAgent,
    ]);

    await page.goto('/threads/import');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Import a backend session' }),
    ).toBeVisible();

    const agentSelect = page.getByRole('combobox', { name: 'ACP agent' });
    await expect(agentSelect).toHaveValue('');
    await expect(agentSelect.locator('option[value="adapter-agent"]')).toBeDisabled();
    await expect(agentSelect).toContainText('No ready ACP agent');

    await page
      .getByRole('textbox', { name: 'Session ID' })
      .fill('01a0634a-23df-7191-acd2-1fca43a10418');
    const submit = page.getByRole('button', { name: 'Import session', exact: true });
    await expect(submit).toBeDisabled();

    await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.getByRole('alert')).toHaveText(
      'Choose a ready ACP agent before importing this session.',
    );
    expect(mocks.importRequests).toHaveLength(0);
  });
});
