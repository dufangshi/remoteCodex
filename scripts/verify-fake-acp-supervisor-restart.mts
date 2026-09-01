import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const localRoot = path.join(repoRoot, '.local');
await fs.mkdir(localRoot, { recursive: true });
const testRoot = await fs.mkdtemp(path.join(localRoot, 'fake-acp-supervisor-restart-'));
const workspaceRoot = path.join(testRoot, 'workspaces');
const workspace = path.join(workspaceRoot, 'fixture-workspace');
const databasePath = path.join(testRoot, 'supervisor.sqlite');
const providerStatePath = path.join(testRoot, 'fake-acp-state.json');
const fixturePath = path.join(
  repoRoot,
  'packages/acp/src/test/fixtures/fake-acp-agent.mjs',
);
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, 'README.md'), '# Fake ACP restart fixture\n');

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

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const supervisorEnv = {
  ...process.env,
  NODE_ENV: 'test',
  REMOTE_CODEX_MODE: 'local',
  HOST: '127.0.0.1',
  PORT: String(port),
  DATABASE_URL: databasePath,
  WORKSPACE_ROOT: workspaceRoot,
  DISABLE_REQUEST_LOGGING: '1',
  LOG_LEVEL: 'fatal',
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'acp',
  ACP_COMMAND: `"${process.execPath}" "${fixturePath}"`,
  ACP_STARTUP_TIMEOUT_MS: '10000',
  REMOTE_CODEX_FAKE_ACP_STATE: providerStatePath,
  REMOTE_CODEX_FAKE_ACP_STREAM_DELAY_MS: '15000',
};

interface RunningSupervisor {
  child: ChildProcess;
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function startSupervisor(): Promise<RunningSupervisor> {
  const child = spawn(
    'pnpm',
    ['exec', 'tsx', 'apps/supervisor-api/src/index.ts'],
    {
      cwd: repoRoot,
      env: supervisorEnv,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  const append = (chunk: Buffer | string) => {
    output = `${output}${String(chunk)}`.slice(-16_384);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  await waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error(`Supervisor exited during startup.\n${output}`);
    }
    const response = await fetch(`${baseUrl}/healthz`);
    return response.ok ? true : null;
  }, 30_000, 'Supervisor health');
  return { child, output: () => output };
}

async function stopSupervisor(
  supervisor: RunningSupervisor,
  signal: NodeJS.Signals,
) {
  if (supervisor.child.pid && supervisor.child.exitCode === null) {
    try {
      process.kill(-supervisor.child.pid, signal);
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

async function jsonRequest<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${pathname} returned ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) as T : {} as T;
}

interface FakeHistoryItem {
  kind: string;
  text?: string | null;
}

interface FakeTurn {
  items: FakeHistoryItem[];
}

interface FakeThreadDetail {
  turns?: FakeTurn[];
  liveItems?: { items?: FakeHistoryItem[] } | null;
}

function partialAgentItems(detail: FakeThreadDetail) {
  const turnItems = Array.isArray(detail.turns)
    ? detail.turns.flatMap((turn) => Array.isArray(turn.items) ? turn.items : [])
    : [];
  const liveItems = Array.isArray(detail.liveItems?.items)
    ? detail.liveItems.items
    : [];
  return [...turnItems, ...liveItems].filter(
    (item) =>
      item.kind === 'agentMessage' &&
      typeof item.text === 'string' &&
      item.text.includes('FAKE_ACP_PARTIAL_1'),
  );
}

let supervisor: RunningSupervisor | null = null;
try {
  supervisor = await startSupervisor();
  const capabilitySnapshot = await jsonRequest<{
    effectiveCapabilities?: {
      sessions?: { load?: boolean; delete?: boolean };
    };
  }>(
    '/api/agent-runtimes/acp/capabilities?agentId=custom',
  );
  if (
    capabilitySnapshot.effectiveCapabilities?.sessions?.load !== true ||
    capabilitySnapshot.effectiveCapabilities?.sessions?.delete !== true
  ) {
    throw new Error('Supervisor did not expose negotiated child ACP capabilities.');
  }
  const workspaceRecord = await jsonRequest<{ id: string }>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ absPath: workspace, label: 'Fake ACP restart fixture' }),
  });
  const thread = await jsonRequest<{ id: string }>('/api/threads/start', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: workspaceRecord.id,
      provider: 'acp',
      agentId: 'custom',
      model: 'fixture-model',
      approvalMode: 'yolo',
      title: 'Fake ACP crash checkpoint',
    }),
  });
  await jsonRequest(`/api/threads/${thread.id}/prompt`, {
    method: 'POST',
    body: JSON.stringify({ prompt: 'Persist a partial response before restart.' }),
  });
  await waitFor(async () => {
    const detail = await jsonRequest<FakeThreadDetail>(`/api/threads/${thread.id}`);
    return partialAgentItems(detail).length > 0 ? detail : null;
  }, 20_000, 'the first durable assistant checkpoint');

  await stopSupervisor(supervisor, 'SIGKILL');
  supervisor = null;
  supervisor = await startSupervisor();

  const offlineDetail = await jsonRequest<FakeThreadDetail>(`/api/threads/${thread.id}`);
  if (partialAgentItems(offlineDetail).length !== 1) {
    throw new Error('Supervisor-only fallback did not restore exactly one partial assistant item.');
  }
  await jsonRequest(`/api/threads/${thread.id}/resume`, {
    method: 'POST',
    body: '{}',
  });
  const resumedDetail = await jsonRequest<FakeThreadDetail>(`/api/threads/${thread.id}`);
  const matchingTurns = (resumedDetail.turns ?? []).filter((turn) =>
    Array.isArray(turn.items) && turn.items.some(
      (item) => item.kind === 'userMessage' &&
        item.text === 'Persist a partial response before restart.',
    ));
  const agentItems = matchingTurns.flatMap((turn) => turn.items).filter(
    (item) => item.kind === 'agentMessage' &&
      typeof item.text === 'string' &&
      item.text.includes('FAKE_ACP_PARTIAL_1'),
  );
  if (matchingTurns.length !== 1 || agentItems.length !== 1) {
    throw new Error(
      `Hydrated restart produced ${matchingTurns.length} matching turns and ${agentItems.length} assistant items.`,
    );
  }

  process.stdout.write(`${JSON.stringify({
    fakeAcpPartialCheckpointObserved: true,
    supervisorKilledDuringStreaming: true,
    supervisorOnlyFallbackRestored: true,
    hydratedMatchingTurnCount: matchingTurns.length,
    hydratedAssistantItemCount: agentItems.length,
    duplicateItemsObserved: false,
    negotiatedChildCapabilitiesObserved: true,
  }, null, 2)}\n`);
} catch (error) {
  if (supervisor) {
    process.stderr.write(supervisor.output());
  }
  throw error;
} finally {
  if (supervisor) {
    await stopSupervisor(supervisor, 'SIGTERM').catch(() => undefined);
  }
  await fs.rm(testRoot, { recursive: true, force: true });
}
