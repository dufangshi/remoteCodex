#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { chromium } from '@playwright/test';

const providerScenarios = {
  claude: {
    provider: 'claude',
    model: 'haiku',
    label: 'Claude Haiku',
    appendPrefix: 'ANDROID_CLAUDE_PHASE4_DONE',
    firstTurnDelaySeconds: 10,
  },
  opencode: {
    provider: 'opencode',
    model: 'opencode/mimo-v2.5-free',
    label: 'OpenCode MiMo',
    appendPrefix: 'ANDROID_OPENCODE_PHASE4_DONE',
    firstTurnDelaySeconds: 6,
  },
};

const selectedProvider = process.env.ANDROID_PHASE4_PROVIDER ?? 'all';
const scenarios = selectedProvider === 'all'
  ? Object.values(providerScenarios)
  : [providerScenarios[selectedProvider]].filter(Boolean);

if (scenarios.length === 0) {
  throw new Error(
    `Unknown ANDROID_PHASE4_PROVIDER=${selectedProvider}. Use claude, opencode, or all.`,
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
    '.local/android-phase4-e2e/workspaces',
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
  const suffix = randomUUID().slice(0, 8).toLowerCase();
  const workspaceName = `android-${scenario.provider}-${suffix}`;
  const absPath = path.join(workspaceRoot, workspaceName);
  await fs.mkdir(absPath, { recursive: true });
  await fs.writeFile(path.join(absPath, 'README.md'), `# ${workspaceName}\n`);
  const workspace = await postJson('/api/workspaces', {
    absPath,
    label: `Android ${scenario.label} Phase4 ${suffix}`,
  });
  const thread = await postJson('/api/threads/start', {
    workspaceId: workspace.id,
    title: `Android ${scenario.label} Phase4 ${suffix}`,
    provider: scenario.provider,
    model: scenario.model,
    approvalMode: 'yolo',
  });

  const continuationFileName = `android-${scenario.provider}-phase4-${suffix}.txt`;
  const continuationFilePath = path.join(absPath, continuationFileName);
  const continuationText = `${scenario.appendPrefix.toLowerCase()} ${suffix}`;

  launchAndroidThread(thread.id);
  const webviewSocket = await waitForWebViewDevToolsSocket();
  forwardWebViewDevTools(webviewSocket);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  let pendingSteerObserved = false;
  try {
    const page = await waitForAndroidThreadPage(browser);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Show chat' }).click({ timeout: 10_000 }).catch(() => {});
    await page.getByRole('textbox', { name: 'Prompt' }).waitFor({ timeout: 30_000 });

    const startingPrompt =
      `Use bash to run exactly this command before replying: ` +
      `sleep ${scenario.firstTurnDelaySeconds}; echo phase4_first_turn_done. ` +
      `After the command finishes, briefly say it completed.`;
    await submitPromptFromComposer(page, startingPrompt);
    await waitForThreadActiveTurn(thread.id);

    const queuedPrompt =
      `Create a file at this exact path: ${continuationFilePath}. ` +
      `Put exactly this text in it: ${continuationText}. ` +
      `Then briefly confirm the file was written.`;
    await submitPromptFromComposer(page, queuedPrompt);
    pendingSteerObserved = await waitForQueuedPromptAccepted(
      thread.id,
      queuedPrompt,
      10_000,
    ).then(
      () => true,
      () => false,
    );
    await waitForFileText(continuationFilePath, continuationText, 180_000);

    await page
      .getByText(continuationFileName)
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const detail = await getThreadDetail(thread.id);
  return {
    provider: scenario.provider,
    model: scenario.model,
    workspaceId: workspace.id,
    workspacePath: absPath,
    threadId: thread.id,
    threadTitle: thread.title,
    threadStatus: detail.thread.status,
    continuationFilePath,
    continuationText,
    pendingSteerObserved,
  };
}

async function submitPromptFromComposer(page, prompt) {
  const editor = page.getByRole('textbox', { name: 'Prompt' });
  await editor.fill(prompt);
  await page.getByRole('button', { name: 'Send Prompt' }).click();
  await waitForComposerToClear(page, prompt);
}

async function waitForComposerToClear(page, previousPrompt) {
  await pollUntil(
    async () => {
      const value = await page
        .getByRole('textbox', { name: 'Prompt' })
        .inputValue()
        .catch(async () =>
          page
            .getByRole('textbox', { name: 'Prompt' })
            .evaluate((element) => element.textContent ?? ''),
        );
      return value.trim() !== previousPrompt.trim();
    },
    'Android WebView composer to accept and clear the submitted prompt',
    10_000,
  );
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

async function waitForThreadActiveTurn(threadId, timeoutMs = 30_000) {
  await pollUntil(
    async () => Boolean((await getThreadDetail(threadId)).thread.activeTurnId),
    `thread ${threadId} to expose an active turn id`,
    timeoutMs,
  );
}

async function waitForQueuedPromptAccepted(threadId, prompt, timeoutMs = 30_000) {
  await pollUntil(
    async () => {
      const detail = await getThreadDetail(threadId);
      return (
        detail.pendingSteers.some(
          (steer) => steer.prompt === prompt,
        ) ||
        detail.turns.some((turn) =>
          turn.items.some((item) => item.kind === 'userMessage' && item.text === prompt),
        )
      );
    },
    `thread ${threadId} to accept queued prompt`,
    timeoutMs,
  );
}

async function waitForFileText(filePath, text, timeoutMs) {
  await pollUntil(async () => {
    try {
      return (await fs.readFile(filePath, 'utf8')).includes(text);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }, `file ${filePath} to contain ${text}`, timeoutMs);
}

async function getThreadDetail(threadId) {
  return getJson(`/api/threads/${threadId}?limit=30`);
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
