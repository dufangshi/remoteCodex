#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { chromium, expect } from '@playwright/test';

const providerScenarios = {
  claude: {
    provider: 'claude',
    model: 'haiku',
    label: 'Claude Haiku',
    initPrefix: 'ANDROID_CLAUDE_PHASE5_SLASH_INIT',
    requiredBackendCommands: ['/mcp', '/btw'],
  },
  opencode: {
    provider: 'opencode',
    model: 'opencode/mimo-v2.5-free',
    label: 'OpenCode MiMo',
    initPrefix: null,
    requiredBackendCommands: ['/compact', '/fork'],
  },
};

const selectedProvider = process.env.ANDROID_PHASE5_PROVIDER ?? 'all';
const scenarios = selectedProvider === 'all'
  ? Object.values(providerScenarios)
  : [providerScenarios[selectedProvider]].filter(Boolean);

if (scenarios.length === 0) {
  throw new Error(
    `Unknown ANDROID_PHASE5_PROVIDER=${selectedProvider}. Use claude, opencode, or all.`,
  );
}

const apiBaseUrl = normalizeBaseUrl(
  process.env.ANDROID_E2E_API_BASE ?? 'http://127.0.0.1:8787',
);
const androidBaseUrl = normalizeBaseUrl(
  process.env.ANDROID_E2E_ANDROID_BASE ??
    apiBaseUrl.replace('127.0.0.1', '10.0.2.2').replace('localhost', '10.0.2.2'),
);
const workspaceRoot = path.resolve(
  process.env.ANDROID_E2E_WORKSPACE_ROOT ??
    '.local/android-phase5-e2e/workspaces',
);
const appActivity =
  process.env.ANDROID_E2E_APP_ACTIVITY ??
  'com.remotecodex.android/.MainActivity';
const cdpPort = Number(process.env.ANDROID_E2E_CDP_PORT ?? 9222);
const adb = process.env.ADB ?? 'adb';

const results = [];
for (const scenario of scenarios) {
  results.push(await runScenario(scenario));
}

console.log(JSON.stringify({ apiBaseUrl, androidBaseUrl, results }, null, 2));

async function runScenario(scenario) {
  await requireBackendReady(scenario.provider);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const workspaceName = `android-phase5-${scenario.provider}-${suffix.toLowerCase()}`;
  const absPath = path.join(workspaceRoot, workspaceName);
  await fs.mkdir(absPath, { recursive: true });
  await fs.writeFile(path.join(absPath, 'README.md'), `# ${workspaceName}\n`);
  const workspace = await postJson('/api/workspaces', {
    absPath,
    label: `Android ${scenario.label} Phase5 ${suffix}`,
  });
  const thread = await postJson('/api/threads/start', {
    workspaceId: workspace.id,
    title: `Android ${scenario.label} Phase5 ${suffix}`,
    provider: scenario.provider,
    model: scenario.model,
    approvalMode: 'yolo',
  });

  if (scenario.initPrefix) {
    const marker = `${scenario.initPrefix}_${suffix}`;
    await postJson(`/api/threads/${thread.id}/prompt`, {
      prompt: `Reply with exactly ${marker}.`,
      model: scenario.model,
    });
    await waitForThreadText(thread.id, marker, 120_000);
  }
  await waitForBackendToolbox(
    scenario.provider,
    scenario.requiredBackendCommands,
  );

  launchAndroidThread(thread.id);
  const webviewSocket = await waitForWebViewDevToolsSocket();
  forwardWebViewDevTools(webviewSocket);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  try {
    const page = await waitForAndroidThreadPage(browser);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Show chat' }).click({ timeout: 10_000 }).catch(() => {});
    await page.getByRole('textbox', { name: 'Prompt' }).waitFor({ timeout: 30_000 });

    await openSlashMenuByButton(page, scenario.provider);
    await verifySlashMenu(page, scenario.provider);
    await closeSlashMenu(page);
    await openSlashMenuByTypingSlash(page, scenario.provider);
    await verifySlashMenu(page, scenario.provider);
  } finally {
    await browser.close().catch(() => {});
  }

  return {
    provider: scenario.provider,
    model: scenario.model,
    workspaceId: workspace.id,
    workspacePath: absPath,
    threadId: thread.id,
    threadTitle: thread.title,
  };
}

