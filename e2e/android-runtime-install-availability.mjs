#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const apiBaseUrl = normalizeBaseUrl(
  process.env.ANDROID_E2E_API_BASE ?? 'http://127.0.0.1:8787',
);
const androidBaseUrl = normalizeBaseUrl(
  process.env.ANDROID_E2E_ANDROID_BASE ??
    apiBaseUrl.replace('127.0.0.1', '10.0.2.2').replace('localhost', '10.0.2.2'),
);
const workspaceRoot = path.resolve(
  process.env.ANDROID_E2E_WORKSPACE_ROOT ??
    '.local/android-runtime-install-e2e/workspaces',
);
const appActivity =
  process.env.ANDROID_E2E_APP_ACTIVITY ??
  'com.remotecodex.android/.MainActivity';
const appPackage = appActivity.split('/')[0];
const adb = process.env.ADB ?? 'adb';

const suffix = randomUUID().slice(0, 8).toUpperCase();
const workspaceName = `android-runtime-install-${suffix.toLowerCase()}`;
const workspacePath = path.join(workspaceRoot, workspaceName);
const workspaceLabel = `Android Runtime Install ${suffix}`;

await requireHealthyApi();
await requireClaudeInitiallyUnavailable();
await fs.mkdir(workspacePath, { recursive: true });
await fs.writeFile(path.join(workspacePath, 'README.md'), `# ${workspaceLabel}\n`);
const workspace = await postJson('/api/workspaces', {
  absPath: workspacePath,
  label: workspaceLabel,
});

clearAndLaunchApp();
await tapWhenVisible({ contentDescription: `Start thread in workspace ${workspaceLabel}` });
await waitForVisible({ text: 'New Thread' });
await waitForVisible({ text: 'Claude Code' });
await waitForVisible({ text: /not available|not installed|command/i });
await waitForBackendAction('claude', 'Install');
await tapBackendAction('claude', 'Install');
await waitForVisible({ text: /Installing|Update/ }, 30_000);
await waitForBackendEnabled('claude', 30_000);
await waitForBackendAction('claude', 'Update', 30_000);
await waitForVisible({ contentDescription: 'New thread model haiku' }, 30_000);
await waitForEnabled({ text: 'Start', enabled: true });
await tapBackendAction('claude', 'Update');
await waitForBackendEnabled('claude', 30_000);
await waitForBackendAction('claude', 'Update', 30_000);
await waitForVisible({ contentDescription: 'New thread model haiku' }, 30_000);

console.log(JSON.stringify({
  apiBaseUrl,
  androidBaseUrl,
  workspaceId: workspace.id,
  workspacePath,
  workspaceLabel,
  provider: 'claude',
  modelObserved: 'haiku',
}, null, 2));

async function requireHealthyApi() {
  const response = await fetch(`${apiBaseUrl}/healthz`);
  if (!response.ok) {
    throw new Error(`Supervisor health failed: ${response.status} ${await response.text()}`);
  }
}

async function requireClaudeInitiallyUnavailable() {
  const backends = await getJson('/api/agent-runtimes');
  const claude = backends.find((entry) => entry.provider === 'claude');
  if (!claude) {
    throw new Error('Claude backend is not configured. Set REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=codex,claude.');
  }
  if (claude.enabled || claude.installation?.installed) {
    throw new Error(
      `Claude backend must start unavailable for this E2E. observed=${JSON.stringify({
        enabled: claude.enabled,
        installed: claude.installation?.installed,
        version: claude.installation?.installedVersion,
      })}`,
    );
  }
  if (!claude.installation?.installCommand) {
    throw new Error(`Claude backend is unavailable but has no install command: ${JSON.stringify(claude.installation)}`);
  }
}

async function waitForBackendEnabled(provider, timeoutMs) {
  await pollUntil(async () => {
    const backends = await getJson('/api/agent-runtimes');
    const backend = backends.find((entry) => entry.provider === provider);
    return backend?.enabled === true && backend.installation?.installed === true;
  }, `${provider} backend to become enabled`, timeoutMs);
}

function clearAndLaunchApp() {
  execFileSync(adb, ['shell', 'pm', 'clear', appPackage], { stdio: 'ignore' });
  execFileSync(adb, [
    'shell',
    'am',
    'start',
    '-n',
    appActivity,
    '--es',
    'remote_codex_e2e_connection_base_url',
    androidBaseUrl,
  ], { stdio: 'ignore' });
}

