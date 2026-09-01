import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

import type {
  AgentProviderRequest,
  AgentRuntimeEvent,
} from '../packages/agent-runtime/src/index';
import { AcpRuntimeAdapter } from '../packages/acp/src/index';
import type {
  ImportThreadCandidateDto,
  ThreadDetailDto,
} from '../packages/shared/src/index';

if (process.env.REMOTE_CODEX_REAL_ACP_E2E !== '1') {
  throw new Error('Set REMOTE_CODEX_REAL_ACP_E2E=1 to run the real Codex ACP import E2E.');
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const localRoot = path.join(repoRoot, '.local');
await fs.mkdir(localRoot, { recursive: true });
const testRoot = await fs.mkdtemp(path.join(localRoot, 'acp-codex-import-'));
const workspaceRoot = path.join(testRoot, 'workspaces');
const workspace = path.join(workspaceRoot, 'import-workspace');
const databasePath = path.join(testRoot, 'supervisor.sqlite');
const isolatedCodexHome = path.join(testRoot, 'codex-home');
const command = process.env.REMOTE_CODEX_ACP_COMMAND ?? 'codex-acp';
const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
await fs.mkdir(workspace, { recursive: true });
await fs.mkdir(isolatedCodexHome, { recursive: true });

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

async function waitFor<T>(
  check: () => Promise<T | null>,
  timeoutMs: number,
  label: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check().catch(() => null);
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function waitForCompletedTurn(adapter: AcpRuntimeAdapter) {
  return new Promise<Extract<AgentRuntimeEvent, { type: 'turn.completed' }>>(
    (resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Real Codex ACP turn timed out.')),
        180_000,
      );
      const handler = (event: AgentRuntimeEvent) => {
        if (event.type !== 'turn.completed') return;
        clearTimeout(timer);
        adapter.off('event', handler);
        resolve(event);
      };
      adapter.on('event', handler);
    },
  );
}

function agentText(event: Extract<AgentRuntimeEvent, { type: 'turn.completed' }>) {
  return event.turn.items
    .filter((item) => item.kind === 'agentMessage')
    .map((item) => item.text)
    .join('\n');
}

function agentMarkerCount(detail: ThreadDetailDto, markerText: string) {
  return detail.turns
    .flatMap((turn) => turn.items)
    .filter((item) => item.kind === 'agentMessage' && item.text.includes(markerText))
    .length;
}

function autoApprove(adapter: AcpRuntimeAdapter) {
  adapter.on('provider-request', (request) => {
    const mapping = adapter.mapProviderRequest(
      request as AgentProviderRequest,
      { approvalMode: 'yolo' },
    );
    if (mapping?.autoApprovedResult) {
      adapter.respondToProviderRequest(
        mapping.providerRequestId,
        mapping.autoApprovedResult,
      );
    }
  });
}

interface RunningSupervisor {
  child: ChildProcess;
  baseUrl: string;
  output: () => string;
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
      DISABLE_REQUEST_LOGGING: '1',
      LOG_LEVEL: 'fatal',
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'acp',
      ACP_STARTUP_TIMEOUT_MS: '30000',
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
    const response = await fetch(`${baseUrl}/healthz`);
    return response.ok ? true : null;
  }, 30_000, 'Supervisor health');
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

