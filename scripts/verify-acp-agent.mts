import process from 'node:process';

import type {
  AgentProviderRequest,
  AgentRuntimeEvent,
} from '../packages/agent-runtime/src/index';
import { AcpRuntimeAdapter } from '../packages/acp/src/index';

const command = process.env.REMOTE_CODEX_ACP_COMMAND ?? 'grok agent stdio';
const cwd = process.env.REMOTE_CODEX_ACP_CWD ?? process.cwd();
const prompt = process.env.REMOTE_CODEX_ACP_PROMPT ??
  'Reply with exactly ACP_SMOKE_OK and do not use tools.';
const timeoutMs = Number(process.env.REMOTE_CODEX_ACP_TIMEOUT_MS ?? 120_000);

const adapter = new AcpRuntimeAdapter({
  command,
  startupTimeoutMs: 30_000,
  clientInfo: {
    name: 'remote-codex-acp-verifier',
    title: 'Remote Codex ACP Verifier',
    version: '1.0.0',
  },
});

adapter.on('provider-request', (request) => {
  const mapping = adapter.mapProviderRequest(
    request as AgentProviderRequest,
    { approvalMode: 'yolo' },
  );
  if (mapping?.autoApprovedResult) {
    adapter.respondToProviderRequest(mapping.providerRequestId, mapping.autoApprovedResult);
  }
});

try {
  await adapter.start();
  process.stderr.write(`[acp-runtime] ${JSON.stringify(adapter.getStatus())}\n`);
  const session = await adapter.startSession({
    cwd,
    model: 'default',
    approvalMode: 'yolo',
    sandboxMode: 'danger-full-access',
  });
  const completed = new Promise<Extract<AgentRuntimeEvent, { type: 'turn.completed' }>>(
    (resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`ACP smoke turn timed out after ${timeoutMs}ms.`)),
        timeoutMs,
      );
      adapter.on('event', (event: AgentRuntimeEvent) => {
        if (event.type === 'turn.completed') {
          clearTimeout(timer);
          resolve(event);
        }
      });
    },
  );
  await adapter.startTurn({
    providerSessionId: session.providerSessionId,
    prompt,
    workspacePath: cwd,
  });
  const event = await completed;
  process.stdout.write(`${JSON.stringify({
    provider: event.provider,
    providerSessionId: event.providerSessionId,
    status: event.turn.status,
    items: event.turn.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      status: item.status ?? null,
      text: item.text,
    })),
  }, null, 2)}\n`);
  if (event.turn.status !== 'completed') {
    process.exitCode = 1;
  }
} finally {
  await adapter.stop();
}
