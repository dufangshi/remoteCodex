import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { AgentBackendDto, ModelOptionDto, ThreadDto, WorkspaceDto } from '@remote-codex/shared';
import { ThreadCreateForm } from './ThreadCreateForm';

const api = vi.hoisted(() => ({
  createThread: vi.fn(),
  fetchAgentBackendAgents: vi.fn(),
  fetchAgentBackends: vi.fn(),
  fetchAgentBackendModels: vi.fn(),
  fetchAgentBackendModelsFor: vi.fn(),
  fetchWorkspaces: vi.fn(),
  installOrUpdateAgentBackend: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  ...api,
}));

const backend = {
  provider: 'codex',
  displayName: 'OpenAI Codex',
  enabled: true,
  capabilities: {
    sessions: { resume: true },
    turns: { start: true },
  },
  installation: {
    installed: true,
    installedVersion: '1.0.0',
    updateCommand: null,
    busy: false,
  },
} as AgentBackendDto;

const workspace = {
  id: 'workspace-1',
  label: 'Workspace',
  absPath: '/workspace',
} as WorkspaceDto;

const model = {
  id: 'model-1',
  model: 'gpt-test',
  displayName: 'GPT Test',
  description: 'Test model',
  isDefault: true,
  hidden: false,
  supportedReasoningEfforts: [],
  defaultReasoningEffort: null,
} as ModelOptionDto;

describe('ThreadCreateForm', () => {
  it('defaults to full access and creates threads without a title override', async () => {
    api.fetchWorkspaces.mockResolvedValue([workspace]);
    api.fetchAgentBackends.mockResolvedValue([backend]);
    api.fetchAgentBackendModelsFor.mockResolvedValue([model]);
    api.createThread.mockResolvedValue({ id: 'thread-1' } as ThreadDto);
    const onCreated = vi.fn();

    render(
      <MemoryRouter>
        <ThreadCreateForm onCreated={onCreated} />
      </MemoryRouter>,
    );

    const fullAccess = await screen.findByRole('radio', { name: 'Full access' });
    expect(fullAccess).toBeChecked();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Thread' }));

    await waitFor(() =>
      expect(api.createThread).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        provider: 'codex',
        model: 'gpt-test',
        approvalMode: 'yolo',
      }),
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 'thread-1' });
  });
});