async function openSlashMenuByButton(page, provider) {
  await page.getByRole('button', { name: 'Open slash toolbox' }).click();
  await expect(primarySlashButton(page, provider)).toBeVisible();
}

async function closeSlashMenu(page) {
  await page.getByRole('button', { name: 'Open slash toolbox' }).click();
  await expect(page.getByText('Slash toolbox')).toHaveCount(0);
}

async function openSlashMenuByTypingSlash(page, provider) {
  const editor = page.getByRole('textbox', { name: 'Prompt' });
  await editor.click();
  await editor.press('/');
  await expect(primarySlashButton(page, provider)).toBeVisible();
}

async function verifySlashMenu(page, provider) {
  if (provider === 'claude') {
    await expect(page.getByRole('button', { name: /\/btw/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /\/mcp/i })).toBeVisible();
    return;
  }
  await expect(page.getByRole('button', { name: /\/compact/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /\/fork/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /\/mcp/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /\/btw/i })).toHaveCount(0);
}

function primarySlashButton(page, provider) {
  return provider === 'claude'
    ? page.getByRole('button', { name: /\/mcp/i })
    : page.getByRole('button', { name: /\/compact/i });
}

function launchAndroidThread(threadId) {
  execFileSync(adb, ['shell', 'am', 'force-stop', 'com.remotecodex.android'], {
    stdio: 'ignore',
  });
  execFileSync(adb, [
    'shell',
    'am',
    'start',
    '-n',
    appActivity,
    '--ez',
    'remote_codex_thread_web_fixture',
    'true',
    '--es',
    'remote_codex_thread_web_base_url',
    androidBaseUrl,
    '--es',
    'remote_codex_thread_web_thread_id',
    threadId,
    '--ez',
    'remote_codex_thread_web_fixture_data',
    'false',
  ], { stdio: 'ignore' });
}

async function waitForAndroidThreadPage(browser, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().includes('/assets/thread-ui/index.html')) {
          return page;
        }
      }
    }
    await sleep(250);
  }
  throw new Error('Timed out waiting for Android WebView thread page.');
}

function forwardWebViewDevTools(socketName) {
  execFileSync(adb, [
    'forward',
    `tcp:${cdpPort}`,
    `localabstract:${socketName}`,
  ], { stdio: 'ignore' });
}

async function waitForWebViewDevToolsSocket(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = execFileSync(adb, ['shell', 'cat', '/proc/net/unix'], {
      encoding: 'utf8',
    });
    const match = output.match(/@?(webview_devtools_remote_\d+)/);
    if (match) {
      return match[1];
    }
    await sleep(250);
  }
  throw new Error('Timed out waiting for Android WebView DevTools socket.');
}

async function requireBackendReady(provider) {
  const backends = await getJson('/api/agent-runtimes');
  const backend = backends.find((entry) => entry.provider === provider);
  if (!backend?.enabled || !backend.installation?.installed) {
    throw new Error(
      `${provider} backend must be enabled and installed. lastError=${backend?.installation?.lastError ?? '<none>'}`,
    );
  }
}

async function waitForBackendToolbox(provider, commands, timeoutMs = 30_000) {
  await pollUntil(async () => {
    const runtime = await getJson(`/api/agent-runtimes/${provider}/status`);
    const available = new Set(
      runtime.managementSchema.toolboxItems.map((item) => item.command),
    );
    return commands.every((command) => available.has(command));
  }, `${provider} toolbox to include ${commands.join(', ')}`, timeoutMs);
}

async function waitForThreadText(threadId, text, timeoutMs) {
  await pollUntil(async () => {
    const detail = await getJson(`/api/threads/${threadId}?limit=30`);
    return (
      detail.thread.status === 'idle' &&
      JSON.stringify(detail.turns).includes(text)
    );
  }, `thread ${threadId} to contain ${text}`, timeoutMs);
}

async function getJson(urlPath) {
  const response = await fetch(`${apiBaseUrl}${urlPath}`);
  if (!response.ok) {
    throw new Error(`${urlPath} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function postJson(urlPath, body) {
  const response = await fetch(`${apiBaseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${urlPath} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function pollUntil(predicate, description, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(1_000);
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ''}`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  return new URL(value).origin;
}
