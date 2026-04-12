import { useState } from 'react';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThreadComposer } from './ThreadComposer';
import type { PromptAttachmentUpload } from '../lib/api';

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

function setPromptValue(element: HTMLElement, value: string) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    fireEvent.change(element, {
      target: { value },
    });
    return;
  }

  element.textContent = value;
  fireEvent.input(element);
}

function setEditorSelection(
  element: HTMLElement,
  start: number,
  end = start,
) {
  const textNode = element.firstChild;
  if (!textNode) {
    throw new Error('Expected prompt editor to have a text node.');
  }

  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

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
    fireEvent.click(screen.getByRole('button', { name: 'gpt-5-mini' }));

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

    expect(screen.getByRole('button', { name: 'high' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'low' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'high' }));

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

  it('shows context remaining state on the model control title', () => {
    const { rerender } = render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        contextUsage={{
          availability: 'available',
          remainingPercent: 38,
          tokensInContextWindow: 165200,
          modelContextWindow: 258400,
          updatedAt: '2026-04-11T00:00:00.000Z',
        }}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'gpt-5.4' })).toHaveAttribute(
      'title',
      'gpt-5.4 · 38% context left',
    );

    rerender(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        contextUsage={{
          availability: 'unavailable',
          remainingPercent: null,
          tokensInContextWindow: null,
          modelContextWindow: null,
          updatedAt: null,
        }}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'gpt-5.4' })).toHaveAttribute(
      'title',
      'gpt-5.4 · context unavailable',
    );
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

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, 'Ship the fix');

    const plainEnter = createEvent.keyDown(editor, {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(editor, plainEnter);

    expect(plainEnter.defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    const ctrlEnter = createEvent.keyDown(editor, {
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(editor, ctrlEnter);

    expect(ctrlEnter.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ prompt: 'Ship the fix' });
    });

    setPromptValue(editor, 'Ship the mac fix');

    const metaEnter = createEvent.keyDown(editor, {
      key: 'Enter',
      code: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(editor, metaEnter);

    expect(metaEnter.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ prompt: 'Ship the mac fix' });
    });
  });

  it('shows attachment chips and appends their placeholders only when submitting', async () => {
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

    expect(screen.getByText('[FILE notes.txt]')).toBeInTheDocument();
    expect(screen.getByText('[FILE notes.txt (2)]')).toBeInTheDocument();

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, `Please inspect ${editor.textContent ?? ''}`);
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        prompt: 'Please inspect [FILE notes.txt] [FILE notes.txt (2)]',
        attachments: [
          expect.objectContaining({
            kind: 'file',
            originalName: 'notes.txt',
            placeholder: '[FILE notes.txt]',
          }),
          expect.objectContaining({
            kind: 'file',
            originalName: 'notes.txt',
            placeholder: '[FILE notes.txt (2)]',
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

    expect(screen.getByText('[PHOTO photo-1712800000000.heic]')).toBeInTheDocument();

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

  it('preserves controlled attachment draft state across composer remounts', async () => {
    function Harness() {
      const [draft, setDraft] = useState({
        prompt: '',
        attachments: [] as PromptAttachmentUpload[],
      });
      const [version, setVersion] = useState(0);

      return (
        <>
          <button type="button" onClick={() => setVersion((current) => current + 1)}>
            Remount
          </button>
          <ThreadComposer
            key={version}
            activeView="chat"
            model="gpt-5.4"
            reasoningEffort="medium"
            collaborationMode="default"
            modelOptions={modelOptions}
            draftPrompt={draft.prompt}
            draftAttachments={draft.attachments}
            onDraftChange={setDraft}
            onSubmit={() => undefined}
          />
        </>
      );
    }

    const { container } = render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    const fileInput = container.querySelector(
      'input[type="file"]:not([accept])',
    ) as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput!, {
      target: {
        files: [new File(['alpha'], 'notes.txt', { type: 'text/plain' })],
      },
    });

    expect(screen.getByText('[FILE notes.txt]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remount' }));

    expect(screen.getByText('[FILE notes.txt]')).toBeInTheDocument();
  });

  it('renders attachment chips inline inside the prompt editor flow', async () => {
    const { container } = render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    const fileInput = container.querySelector(
      'input[type="file"]:not([accept])',
    ) as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput!, {
      target: {
        files: [new File(['alpha'], 'notes.txt', { type: 'text/plain' })],
      },
    });

    expect(screen.getByLabelText('Prompt')).toHaveTextContent('[FILE notes.txt]');
  });

  it('keeps the caret in place when editing in the middle of chat prompt text', async () => {
    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
      />,
    );

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, 'hello world');

    await waitFor(() => {
      expect(editor).toHaveTextContent('hello world');
    });

    setEditorSelection(editor, 5);
    const insertSelection = window.getSelection();
    expect(insertSelection).toBeTruthy();
    expect(insertSelection?.anchorOffset).toBe(5);

    editor.textContent = 'helloX world';
    setEditorSelection(editor, 6);
    fireEvent.input(editor);

    await waitFor(() => {
      expect(editor).toHaveTextContent('helloX world');
      expect(window.getSelection()?.anchorOffset).toBe(6);
    });

    editor.textContent = 'hello world';
    setEditorSelection(editor, 5);
    fireEvent.input(editor);

    await waitFor(() => {
      expect(editor).toHaveTextContent('hello world');
      expect(window.getSelection()?.anchorOffset).toBe(5);
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
    expect(
      screen.queryByRole('button', { name: 'Disconnect shell' }),
    ).not.toBeInTheDocument();
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
      expect(screen.getByLabelText('Prompt')).toHaveTextContent('echo from clipboard');
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

    const editor = screen.getByLabelText('Prompt');
    editor.focus();
    expect(document.activeElement).toBe(editor);

    fireEvent.click(screen.getByRole('button', { name: 'Open shell tools' }));
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    await waitFor(() => {
      expect(onShellCopy).toHaveBeenCalled();
    });
    expect(document.activeElement).not.toBe(editor);
  });
});
