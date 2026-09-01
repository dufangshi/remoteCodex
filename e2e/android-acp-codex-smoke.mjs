#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';

import { chromium, expect } from '@playwright/test';

const apiBaseUrl = normalizeBaseUrl(
  process.env.ANDROID_E2E_API_BASE ?? 'http://127.0.0.1:8797',
);
const androidBaseUrl = normalizeBaseUrl(
  process.env.ANDROID_E2E_ANDROID_BASE ?? 'http://10.0.2.2:8797',
);
const workspaceRoot = path.resolve(
  process.env.ANDROID_E2E_WORKSPACE_ROOT ?? '.local/android-acp-e2e/workspaces',
);
const appActivity = 'com.remotecodex.android/.MainActivity';
const appPackage = 'com.remotecodex.android';
const cdpPort = Number(process.env.ANDROID_E2E_CDP_PORT ?? 9223);
const adb = process.env.ADB ?? 'adb';
let authToken = process.env.ANDROID_E2E_AUTH_TOKEN?.trim() || null;
let apiPathPrefix = process.env.ANDROID_E2E_API_PREFIX?.trim() || '';
const relayRegistrationFile = process.env.ANDROID_E2E_RELAY_REGISTRATION_FILE?.trim();
if (relayRegistrationFile) {
  const registration = JSON.parse(await fs.readFile(relayRegistrationFile, 'utf8'));
  authToken = registration.relayToken;
  apiPathPrefix = `/relay/devices/${encodeURIComponent(registration.deviceId)}`;
}
if (
  !authToken &&
  process.env.ANDROID_E2E_USERNAME &&
  process.env.ANDROID_E2E_PASSWORD
) {
  const loginPath = process.env.ANDROID_E2E_LOGIN_PATH ?? '/api/auth/login';
  const login = await globalThis.fetch(`${apiBaseUrl}${loginPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: process.env.ANDROID_E2E_USERNAME,
      password: process.env.ANDROID_E2E_PASSWORD,
    }),
  });
  if (!login.ok) throw new Error(`Android E2E login failed: ${login.status}`);
  authToken = (await login.json()).token;
}
const suffix = randomUUID().slice(0, 8).toUpperCase();
const marker = `ANDROID_ACP_OK_${suffix}`;
const evidenceSuffix = process.env.ANDROID_E2E_EVIDENCE_SUFFIX ?? 'local';
const workspacePath = path.join(workspaceRoot, suffix.toLowerCase());
await fs.mkdir(workspacePath, { recursive: true });
await fs.writeFile(path.join(workspacePath, 'README.md'), '# Android ACP Codex E2E\n');
let threadId = null;
let browser = null;
try {
  const capability = await getJson(
    '/api/agent-runtimes/acp/capabilities?agentId=codex',
  );
  if (
    capability.effectiveCapabilities?.turns?.compact !== true ||
    capability.effectiveCapabilities?.controls?.goals !== true ||
    capability.effectiveCapabilities?.branching?.fork !== false
  ) {
    throw new Error('Android ACP child capability snapshot is incorrect.');
  }
  const workspace = await postJson('/api/workspaces', {
    absPath: workspacePath,
    label: `Android ACP ${suffix}`,
  });
  const thread = await postJson('/api/threads/start', {
    workspaceId: workspace.id,
    title: `Android ACP ${suffix}`,
    provider: 'acp',
    agentId: 'codex',
    model: 'default',
    approvalMode: 'yolo',
  });
  threadId = thread.id;

  execFileSync(adb, ['shell', 'am', 'force-stop', appPackage], { stdio: 'ignore' });
  if (process.env.ANDROID_E2E_PRESERVE_APP_DATA !== '1') {
    execFileSync(adb, ['shell', 'pm', 'clear', appPackage], { stdio: 'ignore' });
  }
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
  const socket = await waitForWebViewDevToolsSocket();
  execFileSync(adb, ['forward', `tcp:${cdpPort}`, `localabstract:${socket}`], {
    stdio: 'ignore',
  });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = await waitForAndroidThreadPage(browser);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Show chat' }).click({ timeout: 10_000 }).catch(() => {});
  await page.getByRole('textbox', { name: 'Prompt' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open slash toolbox' }).click();
  await expect(page.getByRole('button', { name: /\/compact/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open goal composer' })).toBeVisible();
  await expect(page.getByRole('button', { name: /\/fork/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open slash toolbox' }).click();

  const editor = page.getByRole('textbox', { name: 'Prompt' });
  await editor.fill(`Reply exactly ${marker}.`);
  await page.getByRole('button', { name: 'Send Prompt' }).click();
  await waitForThreadText(threadId, marker, 180_000);
  await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 30_000 });

  const detail = await getJson(`/api/threads/${threadId}?limit=30`);
  if (
    detail.thread.agentId !== 'codex' ||
    detail.thread.status !== 'idle' ||
    detail.thread.lastError
  ) {
    throw new Error('Android ACP thread did not finish cleanly.');
  }
  const evidenceDir = path.resolve('.local/mobile-parity/evidence');
  await fs.mkdir(evidenceDir, { recursive: true });
  const screenshotPath = path.join(
    evidenceDir,
    `android-acp-codex-${evidenceSuffix}.png`,
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  let nativeUiXmlCaptured = false;
  for (let attempt = 0; attempt < 3 && !nativeUiXmlCaptured; attempt += 1) {
    try {
      execFileSync(adb, ['shell', 'uiautomator', 'dump', '/sdcard/window.xml'], {
        stdio: 'ignore',
      });
      const xml = execFileSync(adb, ['exec-out', 'cat', '/sdcard/window.xml']);
      await fs.writeFile(
        path.join(evidenceDir, `android-connected-${evidenceSuffix}.xml`),
        xml,
      );
      nativeUiXmlCaptured = true;
    } catch {
      await sleep(500);
    }
  }
  if (evidenceSuffix === 'local' && nativeUiXmlCaptured) {
    await fs.copyFile(
      path.join(evidenceDir, 'android-connected-local.xml'),
      path.join(evidenceDir, 'android-connected-final.xml'),
    );
  }

  console.log(JSON.stringify({
    emulator: execFileSync(adb, ['get-serialno'], { encoding: 'utf8' }).trim(),
    apiBaseUrl,
    androidBaseUrl,
    threadId,
    agentId: detail.thread.agentId,
    model: detail.thread.model,
    reasoningEffort: detail.thread.reasoningEffort,
    status: detail.thread.status,
    markerObservedInAndroidWebView: true,
    transcriptReloaded: true,
    codexOnlyCapabilitiesFiltered: true,
    nativeUiXmlCaptured,
    evidenceScreenshot: path.relative(process.cwd(), screenshotPath),
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (threadId) {
    await request(`/api/threads/${threadId}`, { method: 'DELETE' }).catch(() => {});
  }
  await fs.rm(workspacePath, { recursive: true, force: true });
  execFileSync(adb, ['forward', '--remove', `tcp:${cdpPort}`], { stdio: 'ignore' });
}

async function waitForAndroidThreadPage(currentBrowser, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const context of currentBrowser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().includes('/assets/thread-ui/index.html')) return page;
      }
    }
    await sleep(250);
  }
  throw new Error('Timed out waiting for Android WebView thread page.');
}

async function waitForWebViewDevToolsSocket(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = execFileSync(adb, ['shell', 'cat', '/proc/net/unix'], {
      encoding: 'utf8',
    });
    const match = output.match(/@?(webview_devtools_remote_\d+)/);
    if (match) return match[1];
    await sleep(250);
  }
  throw new Error('Timed out waiting for Android WebView DevTools socket.');
}

async function waitForThreadText(currentThreadId, text, timeoutMs) {
  await pollUntil(async () => {
    const detail = await getJson(`/api/threads/${currentThreadId}?limit=30`);
    return detail.thread.status === 'idle' && JSON.stringify(detail.turns).includes(text);
  }, `thread ${currentThreadId} to contain its marker`, timeoutMs);
}

async function getJson(pathname) {
  const response = await request(pathname);
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function postJson(pathname, body) {
  const response = await request(pathname, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${await response.text()}`);
  return response.json();
}

function request(pathname, init = {}) {
  return globalThis.fetch(`${apiBaseUrl}${apiPathPrefix}${pathname}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
  });
}

async function pollUntil(predicate, description, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`${description} timed out${lastError ? `: ${String(lastError)}` : ''}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  return new URL(value).origin;
}
