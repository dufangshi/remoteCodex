import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentBackendDto, ModelOptionDto, ThreadDto, WorkspaceDto } from '@remote-codex/shared';

import {
  MobileThreadCreateDialogContent,
  type MobileThreadCreateClient,
} from './MobileThreadCreateDialogContent';

afterEach(cleanup);

const workspace: WorkspaceDto = {
  id: 'workspace-1',
  hostId: 'host-1',
  label: 'Mobile parity',
  absPath: '/workspace/mobile-parity',
  isFavorite: false,
  createdAt: '2026-08-30T00:00:00.000Z',
  lastOpenedAt: null,
};

const acpBackend = {
  provider: 'acp',
  displayName: 'ACP Agent',
  enabled: true,
  isDefault: true,
  capabilities: { sessions: { resume: true }, turns: { start: true } },
} as AgentBackendDto;

function acpAgent(availability: 'ready' | 'adapter_missing'): ModelOptionDto {
  return {
    id: 'grok',
    model: 'grok',
    displayName: 'Grok Build',
    description: 'ACP agent',
    isDefault: true,
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    selectionKind: 'agent',
    acpAgent: {
      transport: availability === 'ready' ? 'native' : 'adapter',
      availability,
      baseCommand: 'grok',
      baseProbeCommand: 'grok --version',
      serverCommand: 'grok agent stdio',
      serverProbeCommand: 'grok agent stdio --help',
      baseVersion: '1.0.0',
      serverVersion: availability === 'ready' ? '1.0.0' : null,
      installCommand: availability === 'adapter_missing' ? 'npm install grok-acp' : null,
      busy: false,
      statusMessage: availability === 'ready' ? 'Ready' : 'Adapter needed',
    },
  };
}

const modelOption: ModelOptionDto = {
  id: 'grok-model',
  model: 'grok-4',
  displayName: 'Grok 4',
  description: 'ACP model',
  isDefault: true,
  hidden: false,
  supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }],
  defaultReasoningEffort: 'high',
};

function client(initialAvailability: 'ready' | 'adapter_missing') {
  let availability = initialAvailability;
  return {
    listWorkspaces: vi.fn(async () => [workspace]),
    listAgentRuntimes: vi.fn(async () => [acpBackend]),
    listAgents: vi.fn(async () => [acpAgent(availability)]),
    listModels: vi.fn(async () => [modelOption]),
    installAgentAdapter: vi.fn(async () => {
      availability = 'ready';
      return acpBackend;
    }),
    createThread: vi.fn(async (input) => ({
      id: 'thread-1',
      ...input,
    }) as ThreadDto),
  } satisfies MobileThreadCreateClient;
}

describe('MobileThreadCreateDialogContent ACP flow', () => {
  it('loads agent-scoped models and creates a thread with agent and effort', async () => {
    const api = client('ready');
    render(
      <MobileThreadCreateDialogContent
        client={api}
        onCancel={() => {}}
        onCreated={() => {}}
      />,
    );

    expect(
      (await screen.findByRole('radio', { name: /Grok Build/ })).getAttribute('aria-checked'),
    ).toBe('true');
    await waitFor(() =>
      expect(api.listModels).toHaveBeenCalledWith('acp', {
        agentId: 'grok',
        cwd: workspace.absPath,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Thread' }));

    await waitFor(() =>
      expect(api.createThread).toHaveBeenCalledWith({
        workspaceId: workspace.id,
        provider: 'acp',
        agentId: 'grok',
        model: 'grok-4',
        reasoningEffort: 'high',
        approvalMode: 'yolo',
      }),
    );
  });

  it('installs a missing adapter before enabling the agent', async () => {
    const api = client('adapter_missing');
    render(
      <MobileThreadCreateDialogContent
        client={api}
        onCancel={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
    await waitFor(() => expect(api.installAgentAdapter).toHaveBeenCalledWith('acp', 'grok'));
    await waitFor(() =>
      expect(
        screen.getByRole('radio', { name: /Grok Build/ }).getAttribute('aria-checked'),
      ).toBe('true'),
    );
    expect(api.listModels).toHaveBeenCalledWith('acp', {
      agentId: 'grok',
      cwd: workspace.absPath,
    });
  });
});
