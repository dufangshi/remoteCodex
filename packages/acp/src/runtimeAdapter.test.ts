import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  AgentProviderRequest,
  AgentRuntimeEvent,
} from '../../agent-runtime/src/index';
import { AcpRuntimeAdapter } from './runtimeAdapter';

const adapters: AcpRuntimeAdapter[] = [];

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.stop()));
});

describe('AcpRuntimeAdapter', () => {
  it('runs a stdio ACP turn and resolves protocol permissions', async () => {
    const fixture = path.resolve(
      'node_modules/@agentclientprotocol/sdk/dist/examples/agent.js',
    );
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      startupTimeoutMs: 5_000,
      clientInfo: {
        name: 'remote-codex-acp-test',
        version: '1.0.0',
      },
    });
    adapters.push(adapter);
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event as AgentRuntimeEvent));
    adapter.on('provider-request', (request) => {
      const mapping = adapter.mapProviderRequest(
        request as AgentProviderRequest,
        { approvalMode: 'yolo' },
      );
      if (mapping?.autoApprovedResult) {
        adapter.respondToProviderRequest(mapping.providerRequestId, mapping.autoApprovedResult);
      }
    });

    await adapter.start();
    expect(adapter.getStatus().state).toBe('ready');
    const started = await adapter.startSession({
      cwd: process.cwd(),
      model: 'default',
      approvalMode: 'yolo',
      sandboxMode: 'workspace-write',
    });
    const completed = new Promise<Extract<AgentRuntimeEvent, { type: 'turn.completed' }>>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ACP turn did not complete.')), 10_000);
        adapter.on('event', (event: AgentRuntimeEvent) => {
          if (event.type === 'turn.completed') {
            clearTimeout(timer);
            resolve(event);
          }
        });
      },
    );
    await adapter.startTurn({
      providerSessionId: started.providerSessionId,
      prompt: 'Inspect this project.',
      workspacePath: process.cwd(),
    });
    const event = await completed;

    expect(event.turn.status).toBe('completed');
    expect(event.turn.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'userMessage',
      'agentMessage',
      'fileRead',
      'fileChange',
    ]));
    expect(events.some((candidate) => candidate.type === 'output.delta')).toBe(true);
    expect(await adapter.listLoadedSessions()).toContain(started.providerSessionId);
  }, 15_000);
});
