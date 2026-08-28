import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  AgentProviderRequest,
  AgentRuntimeEvent,
} from '../../agent-runtime/src/index';
import { AcpAgentCatalog } from './agent-catalog';
import {
  AcpCatalogRuntimeAdapter,
  acpSessionId,
} from './catalog-runtime';

const runtimes: AcpCatalogRuntimeAdapter[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

describe('AcpCatalogRuntimeAdapter', () => {
  it('keeps the built-in ACP runtime selectable when every base agent is missing', async () => {
    const runtime = new AcpCatalogRuntimeAdapter({
      catalog: new AcpAgentCatalog({
        definitions: [{
          id: 'missing-agent',
          displayName: 'Missing Agent',
          description: 'Missing ACP fixture',
          transport: 'native',
          baseCommand: 'remote-codex-missing-acp-agent',
          baseProbeCommand: 'remote-codex-missing-acp-agent --version',
          serverCommand: 'remote-codex-missing-acp-agent acp',
          serverProbeCommand: 'remote-codex-missing-acp-agent acp --help',
          installCommand: null,
        }],
      }),
    });
    runtimes.push(runtime);

    const agents = await runtime.listModels();

    expect(agents).toMatchObject([{
      id: 'missing-agent',
      acpAgent: { availability: 'base_missing' },
    }]);
    expect(runtime.installation).toMatchObject({
      installed: true,
      installedVersion: 'Built in · 0 ACP agents ready',
      lastError: 'No supported base agent was detected.',
    });
    expect(runtime.getStatus()).toMatchObject({
      state: 'degraded',
      lastError: 'No supported base agent was detected.',
    });
  });

  it('selects a concrete agent and scopes its provider session id', async () => {
    const fixture = path.resolve(
      'node_modules/@agentclientprotocol/sdk/dist/examples/agent.js',
    );
    const runtime = new AcpCatalogRuntimeAdapter({
      catalog: new AcpAgentCatalog({
        definitions: [{
          id: 'fixture-agent',
          displayName: 'Fixture Agent',
          description: 'ACP fixture',
          transport: 'native',
          baseCommand: process.execPath,
          baseProbeCommand: `"${process.execPath}" --version`,
          serverCommand: `"${process.execPath}" "${fixture}"`,
          serverProbeCommand: `"${process.execPath}" --version`,
          installCommand: null,
        }],
      }),
      startupTimeoutMs: 5_000,
    });
    runtimes.push(runtime);
    runtime.on('provider-request', (request) => {
      const mapping = runtime.mapProviderRequest(
        request as AgentProviderRequest,
        { approvalMode: 'yolo' },
      );
      if (mapping?.autoApprovedResult) {
        runtime.respondToProviderRequest(mapping.providerRequestId, mapping.autoApprovedResult);
      }
    });

    await runtime.start();
    expect(await runtime.listModels()).toMatchObject([{
      id: 'fixture-agent',
      model: 'fixture-agent',
      selectionKind: 'agent',
      acpAgent: { availability: 'ready' },
    }]);
    const session = await runtime.startSession({
      cwd: process.cwd(),
      agentId: 'fixture-agent',
      model: 'default',
      approvalMode: 'yolo',
      sandboxMode: 'workspace-write',
    });
    expect(acpSessionId.decode(session.providerSessionId)).toMatchObject({
      agentId: 'fixture-agent',
    });
    expect(session.agentId).toBe('fixture-agent');
    expect(session.model).toBe('default');

    const completed = new Promise<Extract<AgentRuntimeEvent, { type: 'turn.completed' }>>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Catalog turn timed out.')), 10_000);
        runtime.on('event', (event: AgentRuntimeEvent) => {
          if (event.type === 'turn.completed') {
            clearTimeout(timer);
            resolve(event);
          }
        });
      },
    );
    await runtime.startTurn({
      providerSessionId: session.providerSessionId,
      prompt: 'Run the fixture turn.',
      model: 'default',
      workspacePath: process.cwd(),
    });
    const event = await completed;
    expect(event.providerSessionId).toBe(session.providerSessionId);
    expect(event.turn.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'userMessage',
      'agentMessage',
      'fileRead',
      'fileChange',
    ]));
  }, 15_000);
});
