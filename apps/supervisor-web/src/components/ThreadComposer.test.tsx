import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ThreadComposer } from './ThreadComposer';

const modelOptions = [
  {
    id: 'model-1',
    model: 'gpt-5.4',
    displayName: 'GPT-5.4',
    description: 'Primary model',
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [
      {
        reasoningEffort: 'medium' as const,
        description: 'Balanced',
      },
      {
        reasoningEffort: 'high' as const,
        description: 'Deeper reasoning',
      },
    ],
    defaultReasoningEffort: 'medium' as const,
  },
  {
    id: 'model-2',
    model: 'gpt-5-mini',
    displayName: 'GPT-5 Mini',
    description: 'Fast model',
    hidden: false,
    isDefault: false,
    supportedReasoningEfforts: [
      {
        reasoningEffort: 'low' as const,
        description: 'Fastest',
      },
      {
        reasoningEffort: 'medium' as const,
        description: 'Balanced',
      },
    ],
    defaultReasoningEffort: 'low' as const,
  },
];

describe('ThreadComposer', () => {
  it('updates the model and resets reasoning effort to that model default', async () => {
    const onUpdateSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="high"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
        onUpdateSettings={onUpdateSettings}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'gpt-5.4' }));
    fireEvent.click(screen.getByRole('button', { name: /GPT-5 Mini/i }));

    await waitFor(() => {
      expect(onUpdateSettings).toHaveBeenCalledWith({
        model: 'gpt-5-mini',
        reasoningEffort: 'low',
      });
    });
  });

  it('shows only the current model reasoning efforts and can switch plan mode', async () => {
    const onUpdateSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
        onUpdateSettings={onUpdateSettings}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'medium' }));

    expect(
      screen.getByRole('button', { name: /high deeper reasoning/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /low fastest/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /high deeper reasoning/i }),
    );

    await waitFor(() => {
      expect(onUpdateSettings).toHaveBeenCalledWith({
        reasoningEffort: 'high',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));

    await waitFor(() => {
      expect(onUpdateSettings).toHaveBeenCalledWith({
        collaborationMode: 'plan',
      });
    });
  });

  it('submits on ctrl or command enter while plain enter stays as newline behavior', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByLabelText('Prompt');
    fireEvent.change(textarea, {
      target: { value: 'Ship the fix' },
    });

    const plainEnter = createEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(textarea, plainEnter);

    expect(plainEnter.defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    const ctrlEnter = createEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(textarea, ctrlEnter);

    expect(ctrlEnter.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Ship the fix');
    });

    fireEvent.change(textarea, {
      target: { value: 'Ship the mac fix' },
    });

    const metaEnter = createEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(textarea, metaEnter);

    expect(metaEnter.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Ship the mac fix');
    });
  });

  it('shows the shell prompt label and enables Ctrl-C only while a command is running', () => {
    render(
      <ThreadComposer
        activeView="shell"
        shellControlState={{
          status: 'attached',
          connectionButtonDisabled: false,
          connectionButtonLabel: 'Disconnect shell',
          shellInputEnabled: true,
          isCommandRunning: false,
          promptLabel: '(base) trading-lab',
          isMobileShell: false,
          hasShell: true,
          busy: false,
          loading: false,
          error: null,
        }}
        onSubmit={() => undefined}
        onInterrupt={() => undefined}
      />,
    );

    expect(screen.getByText('(base) trading-lab')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Ctrl-C' })).toBeDisabled();
  });
});
