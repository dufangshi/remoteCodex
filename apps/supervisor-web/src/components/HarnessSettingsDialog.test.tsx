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

describe('DeepSeek Harness panel', () => {
  const dsh = {
    kind: 'dsh',
    version: '0.2.0-rc.2',
    profile: 'acp',
    permissionPresets: ['read-only', 'workspace-write'],
    plugins: [
      { id: 'include:repeat', name: 'Repeat guard', module: '@deepseek-ai/dsh-repeat-tool-reminder', description: '', enabled: true, active: true, readOnly: null },
      { id: 'include:timer', name: 'Timer', module: '@deepseek-ai/cordis-plugin-timer', description: '', enabled: true, active: true, readOnly: 'management-required' },
    ],
    bundles: [{ name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', description: '', enabled: true, removable: false, readOnly: 'management-required' }],
    providers: [{ id: 'deepseek-official', name: 'DeepSeek', declared: true }],
    session: {
      running: true,
      projections: {
        permissions: { currentValue: 'read-only' },
        plan: { active: true, pending: false },
        goal: { goal: { objective: 'ship it', phase: 'active' }, roundsStarted: 3 },
        todos: [{ content: 'write tests', status: 'in_progress' }],
      },
    },
  };
  const dshSnapshot = { negotiated: { harness: dsh } } as unknown as AgentCapabilitySnapshotDto;

  it('shows live DSH state and routes typed actions, then offers a reconnect', async () => {
    const runHarnessAction = vi.fn(async (action: { kind: string }) => {
      if (action.kind === 'settings')
        return { settings: [{ ns: 'session-log-deepseek', revision: 4, fields: [{ key: 'enabled', value: true, overridden: false }] }] };
      if (action.kind === 'updateSetting')
        return { result: { ns: 'session-log-deepseek', revision: 5, fields: [{ key: 'enabled', value: false, overridden: true }] } };
      return { result: { application: 'restart-required' }, harness: dsh };
    });
    const onReconnect = vi.fn(async () => {});
    render(
      <HarnessSettingsFields thread={thread} models={models} busy={false}
        onChange={vi.fn(async () => {})} loadCapabilities={async () => dshSnapshot}
        runHarnessAction={runHarnessAction as never} onReconnect={onReconnect} />,
    );
    await screen.findByText('DeepSeek Harness 0.2.0-rc.2 · acp profile');
    expect(screen.getByText('read-only')).toBeInTheDocument();
    expect(screen.getByText('ship it · active · round 3')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Todo list' })).toHaveTextContent('write tests');
    expect(screen.getByRole('checkbox', { name: 'Enable Timer' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(runHarnessAction).toHaveBeenCalledWith({ kind: 'stop' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Repeat guard' }));
    await waitFor(() => expect(runHarnessAction).toHaveBeenCalledWith({ kind: 'setPluginEnabled', id: 'include:repeat', enabled: false }));
    // The live process still runs the plugin; the saved choice stays visible.
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Enable Repeat guard' })).not.toBeChecked());
    expect(screen.getByText('Disabled · applies after reconnect')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect to apply' }));
    await waitFor(() => expect(onReconnect).toHaveBeenCalled());
    await waitFor(() => expect(runHarnessAction).toHaveBeenCalledWith({ kind: 'refresh' }));

    fireEvent.click(screen.getByText('Profile settings'));
    fireEvent(screen.getByText('Profile settings').closest('details')!, new Event('toggle'));
    const toggle = await screen.findByRole('checkbox', { name: 'session-log-deepseek.enabled' });
    fireEvent.click(toggle);
    await waitFor(() => expect(runHarnessAction).toHaveBeenCalledWith({
      kind: 'updateSetting', ns: 'session-log-deepseek', key: 'enabled', value: false, revision: 4,
    }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'session-log-deepseek.enabled' })).not.toBeChecked());
  });

  it('keeps every DSH control read-only for viewers', async () => {
    render(
      <HarnessSettingsFields thread={thread} models={models} busy={false} readOnly
        onChange={vi.fn(async () => {})} loadCapabilities={async () => dshSnapshot}
        runHarnessAction={vi.fn() as never} />,
    );
    await screen.findByText('DeepSeek Harness 0.2.0-rc.2 · acp profile');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
  });
});
