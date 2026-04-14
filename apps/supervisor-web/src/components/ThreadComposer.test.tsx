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

  it('closes model and reasoning menus when clicking outside the popup', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'gpt-5.4' }));
    expect(screen.getByRole('button', { name: 'gpt-5-mini' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: 'gpt-5-mini' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'medium' }));
    expect(screen.getByRole('button', { name: 'high' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: 'high' })).not.toBeInTheDocument();
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

  it('keeps the model control label compact and left-truncated while toolbar keeps slash plus utility buttons', () => {
    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4-super-long-mobile-label"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={[
          {
            ...modelOptions[0]!,
            id: 'model-long',
            model: 'gpt-5.4-super-long-mobile-label',
          },
        ]}
        onSubmit={() => undefined}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'gpt-5.4-super-long-mobile-label' }),
    ).toHaveClass('max-w-[8.75rem]');
    expect(
      screen.getByText('gpt-5.4-super-long-mobile-label'),
    ).toHaveClass('truncate', 'whitespace-nowrap', '[direction:rtl]');
    expect(screen.getByRole('button', { name: 'Open slash toolbox' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add attachment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to shell' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'medium' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument();
  });

  it('shows slash toolbox actions for fast toggle and compact', async () => {
    const onUpdateSettings = vi.fn().mockResolvedValue(undefined);
    const onCompact = vi.fn().mockResolvedValue(undefined);

    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
        onUpdateSettings={onUpdateSettings}
        onCompact={onCompact}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open slash toolbox' }));
    expect(screen.getByRole('button', { name: /\/fast/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\/compact/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /\/fast/i }));
    await waitFor(() => {
      expect(onUpdateSettings).toHaveBeenCalledWith({
        fastMode: true,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open slash toolbox' }));
    fireEvent.click(screen.getByRole('button', { name: /\/compact/i }));
    await waitFor(() => {
      expect(onCompact).toHaveBeenCalled();
    });
  });

  it('opens the slash toolbox upward, keeps the trigger neutral, and highlights fast inside the list', () => {
    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        fastMode
        modelOptions={modelOptions}
        onSubmit={() => undefined}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Open slash toolbox' });
    expect(trigger).toHaveClass('border-stone-700');
    expect(trigger).not.toHaveClass('border-amber-300/60');

    fireEvent.click(trigger);

    const panel = screen.getByRole('button', { name: /\/fast/i }).closest('div[class*="absolute"]');
    expect(panel).toHaveClass('bottom-full', 'mb-2', 'bg-stone-900/72', 'backdrop-blur-xl');
    expect(screen.getByRole('button', { name: /\/fast/i })).toHaveClass(
      'bg-amber-300/12',
      'text-amber-100',
    );
  });

  it('opens the skills panel from the slash toolbox and renders read-only skill entries', async () => {
    const onOpenSkills = vi.fn().mockResolvedValue(undefined);

    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
        onOpenSkills={onOpenSkills}
        skillsState={{
          status: 'ready',
          error: null,
          data: {
            cwd: '/tmp/demo',
            skills: [
              {
                name: 'skill-creator',
                description: 'Create or update a Codex skill',
                interface: {
                  displayName: 'Skill Creator',
                  shortDescription: 'Create or update a Codex skill',
                },
                path: '/tmp/demo/.codex/skills/skill-creator/SKILL.md',
                scope: 'repo',
                enabled: true,
              },
            ],
            errors: [],
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open slash toolbox' }));
    fireEvent.click(screen.getByRole('button', { name: /\/skills/i }));

    await waitFor(() => {
      expect(onOpenSkills).toHaveBeenCalled();
    });
    expect(screen.getByText('Skill Creator')).toBeInTheDocument();
    expect(screen.getByText('Repo')).toBeInTheDocument();
    expect(screen.getByText('$skill-creator')).toBeInTheDocument();
    expect(screen.queryByText('On')).not.toBeInTheDocument();
  });

  it('opens the skills panel even when no skills are available yet', async () => {
    const onOpenSkills = vi.fn().mockResolvedValue(undefined);

    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
        onOpenSkills={onOpenSkills}
        skillsState={{
          status: 'idle',
          error: null,
          data: null,
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open slash toolbox' }));
    fireEvent.click(screen.getByRole('button', { name: /\/skills/i }));

    await waitFor(() => {
      expect(onOpenSkills).toHaveBeenCalled();
    });
    expect(screen.getByText('No skills available right now.')).toBeInTheDocument();
  });

  it('opens the mcp panel from the slash toolbox and renders server status', async () => {
    const onOpenMcp = vi.fn().mockResolvedValue(undefined);

    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
        onOpenMcp={onOpenMcp}
        mcpState={{
          status: 'ready',
          error: null,
          data: {
            servers: [
              {
                name: 'github',
                authStatus: 'oAuth',
                tools: [
                  {
                    name: 'search_issues',
                    title: 'Search Issues',
                    description: 'Find issues',
                  },
                ],
                resourceCount: 2,
                resourceTemplateCount: 1,
              },
            ],
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open slash toolbox' }));
    fireEvent.click(screen.getByRole('button', { name: /\/mcp/i }));

    await waitFor(() => {
      expect(onOpenMcp).toHaveBeenCalled();
    });
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('OAuth')).toBeInTheDocument();
    expect(screen.getByText('Search Issues')).toBeInTheDocument();
  });

  it('opens the mcp panel even when no mcp servers are available yet', async () => {
    const onOpenMcp = vi.fn().mockResolvedValue(undefined);

    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
        onOpenMcp={onOpenMcp}
        mcpState={{
          status: 'idle',
          error: null,
          data: null,
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open slash toolbox' }));
    fireEvent.click(screen.getByRole('button', { name: /\/mcp/i }));

    await waitFor(() => {
      expect(onOpenMcp).toHaveBeenCalled();
    });
    expect(screen.getByText('No MCP servers available right now.')).toBeInTheDocument();
  });

  it('shows mcp add options and writes an http server block into config.toml', async () => {
    const onOpenMcp = vi.fn().mockResolvedValue(undefined);
    const onReadCodexConfig = vi.fn().mockResolvedValue({
      name: 'config.toml',
      path: '/home/u/.codex/config.toml',
      content: '[profile.default]\nmodel = "gpt-5.4"\n',
      updatedAt: '2026-04-13T12:00:00.000Z',
    });
    const onWriteCodexConfig = vi.fn().mockResolvedValue({
      name: 'config.toml',
      path: '/home/u/.codex/config.toml',
      content:
        '[profile.default]\nmodel = "gpt-5.4"\n\n[mcp_servers.docs]\nurl = "https://developers.openai.com/mcp"\n',
      updatedAt: '2026-04-13T12:00:01.000Z',
    });

    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
        onOpenMcp={onOpenMcp}
        onReadCodexConfig={onReadCodexConfig}
        onWriteCodexConfig={onWriteCodexConfig}
        mcpState={{
          status: 'ready',
          error: null,
          data: {
            servers: [],
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open slash toolbox' }));
    fireEvent.click(screen.getByRole('button', { name: /\/mcp/i }));

    await waitFor(() => {
      expect(onOpenMcp).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add MCP' }));
    expect(
      screen.getByRole('button', { name: /HTTP \/ Streamable HTTP.*Form/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /stdio \/ raw block.*TOML/i }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /HTTP \/ Streamable HTTP.*Form/i }),
    );

    fireEvent.change(screen.getByLabelText('MCP name'), {
      target: { value: 'docs' },
    });
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://developers.openai.com/mcp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Write HTTP MCP' }));

    await waitFor(() => {
      expect(onReadCodexConfig).toHaveBeenCalled();
      expect(onWriteCodexConfig).toHaveBeenCalledWith(
        '[profile.default]\nmodel = "gpt-5.4"\n\n[mcp_servers.docs]\nurl = "https://developers.openai.com/mcp"\n',
      );
    });
    expect(
      screen.getByText(/MCP entry written to config\.toml/i),
    ).toBeInTheDocument();
  });

  it('writes a raw stdio mcp block into config.toml', async () => {
    const onReadCodexConfig = vi.fn().mockResolvedValue({
      name: 'config.toml',
      path: '/home/u/.codex/config.toml',
      content: '[profile.default]\nmodel = "gpt-5.4"\n',
      updatedAt: '2026-04-13T12:00:00.000Z',
    });
    const onWriteCodexConfig = vi.fn().mockResolvedValue({
      name: 'config.toml',
      path: '/home/u/.codex/config.toml',
      content:
        '[profile.default]\nmodel = "gpt-5.4"\n\n[mcp_servers.local_docs]\ncommand = "npx"\nargs = ["-y", "@openai/example-mcp"]\n',
      updatedAt: '2026-04-13T12:00:01.000Z',
    });

    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5.4"
        reasoningEffort="medium"
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
        onReadCodexConfig={onReadCodexConfig}
        onWriteCodexConfig={onWriteCodexConfig}
        mcpState={{
          status: 'ready',
          error: null,
          data: {
            servers: [],
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open slash toolbox' }));
    fireEvent.click(screen.getByRole('button', { name: /\/mcp/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add MCP' }));
    fireEvent.click(
      screen.getByRole('button', { name: /stdio \/ raw block.*TOML/i }),
    );

    const editor = await screen.findByLabelText('MCP block for config.toml');
    fireEvent.change(editor, {
      target: {
        value:
          '[mcp_servers.local_docs]\ncommand = "npx"\nargs = ["-y", "@openai/example-mcp"]\n',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Write raw block' }));

    await waitFor(() => {
      expect(onWriteCodexConfig).toHaveBeenCalledWith(
        '[profile.default]\nmodel = "gpt-5.4"\n\n[mcp_servers.local_docs]\ncommand = "npx"\nargs = ["-y", "@openai/example-mcp"]\n',
      );
    });
    expect(
      screen.getByText(/MCP entry written to config\.toml/i),
    ).toBeInTheDocument();
  });

  it('keeps direct model controls available while fast mode is on', () => {
    render(
      <ThreadComposer
        activeView="chat"
        model="gpt-5-mini"
        reasoningEffort="low"
        fastMode
        collaborationMode="default"
        modelOptions={modelOptions}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'gpt-5-mini' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'low' })).toBeEnabled();
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

    expect(screen.getAllByText('notes.txt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('notes.txt (2)').length).toBeGreaterThan(0);

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, 'Please inspect [FILE notes.txt] [FILE notes.txt (2)]');
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

    expect(screen.getByAltText('photo-1712800000000.heic')).toBeInTheDocument();

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

    expect(screen.getAllByText('notes.txt').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Remount' }));

    expect(screen.getAllByText('notes.txt').length).toBeGreaterThan(0);
  });

  it('renders attachment previews inline inside the prompt editor flow', async () => {
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

    expect(
      screen.getByLabelText('Prompt').querySelector('[data-placeholder=\"[FILE notes.txt]\"]'),
    ).toBeTruthy();
    expect(screen.getAllByText('notes.txt').length).toBeGreaterThan(0);
  });

  it('pastes image attachments into the chat prompt as preview tokens', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const imageFile = new File(['img'], 'clipboard.png', { type: 'image/png' });

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
    const pasteEvent = createEvent.paste(editor, {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(pasteEvent, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            getAsFile: () => imageFile,
          },
        ],
        files: [imageFile],
      },
    });
    fireEvent(editor, pasteEvent);

    expect(screen.getByAltText('clipboard.png')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        prompt: '[PHOTO clipboard.png]',
        attachments: [
          expect.objectContaining({
            kind: 'photo',
            originalName: 'clipboard.png',
            placeholder: '[PHOTO clipboard.png]',
          }),
        ],
      });
    });
  });

  it('accepts dropped files into the chat prompt and highlights the drop target', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const droppedFile = new File(['drag'], 'drop.txt', { type: 'text/plain' });

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
    const dragEnterEvent = createEvent.dragEnter(editor, {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(dragEnterEvent, {
      dataTransfer: {
        items: [
          {
            kind: 'file',
            getAsFile: () => droppedFile,
          },
        ],
        files: [droppedFile],
      },
    });
    fireEvent(editor, dragEnterEvent);

    expect(editor.parentElement).toHaveClass('border-sky-300/80');

    const dropEvent = createEvent.drop(editor, {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(dropEvent, {
      dataTransfer: {
        items: [
          {
            kind: 'file',
            getAsFile: () => droppedFile,
          },
        ],
        files: [droppedFile],
      },
    });
    fireEvent(editor, dropEvent);

    expect(screen.getAllByText('drop.txt').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        prompt: '[FILE drop.txt]',
        attachments: [
          expect.objectContaining({
            kind: 'file',
            originalName: 'drop.txt',
            placeholder: '[FILE drop.txt]',
          }),
        ],
      });
    });
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
