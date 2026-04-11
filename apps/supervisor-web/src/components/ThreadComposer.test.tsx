import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
      expect(onSubmit).toHaveBeenCalledWith({ prompt: 'Ship the fix' });
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
      expect(onSubmit).toHaveBeenCalledWith({ prompt: 'Ship the mac fix' });
    });
  });

  it('appends attachment placeholders and only submits attachments still present in the prompt', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    const fileInput = container.querySelector('input[type="file"]:not([accept])') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput!, {
      target: {
        files: [
          new File(['alpha'], 'notes.txt', { type: 'text/plain' }),
          new File(['beta'], 'notes.txt', { type: 'text/plain' }),
        ],
      },
    });

    const textarea = screen.getByLabelText('Prompt');
    expect(textarea).toHaveValue('[FILE notes.txt] [FILE notes.txt (2)]');

    fireEvent.change(textarea, {
      target: { value: 'Please inspect [FILE notes.txt]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        prompt: 'Please inspect [FILE notes.txt]',
        attachments: [
          expect.objectContaining({
            kind: 'file',
            originalName: 'notes.txt',
            placeholder: '[FILE notes.txt]',
          }),
        ],
      });
    });
  });

  it('falls back to a safe photo file name when the browser provides an empty one', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1712800000000);

    const { container } = render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    const photoInput = container.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement | null;
    expect(photoInput).toBeTruthy();

    fireEvent.change(photoInput!, {
      target: {
        files: [new File(['img'], '', { type: 'image/heic' })],
      },
    });

    expect(screen.getByLabelText('Prompt')).toHaveValue(
      '[PHOTO photo-1712800000000.heic]',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        prompt: '[PHOTO photo-1712800000000.heic]',
        attachments: [
          expect.objectContaining({
            kind: 'photo',
            originalName: 'photo-1712800000000.heic',
            placeholder: '[PHOTO photo-1712800000000.heic]',
          }),
        ],
      });
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

  it('submits an empty shell prompt so Send can act like Enter', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

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
          isMobileShell: true,
          hasShell: true,
          busy: false,
          loading: false,
          error: null,
        }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send Shell Input' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ prompt: '' });
    });
  });

  it('routes mobile shell CLEAR through the same submit path as typing clear and sending', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

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
          isMobileShell: true,
          hasShell: true,
          busy: false,
          loading: false,
          error: null,
        }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open shell tools' }));
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ prompt: 'clear' });
    });
  });

  it('pastes clipboard text into the shell prompt instead of sending it to the terminal', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const readText = vi.fn().mockResolvedValue('echo from clipboard');
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        readText,
      },
    });

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
          isMobileShell: true,
          hasShell: true,
          busy: false,
          loading: false,
          error: null,
        }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open shell tools' }));
    fireEvent.click(screen.getByRole('button', { name: /paste/i }));

    await waitFor(() => {
      expect(readText).toHaveBeenCalled();
      expect(screen.getByLabelText('Prompt')).toHaveValue('echo from clipboard');
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('copies the last shell command output and blurs the prompt when using toolbox actions', async () => {
    const onShellCopy = vi.fn().mockResolvedValue(undefined);

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
          isMobileShell: true,
          hasShell: true,
          busy: false,
          loading: false,
          error: null,
        }}
        onSubmit={() => undefined}
        onShellCopy={onShellCopy}
      />,
    );

    const textarea = screen.getByLabelText('Prompt');
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    fireEvent.click(screen.getByRole('button', { name: 'Open shell tools' }));
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    await waitFor(() => {
      expect(onShellCopy).toHaveBeenCalled();
    });
    expect(document.activeElement).not.toBe(textarea);
  });
});
