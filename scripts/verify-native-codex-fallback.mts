import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

const repoRoot = path.resolve(import.meta.dirname, '..');
const localRoot = path.join(repoRoot, '.local');
await fs.mkdir(localRoot, { recursive: true });
const testRoot = await fs.mkdtemp(path.join(localRoot, 'native-codex-fallback-'));
const workspaceRoot = path.join(testRoot, 'workspaces');
const workspace = path.join(workspaceRoot, 'native-workspace');
const isolatedCodexHome = path.join(testRoot, 'codex-home');
const databasePath = path.join(testRoot, 'supervisor.sqlite');
const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
await fs.mkdir(workspace, { recursive: true });
await fs.mkdir(isolatedCodexHome, { recursive: true });
await fs.writeFile(path.join(workspace, 'README.md'), '# Native Codex fallback E2E\n');
const sourceCodexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
for (const fileName of ['auth.json', 'config.toml']) {
  const source = path.join(sourceCodexHome, fileName);
  try {
    await fs.access(source);
    await fs.symlink(source, path.join(isolatedCodexHome, fileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
  return port;
}

interface RunningSupervisor {
  child: ChildProcess;
  baseUrl: string;
  output: () => string;
}

async function waitFor<T>(
  check: () => Promise<T | null>,
  timeoutMs: number,
  label: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check().catch(() => null);
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function startSupervisor(): Promise<RunningSupervisor> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('pnpm', ['exec', 'tsx', 'apps/supervisor-api/src/index.ts'], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      REMOTE_CODEX_MODE: 'local',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: databasePath,
      WORKSPACE_ROOT: workspaceRoot,
      CODEX_HOME: isolatedCodexHome,
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex,acp',
      DISABLE_REQUEST_LOGGING: '1',
      LOG_LEVEL: 'fatal',
    },
  });
  let output = '';
  const append = (chunk: Buffer | string) => {
    output = `${output}${String(chunk)}`.slice(-32_768);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  await waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error(`Supervisor exited during startup.\n${output}`);
    }
    return (await fetch(`${baseUrl}/healthz`)).ok ? true : null;
  }, 30_000, 'native fallback Supervisor health');
  return { child, baseUrl, output: () => output };
}

async function stopSupervisor(supervisor: RunningSupervisor) {
  if (supervisor.child.pid && supervisor.child.exitCode === null) {
    try {
      process.kill(-supervisor.child.pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  if (supervisor.child.exitCode === null) {
    await Promise.race([
      once(supervisor.child, 'close'),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}

async function api<T>(
  supervisor: RunningSupervisor,
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${supervisor.baseUrl}${pathname}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${pathname}: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) as T : {} as T;
}

interface FallbackThreadDetail {
  thread: { status: string };
  turns: Array<{
    items: Array<{ kind: string; text: string }>;
  }>;
}

function hasAgentMarker(detail: FallbackThreadDetail, markerText: string) {
  return detail.turns
    .flatMap((turn) => turn.items)
    .some((item) => item.kind === 'agentMessage' && item.text.includes(markerText));
}

let supervisor: RunningSupervisor | null = null;
try {
  supervisor = await startSupervisor();
  const backends = await api<Array<{
    provider: string;
    enabled: boolean;
    installation: { installed: boolean };
  }>>(supervisor, '/api/agent-runtimes');
  for (const provider of ['codex', 'acp']) {
    const backend = backends.find((entry) => entry.provider === provider);
    if (!backend?.enabled || !backend.installation.installed) {
      throw new Error(`${provider} was not selectable during fallback verification.`);
    }
  }
  const models = await api<Array<{ model: string; isDefault: boolean }>>(
    supervisor,
    '/api/agent-runtimes/codex/models',
  );
  const model = models.find((entry) => entry.isDefault)?.model ?? models[0]?.model;
  if (!model) throw new Error('Native Codex exposed no selectable model.');
  const workspaceRecord = await api<{ id: string }>(supervisor, '/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ absPath: workspace, label: 'Native fallback E2E' }),
  });
  const thread = await api<{ id: string; provider: string; agentId: string | null }>(
    supervisor,
    '/api/threads/start',
    {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspaceRecord.id,
        provider: 'codex',
        model,
        approvalMode: 'yolo',
        title: 'Native Codex fallback E2E',
      }),
    },
  );
  if (thread.provider !== 'codex' || thread.agentId !== null) {
    throw new Error('Fallback thread was not owned by native Codex.');
  }
  await api(supervisor, `/api/threads/${thread.id}/prompt`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: `Remember nonce ${marker}. Reply exactly NATIVE_SEED_OK_${marker}.`,
    }),
  });
  await waitFor(async () => {
    const detail = await api<FallbackThreadDetail>(
      supervisor!,
      `/api/threads/${thread.id}?limit=30`,
    );
    return detail.thread.status === 'idle' && hasAgentMarker(
      detail,
      `NATIVE_SEED_OK_${marker}`,
    ) ? detail : null;
  }, 180_000, 'native Codex seed marker');

  await stopSupervisor(supervisor);
  supervisor = null;
  supervisor = await startSupervisor();
  const restarted = await api<FallbackThreadDetail>(
    supervisor,
    `/api/threads/${thread.id}?limit=30`,
  );
  if (!hasAgentMarker(restarted, `NATIVE_SEED_OK_${marker}`)) {
    throw new Error('Native Codex transcript was not restored after restart.');
  }
  const resumed = await api<{
    thread: { isLoaded: boolean; status: string; lastError: string | null };
  }>(supervisor, `/api/threads/${thread.id}/resume`, {
    method: 'POST',
    body: JSON.stringify({ model }),
  });
  if (!resumed.thread.isLoaded) {
    throw new Error(
      `Native Codex resume remained unloaded: status=${resumed.thread.status}; ` +
      `lastError=${resumed.thread.lastError ?? 'none'}.`,
    );
  }
  await api(supervisor, `/api/threads/${thread.id}/prompt`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'What nonce did I ask you to remember? Reply exactly NATIVE_CONTEXT_OK_ followed by it.',
    }),
  });
  await waitFor(async () => {
    const detail = await api<FallbackThreadDetail>(
      supervisor!,
      `/api/threads/${thread.id}?limit=30`,
    );
    return detail.thread.status === 'idle' && hasAgentMarker(
      detail,
      `NATIVE_CONTEXT_OK_${marker}`,
    ) ? detail : null;
  }, 180_000, 'native Codex context continuation');
  await api(supervisor, `/api/threads/${thread.id}`, { method: 'DELETE' });

  process.stdout.write(`${JSON.stringify({
    nativeAndAcpSelectable: true,
    nativeThreadOwnerPreserved: true,
    supervisorRestarted: true,
    nativeTranscriptRestored: true,
    nativeProviderContextContinued: true,
    isolatedCodexHome: true,
    testThreadDeleted: true,
  }, null, 2)}\n`);
} catch (error) {
  if (supervisor) process.stderr.write(supervisor.output());
  throw error;
} finally {
  if (supervisor) await stopSupervisor(supervisor).catch(() => undefined);
  await fs.rm(testRoot, { recursive: true, force: true });
}