async function tapWhenVisible(query, timeoutMs = 30_000) {
  const node = await waitForVisible(query, timeoutMs);
  const [x, y] = nodeCenter(node);
  execFileSync(adb, ['shell', 'input', 'tap', String(x), String(y)], { stdio: 'ignore' });
  await sleep(350);
}

async function tapBackendAction(provider, action, timeoutMs = 30_000) {
  const node = await waitForBackendAction(provider, action, timeoutMs);
  const [x, y] = nodeCenter(node);
  execFileSync(adb, ['shell', 'input', 'tap', String(x), String(y)], { stdio: 'ignore' });
  await sleep(350);
}

async function waitForBackendAction(provider, action, timeoutMs = 10_000) {
  const result = await pollUntil(async () => {
    const nodes = await dumpNodes();
    return findBackendAction(nodes, provider, action);
  }, `${provider} backend action ${action}`, timeoutMs);
  if (!result) {
    throw new Error(`Timed out waiting for ${provider} backend action ${action}`);
  }
  return result;
}

async function waitForEnabled(query, timeoutMs = 10_000) {
  return pollUntil(async () => {
    const node = findNode(await dumpNodes(), query);
    return node && node.enabled === String(query.enabled);
  }, `${labelForQuery(query)} enabled=${query.enabled}`, timeoutMs);
}

async function waitForVisible(query, timeoutMs = 10_000) {
  let lastNodes = [];
  const result = await pollUntil(async () => {
    lastNodes = await dumpNodes();
    const node = findNode(lastNodes, query);
    return node?.visible ? node : null;
  }, labelForQuery(query), timeoutMs);
  if (!result) {
    throw new Error(`Timed out waiting for ${labelForQuery(query)}. nodes=${lastNodes.map((node) => nodeLabel(node)).join(' | ')}`);
  }
  return result;
}

async function dumpNodes() {
  execFileSync(adb, ['shell', 'uiautomator', 'dump', '/sdcard/window.xml'], { stdio: 'ignore' });
  const xml = execFileSync(adb, ['exec-out', 'cat', '/sdcard/window.xml'], { encoding: 'utf8' });
  return [...xml.matchAll(/<node\b[^>]*>/g)].map((match) => {
    const tag = match[0];
    return {
      text: decodeXml(readAttr(tag, 'text')),
      contentDescription: decodeXml(readAttr(tag, 'content-desc')),
      enabled: readAttr(tag, 'enabled'),
      visible: readAttr(tag, 'visible-to-user') !== 'false',
      bounds: readAttr(tag, 'bounds'),
    };
  });
}

function findNode(nodes, query) {
  return nodes.find((node) => {
    if (query.enabled !== undefined && node.enabled !== String(query.enabled)) {
      return false;
    }
    if (query.text !== undefined && !matches(node.text, query.text)) {
      return false;
    }
    if (query.contentDescription !== undefined && !matches(node.contentDescription, query.contentDescription)) {
      return false;
    }
    return true;
  });
}

function matches(value, expected) {
  return expected instanceof RegExp ? expected.test(value) : value === expected;
}

function findBackendAction(nodes, provider, action) {
  const backendNode = nodes.find((node) => node.contentDescription === `New thread backend ${provider}`);
  if (!backendNode) {
    return null;
  }
  const backendBounds = parseBounds(backendNode.bounds);
  return nodes.find((node) => {
    if (node.text !== action || !node.visible) {
      return false;
    }
    const [x, y] = nodeCenter(node);
    return x >= backendBounds.left &&
      x <= backendBounds.right &&
      y >= backendBounds.top &&
      y <= backendBounds.bottom;
  }) ?? null;
}

function nodeCenter(node) {
  const bounds = parseBounds(node.bounds);
  return [
    Math.round((bounds.left + bounds.right) / 2),
    Math.round((bounds.top + bounds.bottom) / 2),
  ];
}

function parseBounds(value) {
  const match = value.match(/\[(\d+),(\d+)]\[(\d+),(\d+)]/);
  if (!match) {
    throw new Error(`Invalid bounds: ${value}`);
  }
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  };
}

function nodeLabel(node) {
  return [node.text, node.contentDescription].filter(Boolean).join('/');
}

function labelForQuery(query) {
  if (query.text) {
    return `text ${query.text}`;
  }
  return `contentDescription ${query.contentDescription}`;
}

function readAttr(tag, name) {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
}

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
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
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
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
