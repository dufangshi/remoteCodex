import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentCapabilitySnapshotDto,
  ModelOptionDto,
  ThreadDto,
} from '@remote-codex/shared';
import {
  HarnessSettingsDialog,
  HarnessSettingsFields,
} from './HarnessSettingsDialog';

const models: ModelOptionDto[] = [
  {
    id: 'model',
    model: 'model',
    displayName: 'GPT-6.1 Sol',
    description: '',
    isDefault: true,
    hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: '' },
      { reasoningEffort: 'high', description: '' },
    ],
  },
];
const thread = {
  id: 'fixture',
  model: 'model',
  reasoningEffort: 'high',
  activeTurnId: null,
  sandboxMode: null,
} as ThreadDto;
const snapshot = {
  negotiated: { harness: { notice: 'Ready', plugins: [] } },
} as unknown as AgentCapabilitySnapshotDto;
const loadCapabilities = vi.fn(async () => snapshot);

describe('session settings fields', () => {
  it('keeps explicit permissions and reasoning when opened and only writes requested settings', async () => {
    const onChange = vi.fn(async () => {});
    render(
      <HarnessSettingsFields
        thread={{ ...thread, sandboxMode: 'read-only' }}
        models={models}
        busy={false}
        onChange={onChange}
        loadCapabilities={loadCapabilities}
      />,
    );
    await screen.findByText('Ready');
    expect(screen.getByRole('combobox', { name: 'Harness model' })).toHaveValue(
      'model',
    );
    expect(
      screen.getByRole('combobox', { name: 'Harness reasoning effort' }),
    ).toHaveValue('high');
    const permissions = screen.getByRole('combobox', {
      name: 'Workspace permissions',
    });
    expect(permissions).toHaveValue('read-only');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(permissions, { target: { value: 'workspace-write' } });
    expect(onChange).toHaveBeenCalledWith({ sandboxMode: 'workspace-write' });
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Harness reasoning effort' }),
      { target: { value: 'medium' } },
    );
    expect(onChange).toHaveBeenLastCalledWith({ reasoningEffort: 'medium' });
  });

  it('shows full access for unset permissions without changing the thread', async () => {
    const onChange = vi.fn(async () => {});
    render(
      <HarnessSettingsFields
        thread={thread}
        models={models}
        busy={false}
        onChange={onChange}
        loadCapabilities={loadCapabilities}
      />,
    );
    await screen.findByText('Ready');
    expect(
      screen.getByRole('combobox', { name: 'Workspace permissions' }),
    ).toHaveValue('danger-full-access');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks the whole portal dialog as owned and makes running session settings read-only', async () => {
    render(
      <HarnessSettingsDialog
        thread={{ ...thread, activeTurnId: 'running' }}
        models={models}
        busy={false}
        onChange={vi.fn(async () => {})}
        loadCapabilities={loadCapabilities}
        composerFocusOwner="composer-one"
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveAttribute(
        'data-composer-focus-owner',
        'composer-one',
      ),
    );
    for (const select of screen.getAllByRole('combobox'))
      expect(select).toBeDisabled();
    expect(
      screen
        .getByRole('button', { name: 'Close' })
        .closest('[data-composer-focus-owner]'),
    ).toBe(screen.getByRole('dialog'));
  });
});
