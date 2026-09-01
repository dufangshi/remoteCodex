import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

import type {
  AgentProviderRequest,
  AgentRuntimeEvent,
} from '../packages/agent-runtime/src/index';
import {
  AcpRuntimeAdapter,
  assertAcpHarnessContract,
} from '../packages/acp/src/index';

if (process.env.REMOTE_CODEX_REAL_ACP_E2E !== '1') {
  throw new Error('Set REMOTE_CODEX_REAL_ACP_E2E=1 to run a real non-Codex ACP E2E.');
}

const command = process.env.REMOTE_CODEX_ACP_COMMAND ?? 'claude-agent-acp';
const expectedAgentName = process.env.REMOTE_CODEX_ACP_EXPECTED_AGENT ??
  '@agentclientprotocol/claude-agent-acp';
const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const localRoot = path.resolve('.local');
await fs.mkdir(localRoot, { recursive: true });
const workspace = await fs.mkdtemp(path.join(localRoot, 'acp-non-codex-'));

function createAdapter() {
  const adapter = new AcpRuntimeAdapter({
    command,
    startupTimeoutMs: 30_000,
    clientInfo: {
      name: 'remote-codex-non-codex-verifier',
      title: 'Remote Codex Non-Codex ACP Verifier',
      version: '1.0.0',
    },
  });
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
  return adapter;
}

function waitForCompletedTurn(adapter: AcpRuntimeAdapter) {
  return new Promise<Extract<AgentRuntimeEvent, { type: 'turn.completed' }>>(
    (resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Non-Codex ACP turn timed out.')),
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

function sessionAgentText(adapterSession: Awaited<ReturnType<AcpRuntimeAdapter['readSession']>>) {
  return adapterSession.turns
    .flatMap((turn) => turn.items)
    .filter((item) => item.kind === 'agentMessage')
    .map((item) => item.text)
    .join('\n');
}

let first: AcpRuntimeAdapter | null = null;
let second: AcpRuntimeAdapter | null = null;
let providerSessionId: string | null = null;
let forkedSessionId: string | null = null;
let providerDeleted = false;
let forkDeleted = false;
try {
  first = createAdapter();
  await first.start();
  const protocol = first.getProtocolSnapshot();
  if (protocol?.agentInfo?.name !== expectedAgentName) {
    throw new Error(`Expected ACP agent ${expectedAgentName}, received ${protocol?.agentInfo?.name ?? 'unknown'}.`);
  }
  assertAcpHarnessContract({
    negotiated: protocol,
    effectiveCapabilities: first.capabilities,
    expectedAgentName,
    required: [
      'sessions.list',
      'sessions.load',
      'sessions.resume',
      'turns.steer',
      'branching.fork',
      'controls.goals',
    ],
    unsupported: ['turns.compact', 'branching.hardRollback'],
  });
  const created = await first.startSession({
    cwd: workspace,
    model: 'default',
    approvalMode: 'yolo',
  });
  providerSessionId = created.providerSessionId;
  const seedCompleted = waitForCompletedTurn(first);
  await first.startTurn({
    providerSessionId,
    prompt: `Remember nonce ${marker}. Reply exactly NON_CODEX_SEED_OK_${marker}.`,
    workspacePath: workspace,
  });
  if (!agentText(await seedCompleted).includes(`NON_CODEX_SEED_OK_${marker}`)) {
    throw new Error('Non-Codex ACP seed turn did not return its marker.');
  }
  await first.closeSession(providerSessionId);
  await first.stop();
  first = null;

  second = createAdapter();
  const hydrationEvents: AgentRuntimeEvent[] = [];
  second.on('event', (event) => hydrationEvents.push(event as AgentRuntimeEvent));
  await second.start();
  const listed = await second.listSessions();
  if (!listed.some((session) => session.providerSessionId === providerSessionId)) {
    throw new Error('Non-Codex ACP session was not listed after process restart.');
  }
  const resumed = await second.resumeSession({ providerSessionId });
  if (!sessionAgentText(resumed.session).includes(`NON_CODEX_SEED_OK_${marker}`)) {
    throw new Error('Non-Codex ACP hydration did not restore the seed transcript.');
  }
  if (hydrationEvents.length !== 0) {
    throw new Error('Non-Codex ACP hydration emitted live runtime events.');
  }
  const contextCompleted = waitForCompletedTurn(second);
  await second.startTurn({
    providerSessionId,
    prompt: 'What nonce did I ask you to remember? Reply exactly NON_CODEX_CONTEXT_OK_ followed by it.',
    workspacePath: workspace,
  });
  if (!agentText(await contextCompleted).includes(`NON_CODEX_CONTEXT_OK_${marker}`)) {
    throw new Error('Non-Codex ACP provider context did not survive restart.');
  }

  const forked = await second.forkSession({ providerSessionId });
  forkedSessionId = forked.providerSessionId;
  if (
    forkedSessionId === providerSessionId ||
    !sessionAgentText(forked).includes(`NON_CODEX_CONTEXT_OK_${marker}`)
  ) {
    throw new Error('Standard ACP session/fork did not preserve source context.');
  }
  const forkCompleted = waitForCompletedTurn(second);
  await second.startTurn({
    providerSessionId: forkedSessionId,
    prompt:
      'What nonce did the source session ask you to remember? ' +
      'Reply exactly NON_CODEX_FORK_CONTEXT_OK_ followed by it.',
    workspacePath: workspace,
  });
  if (!agentText(await forkCompleted).includes(`NON_CODEX_FORK_CONTEXT_OK_${marker}`)) {
    throw new Error('Forked non-Codex ACP session did not preserve provider context.');
  }

  if (second.capabilities.controls.goals) {
    const goal = await second.setGoal({
      providerSessionId: forkedSessionId,
      objective: `Return NON_CODEX_GOAL_OK_${marker} without changing files.`,
    });
    if (!goal.objective || !(await second.getGoal(forkedSessionId))) {
      throw new Error('Negotiated non-Codex goal did not publish state.');
    }
    await second.clearGoal(forkedSessionId);
    if (await second.getGoal(forkedSessionId)) {
      throw new Error('Negotiated non-Codex goal did not clear state.');
    }
  }

  await second.deleteSession(forkedSessionId);
  forkDeleted = true;
  await second.deleteSession(providerSessionId);
  providerDeleted = true;
  process.stdout.write(`${JSON.stringify({
    command,
    agentName: protocol.agentInfo.name,
    protocolVersion: protocol.protocolVersion,
    negotiatedListLoadResume: true,
    codexOnlyCompactHidden: true,
    processRestarted: true,
    transcriptHydratedWithoutLiveReplay: true,
    providerContextContinued: true,
    standardSessionForked: true,
    forkTranscriptSnapshotPreserved: true,
    forkProviderContextPreserved: true,
    negotiatedSteering: second.capabilities.turns.steer,
    negotiatedGoalLifecycle: second.capabilities.controls.goals,
    providerSessionDeleted: providerDeleted,
    forkedSessionDeleted: forkDeleted,
  }, null, 2)}\n`);
} finally {
  await first?.stop().catch(() => undefined);
  if (second && forkedSessionId && !forkDeleted) {
    await second.deleteSession(forkedSessionId).catch(() => undefined);
  }
  if (second && providerSessionId && !providerDeleted) {
    await second.deleteSession(providerSessionId).catch(() => undefined);
  }
  await second?.stop().catch(() => undefined);
  await fs.rm(workspace, { recursive: true, force: true });
}