async function jsonRequest<T>(
  supervisor: RunningSupervisor,
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${supervisor.baseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${pathname} returned ${response.status}: ${body}`);
  }
  return body ? JSON.parse(body) as T : {} as T;
}

async function requestStatus(
  supervisor: RunningSupervisor,
  pathname: string,
  init?: RequestInit,
) {
  return fetch(`${supervisor.baseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

let creator: AcpRuntimeAdapter | null = null;
let supervisor: RunningSupervisor | null = null;
let rawProviderSessionId: string | null = null;
try {
  creator = new AcpRuntimeAdapter({
    command,
    env: {
      CODEX_HOME: isolatedCodexHome,
      CODEX_PATH: process.env.CODEX_PATH?.trim() || 'codex',
    },
    startupTimeoutMs: 30_000,
  });
  autoApprove(creator);
  await creator.start();
  const created = await creator.startSession({
    cwd: workspace,
    model: 'default',
    approvalMode: 'yolo',
  });
  rawProviderSessionId = created.providerSessionId;
  const seedCompleted = waitForCompletedTurn(creator);
  await creator.startTurn({
    providerSessionId: rawProviderSessionId,
    prompt: `Remember nonce ${marker}. Reply exactly IMPORT_SEED_OK_${marker}.`,
    workspacePath: workspace,
  });
  if (!agentText(await seedCompleted).includes(`IMPORT_SEED_OK_${marker}`)) {
    throw new Error('External Codex ACP seed turn did not complete.');
  }
  await creator.closeSession(rawProviderSessionId);
  await creator.stop();
  creator = null;

  supervisor = await startSupervisor();
  const candidates = await jsonRequest<ImportThreadCandidateDto[]>(
    supervisor,
    '/api/threads/import-candidates?provider=acp&agentId=codex',
  );
  const candidate = candidates.find((entry) =>
    entry.agentId === 'codex' &&
    typeof entry.sessionId === 'string' &&
    entry.sessionId.endsWith(rawProviderSessionId!));
  if (!candidate || candidate.cwd !== workspace) {
    throw new Error('Supervisor did not discover the unmanaged Codex ACP session.');
  }

  const imported = await jsonRequest<ThreadDetailDto>(supervisor, '/api/threads/import', {
    method: 'POST',
    body: JSON.stringify({ provider: 'acp', sessionId: candidate.sessionId }),
  });
  if (
    imported.thread.agentId !== 'codex' ||
    imported.thread.source !== 'local_provider_import' ||
    imported.workspace.absPath !== workspace ||
    !JSON.stringify(imported.turns).includes(`IMPORT_SEED_OK_${marker}`)
  ) {
    throw new Error('Imported ACP thread identity, workspace, or history was incorrect.');
  }

  const duplicate = await jsonRequest<ThreadDetailDto>(supervisor, '/api/threads/import', {
    method: 'POST',
    body: JSON.stringify({ provider: 'acp', sessionId: candidate.sessionId }),
  });
  if (duplicate.thread.id !== imported.thread.id) {
    throw new Error('Repeated ACP import created a duplicate local thread.');
  }
  const candidatesAfterImport = await jsonRequest<ImportThreadCandidateDto[]>(
    supervisor,
    '/api/threads/import-candidates?provider=acp&agentId=codex',
  );
  if (candidatesAfterImport.some((entry) => entry.sessionId === candidate.sessionId)) {
    throw new Error('Imported ACP session remained in unmanaged candidates.');
  }

  const disconnectedPrompt = await requestStatus(
    supervisor,
    `/api/threads/${imported.thread.id}/prompt`,
    {
      method: 'POST',
      body: JSON.stringify({ prompt: 'This must be rejected before connect.' }),
    },
  );
  if (disconnectedPrompt.status !== 409) {
    throw new Error('Imported ACP thread accepted a prompt before explicit connect.');
  }
  await jsonRequest(supervisor, `/api/threads/${imported.thread.id}/resume`, {
    method: 'POST',
    body: '{}',
  });
  await jsonRequest(supervisor, `/api/threads/${imported.thread.id}/prompt`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'What nonce did I ask you to remember? Reply exactly IMPORT_CONTEXT_OK_ followed by it.',
    }),
  });
  await waitFor(async () => {
    const detail = await jsonRequest<ThreadDetailDto>(
      supervisor!,
      `/api/threads/${imported.thread.id}`,
    );
    return JSON.stringify(detail.turns).includes(`IMPORT_CONTEXT_OK_${marker}`)
      ? detail
      : null;
  }, 180_000, 'imported context continuation');

  await stopSupervisor(supervisor);
  supervisor = null;
  supervisor = await startSupervisor();
  const restarted = await jsonRequest<ThreadDetailDto>(
    supervisor,
    `/api/threads/${imported.thread.id}`,
  );
  const seedMatches = agentMarkerCount(restarted, `IMPORT_SEED_OK_${marker}`);
  const continuationMatches = agentMarkerCount(
    restarted,
    `IMPORT_CONTEXT_OK_${marker}`,
  );
  if (seedMatches !== 1 || continuationMatches !== 1) {
    const continuationPrompt =
      'What nonce did I ask you to remember? Reply exactly IMPORT_CONTEXT_OK_ followed by it.';
    const continuationTurnShape = restarted.turns
      .map((turn) => ({
        markerAgents: turn.items.filter(
          (item) =>
            item.kind === 'agentMessage' &&
            item.text.includes(`IMPORT_CONTEXT_OK_${marker}`),
        ).length,
        totalAgents: turn.items.filter((item) => item.kind === 'agentMessage').length,
        totalItems: turn.items.length,
        hydratedId: turn.id.startsWith('acp-hydrated:'),
        userCount: turn.items.filter((item) => item.kind === 'userMessage').length,
        userExact: turn.items.some(
          (item) => item.kind === 'userMessage' && item.text === continuationPrompt,
        ),
        userLengths: turn.items
          .filter((item) => item.kind === 'userMessage')
          .map((item) => item.text.length),
      }))
      .filter((turn) => turn.markerAgents > 0);
    throw new Error(
      `Restarted imported thread marker counts were seed=${seedMatches}, ` +
      `continuation=${continuationMatches}, shape=${JSON.stringify(continuationTurnShape)}.`,
    );
  }

  process.stdout.write(`${JSON.stringify({
    externalSessionCreated: true,
    unmanagedCandidateDiscovered: true,
    importedAgentIdentityPreserved: true,
    importedWorkspacePreserved: true,
    importedHistoryVisible: true,
    duplicateImportReusedThread: true,
    explicitConnectRequired: true,
    providerContextContinued: true,
    supervisorRestartPreservedHistory: true,
    seedMarkerCountAfterRestart: seedMatches,
    continuationMarkerCountAfterRestart: continuationMatches,
  }, null, 2)}\n`);
} catch (error) {
  if (supervisor) process.stderr.write(supervisor.output());
  throw error;
} finally {
  await creator?.stop().catch(() => undefined);
  if (supervisor) await stopSupervisor(supervisor).catch(() => undefined);
  await fs.rm(testRoot, { recursive: true, force: true });
}
