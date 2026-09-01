import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import type {
  AgentProviderRequest,
  AgentRuntimeEvent,
} from '../packages/agent-runtime/src/index';
import {
  AcpRuntimeAdapter,
  assertAcpHarnessContract,
} from '../packages/acp/src/index';

const timeoutMs = Number(process.env.REMOTE_CODEX_ACP_TIMEOUT_MS ?? 180_000);
const command = process.env.REMOTE_CODEX_ACP_COMMAND ?? 'codex-acp';
const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const localRoot = path.resolve('.local');
await fs.mkdir(localRoot, { recursive: true });
const workspace = await fs.mkdtemp(path.join(localRoot, 'acp-codex-restart-'));
const isolatedCodexHome = await fs.mkdtemp(
  path.join(localRoot, 'acp-codex-home-'),
);
const sourceCodexHome = process.env.CODEX_HOME?.trim() ||
  path.join(os.homedir(), '.codex');
for (const fileName of ['auth.json', 'config.toml']) {
  const source = path.join(sourceCodexHome, fileName);
  try {
    await fs.access(source);
    await fs.symlink(source, path.join(isolatedCodexHome, fileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function createAdapter(
  approvalMode: 'yolo' | 'guarded' = 'yolo',
  onPermission?: () => void,
) {
  const adapter = new AcpRuntimeAdapter({
    command,
    env: {
      CODEX_HOME: isolatedCodexHome,
      CODEX_PATH: process.env.CODEX_PATH?.trim() || 'codex',
    },
    startupTimeoutMs: 30_000,
    clientInfo: {
      name: 'remote-codex-restart-verifier',
      title: 'Remote Codex Restart Verifier',
      version: '1.0.0',
    },
  });
  adapter.on('provider-request', (request) => {
    const mapping = adapter.mapProviderRequest(
      request as AgentProviderRequest,
      { approvalMode },
    );
    if (mapping?.autoApprovedResult) {
      adapter.respondToProviderRequest(
        mapping.providerRequestId,
        mapping.autoApprovedResult,
      );
      return;
    }
    if (mapping?.pendingRequest) {
      const allowLabel = mapping.pendingRequest.request.questions
        .flatMap((question) => question.options ?? [])
        .find((option) => /^allow\b/i.test(option.label))?.label;
      if (!allowLabel) {
        throw new Error('Guarded ACP permission did not offer an allow option.');
      }
      onPermission?.();
      const response = adapter.buildProviderRequestResponse(
        mapping.pendingRequest,
        { answers: { permission: { answers: [allowLabel] } } },
      );
      adapter.respondToProviderRequest(mapping.providerRequestId, response);
    }
  });
  return adapter;
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
    scanlines[offset] = 0;
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

function waitForCompletedTurn(adapter: AcpRuntimeAdapter) {
  return new Promise<Extract<AgentRuntimeEvent, { type: 'turn.completed' }>>(
    (resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Codex ACP turn timed out after ${timeoutMs}ms.`)),
        timeoutMs,
      );
      adapter.on('event', function onEvent(event: AgentRuntimeEvent) {
        if (event.type !== 'turn.completed') return;
        clearTimeout(timer);
        adapter.off('event', onEvent);
        resolve(event);
      });
    },
  );
}

function agentText(event: Extract<AgentRuntimeEvent, { type: 'turn.completed' }>) {
  return event.turn.items
    .filter((item) => item.kind === 'agentMessage')
    .map((item) => item.text)
    .join('\n');
}

async function waitForProviderCatalog(
  adapter: AcpRuntimeAdapter,
  providerSessionId: string,
) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const sessions = await adapter.listSessions();
    if (sessions.some((session) => session.providerSessionId === providerSessionId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Codex ACP session did not become visible in the provider catalog.');
}

let first: AcpRuntimeAdapter | null = null;
let second: AcpRuntimeAdapter | null = null;
let providerSessionId: string | null = null;
let sessionDeleted = false;
let guarded: AcpRuntimeAdapter | null = null;
let guardedSessionId: string | null = null;
let guardedSessionDeleted = false;

try {
  first = createAdapter();
  await first.start();
  const session = await first.startSession({
    cwd: workspace,
    model: 'default',
    approvalMode: 'yolo',
    sandboxMode: 'workspace-write',
  });
  providerSessionId = session.providerSessionId;
  const firstCompleted = waitForCompletedTurn(first);
  await first.startTurn({
    providerSessionId,
    prompt:
      `Remember the nonce ${marker} for the next turn. ` +
      `Reply with exactly SEED_OK_${marker}.`,
    workspacePath: workspace,
  });
  const firstEvent = await firstCompleted;
  if (
    firstEvent.turn.status !== 'completed' ||
    !agentText(firstEvent).includes(`SEED_OK_${marker}`)
  ) {
    throw new Error('The first real Codex ACP turn did not return its seed marker.');
  }
  await first.closeSession(providerSessionId);
  await waitForProviderCatalog(first, providerSessionId);
  await first.stop();
  first = null;

  second = createAdapter();
  const hydrationEvents: AgentRuntimeEvent[] = [];
  second.on('event', (event) => hydrationEvents.push(event as AgentRuntimeEvent));
  await second.start();
  if (
    !second.capabilities.turns.steer ||
    !second.capabilities.turns.compact ||
    !second.capabilities.controls.goals ||
    second.capabilities.branching.fork ||
    second.capabilities.branching.hardRollback
  ) {
    throw new Error('Codex ACP extension capability patch is incorrect.');
  }
  const listed = await second.listSessions();
  if (!listed.some((candidate) => candidate.providerSessionId === providerSessionId)) {
    throw new Error('The real Codex ACP session was not listed after restart.');
  }
  const resumed = await second.resumeSession({
    providerSessionId,
    performanceMode: 'fast',
  });
  if (!second.capabilities.controls.performanceMode) {
    throw new Error('Codex ACP did not expose fast mode from session config.');
  }
  assertAcpHarnessContract({
    negotiated: second.getProtocolSnapshot(),
    effectiveCapabilities: second.capabilities,
    expectedAgentName: '@agentclientprotocol/codex-acp',
    required: [
      'sessions.list',
      'sessions.load',
      'sessions.resume',
      'turns.steer',
      'turns.compact',
      'controls.goals',
      'controls.performanceMode',
    ],
    unsupported: ['branching.fork', 'branching.hardRollback'],
  });
  const hydratedText = resumed.session.turns
    .flatMap((turn) => turn.items)
    .filter((item) => item.kind === 'agentMessage')
    .map((item) => item.text)
    .join('\n');
  if (!hydratedText.includes(`SEED_OK_${marker}`)) {
    throw new Error('Hydrated Codex ACP history did not contain the seed marker.');
  }
  if (resumed.session.turns.length !== 1) {
    throw new Error(
      `Expected one hydrated user turn, received ${resumed.session.turns.length}.`,
    );
  }
  const hydratedTurnCount = resumed.session.turns.length;
  if (hydrationEvents.length !== 0) {
    throw new Error('Hydration emitted live runtime events.');
  }

  const followUpCompleted = waitForCompletedTurn(second);
  await second.startTurn({
    providerSessionId,
    prompt:
      `What nonce did I ask you to remember in the previous turn? ` +
      `Reply with exactly CONTEXT_OK_ followed by that nonce.`,
    workspacePath: workspace,
  });
  const followUpEvent = await followUpCompleted;
  if (
    followUpEvent.turn.status !== 'completed' ||
    !agentText(followUpEvent).includes(`CONTEXT_OK_${marker}`)
  ) {
    throw new Error('The restarted Codex ACP session did not preserve model context.');
  }
  const fastModeUsageObserved = hydrationEvents.some((event) =>
    event.type === 'usage.updated' && event.providerSessionId === providerSessionId);
  if (!fastModeUsageObserved) {
    throw new Error('The fast-mode Codex ACP turn did not publish usage.');
  }

  await fs.writeFile(path.join(workspace, 'solid-red.png'), solidRedPng());
  const imageCompleted = waitForCompletedTurn(second);
  await second.startTurn({
    providerSessionId,
    prompt:
      'Inspect [PHOTO ./solid-red.png]. If the dominant color is red, reply exactly IMAGE_OK_RED; otherwise reply IMAGE_WRONG.',
    workspacePath: workspace,
  });
  const imageEvent = await imageCompleted;
  if (!agentText(imageEvent).includes('IMAGE_OK_RED')) {
    throw new Error('The real Codex ACP image prompt did not identify the red image.');
  }

  const steerCompleted = waitForCompletedTurn(second);
  const steerTurn = await second.startTurn({
    providerSessionId,
    prompt:
      `Run a shell sleep for 2 seconds, then reply exactly STEER_BASE_${marker}.`,
    workspacePath: workspace,
  });
  await second.sendInput({
    providerSessionId,
    providerTurnId: steerTurn.providerTurnId,
    prompt: `Replace the final reply with exactly STEER_OK_${marker}.`,
    workspacePath: workspace,
  });
  const steerEvent = await steerCompleted;
  if (!agentText(steerEvent).includes(`STEER_OK_${marker}`)) {
    throw new Error('The real Codex ACP steering extension did not affect the active turn.');
  }

  await second.compactSession(providerSessionId);
  const compactFollowUp = waitForCompletedTurn(second);
  await second.startTurn({
    providerSessionId,
    prompt: `Reply with exactly COMPACT_OK_${marker}.`,
    workspacePath: workspace,
  });
  if (!agentText(await compactFollowUp).includes(`COMPACT_OK_${marker}`)) {
    throw new Error('The Codex ACP session did not continue after compact.');
  }

  const goal = await second.setGoal({
    providerSessionId,
    objective:
      `Reply exactly GOAL_OK_${marker}, then mark this goal complete without changing files.`,
  });
  if (goal.objective.length === 0 || !(await second.getGoal(providerSessionId))) {
    throw new Error('The Codex ACP goal extension did not publish a goal snapshot.');
  }
  const pausedGoal = await second.setGoal({
    providerSessionId,
    status: 'paused',
  });
  if (pausedGoal.status !== 'paused') {
    throw new Error('The Codex ACP goal extension did not publish paused state.');
  }
  const resumedGoal = await second.setGoal({
    providerSessionId,
    status: 'active',
  });
  if (resumedGoal.status !== 'active') {
    throw new Error('The Codex ACP goal extension did not publish resumed state.');
  }
  await second.clearGoal(providerSessionId);
  if (await second.getGoal(providerSessionId)) {
    throw new Error('The Codex ACP goal extension did not clear its goal snapshot.');
  }

  await second.deleteSession(providerSessionId);
  sessionDeleted = true;

  let guardedPermissionCount = 0;
  guarded = createAdapter('guarded', () => {
    guardedPermissionCount += 1;
  });
  await guarded.start();
  const guardedSession = await guarded.startSession({
    cwd: workspace,
    model: 'default',
    approvalMode: 'guarded',
    sandboxMode: 'read-only',
  });
  guardedSessionId = guardedSession.providerSessionId;
  const guardedCompleted = waitForCompletedTurn(guarded);
  await guarded.startTurn({
    providerSessionId: guardedSessionId,
    prompt:
      `Create guarded-permission.txt in the workspace containing ${marker}, ` +
      `then reply exactly GUARDED_OK_${marker}.`,
    workspacePath: workspace,
    sandboxMode: 'read-only',
  });
  const guardedEvent = await guardedCompleted;
  const guardedFile = await fs.readFile(
    path.join(workspace, 'guarded-permission.txt'),
    'utf8',
  );
  if (
    guardedPermissionCount < 1 ||
    !guardedFile.includes(marker) ||
    !agentText(guardedEvent).includes(`GUARDED_OK_${marker}`)
  ) {
    throw new Error('The real guarded Codex ACP permission flow did not complete.');
  }
  await guarded.deleteSession(guardedSessionId);
  guardedSessionDeleted = true;
  process.stdout.write(`${JSON.stringify({
    command,
    protocolVersion: second.getProtocolSnapshot()?.protocolVersion ?? null,
    seedMarkerObserved: true,
    hydratedTurnCount,
    hydrationEmittedLiveEvents: false,
    providerContextContinued: true,
    imagePromptUnderstood: true,
    runningTurnSteered: true,
    compactAndContinue: true,
    goalLifecycle: true,
    fastModeNegotiated: true,
    fastModeUsageObserved,
    guardedPermissionCount,
    guardedFileWritten: true,
    sessionDeleted,
    guardedSessionDeleted,
  }, null, 2)}\n`);
} finally {
  await first?.stop().catch(() => undefined);
  if (second && providerSessionId && !sessionDeleted) {
    await second.deleteSession(providerSessionId).catch(() => undefined);
  }
  await second?.stop().catch(() => undefined);
  if (guarded && guardedSessionId && !guardedSessionDeleted) {
    await guarded.deleteSession(guardedSessionId).catch(() => undefined);
  }
  await guarded?.stop().catch(() => undefined);
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.rm(isolatedCodexHome, { recursive: true, force: true });
}
