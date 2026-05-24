import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreadShellPanel } from './ThreadShellPanel';
import type { ShellSessionDto, ThreadShellStateDto } from '../../../../packages/shared/src/index';

vi.mock('xterm', () => ({
  Terminal: class MockTerminal {
    cols = 120;
    rows = 36;
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
    }

    loadAddon() {}
    open() {}
    reset() {}
    write(_data: string, callback?: () => void) {
      callback?.();
    }
    scrollToBottom() {}
    focus() {}
    dispose() {}
    clear() {}
    getSelection() {
      return '';
    }
    onData() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    fit() {}
  },
}));

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  listeners = new Map<string, Array<(event: Event | MessageEvent) => void>>();
  sentMessages: string[] = [];
  readyState: number = WebSocket.OPEN;

  constructor(url: string) {
    void url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.emit('message', {
        data: JSON.stringify({ type: 'supervisor.connected', clientId: 'client-1' }),
      } as MessageEvent);
    });
  }

  addEventListener(type: string, listener: (event: Event | MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(message: string) {
    this.sentMessages.push(message);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', new Event('close'));
  }

  emit(type: string, event: Event | MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const threadId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';

function shell(overrides: Partial<ShellSessionDto> & Pick<ShellSessionDto, 'id'>): ShellSessionDto {
  const { id, label, ...rest } = overrides;
  return {
    id,
    threadId,
    workspaceId,
    tmuxSessionName: `rcx-${id}`,
    backend: 'pty',
    cwd: '/workspace/project',
    status: 'running',
    attachedViewerId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: null,
    ...rest,
    label: label ?? null,
  };
}

function shellState(shells: ShellSessionDto[], activeShellId = shells[0]?.id ?? null): ThreadShellStateDto {
  return {
    threadId,
    workspaceId,
    workspacePathStatus: 'present',
    state: shells.length > 0 ? 'running' : 'not_created',
    shell: shells.find((entry) => entry.id === activeShellId) ?? shells[0] ?? null,
    shells,
    activeShellId,
  };
}

describe('ThreadShellPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal('WebSocket', MockWebSocket);
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates new shells from the process list action', async () => {
    const firstShell = shell({ id: 'shell-1' });
    const secondShell = shell({ id: 'shell-2' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/threads/${threadId}/shell` && init?.method === 'POST') {
        return Response.json(shellState([firstShell, secondShell], secondShell.id));
      }
      return Response.json(shellState([firstShell], firstShell.id));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ThreadShellPanel threadId={threadId} />);

    await screen.findByTitle('rcx-shell-1');

    fireEvent.click(screen.getAllByRole('button', { name: 'New shell' })[0]!);

    await waitFor(() => {
      expect(screen.getByTitle('rcx-shell-2')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/threads/${threadId}/shell`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows live shell processes and can kill a specific process from the list', async () => {
    const firstShell = shell({ id: 'shell-1' });
    const secondShell = shell({ id: 'shell-2' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/shells/shell-2/terminate' && init?.method === 'POST') {
        return Response.json({ ...secondShell, status: 'exited' });
      }
      return Response.json(shellState([firstShell, secondShell], firstShell.id));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ThreadShellPanel threadId={threadId} />);

    await waitFor(() => {
      expect(screen.getByText('2 live')).toBeInTheDocument();
    });

    const secondProcess = screen.getAllByTitle('rcx-shell-2')[0]?.closest('div');
    expect(secondProcess).not.toBeNull();
    fireEvent.click(
      Array.from(secondProcess!.querySelectorAll('button')).find(
        (button) => button.textContent === 'Kill',
      )!,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/shells/shell-2/terminate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('renames shells and only shows live shells in the process list', async () => {
    const firstShell = shell({ id: 'shell-1' });
    const secondShell = shell({ id: 'shell-2' });
    const exitedShell = shell({ id: 'shell-3', status: 'exited' });
    const renamedSecondShell = shell({ id: 'shell-2', label: 'server' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/shells/shell-2' && init?.method === 'PATCH') {
        return Response.json(renamedSecondShell);
      }
      return Response.json(shellState([firstShell, secondShell, exitedShell], firstShell.id));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ThreadShellPanel threadId={threadId} />);

    await waitFor(() => {
      expect(screen.getByText('2 live')).toBeInTheDocument();
    });

    expect(screen.getByTitle('rcx-shell-1')).toBeInTheDocument();
    expect(screen.getByTitle('rcx-shell-2')).toBeInTheDocument();
    expect(screen.queryByTitle('rcx-shell-3')).not.toBeInTheDocument();

    const secondProcess = screen.getAllByTitle('rcx-shell-2')[0]?.closest('div');
    expect(secondProcess).not.toBeNull();
    fireEvent.click(
      Array.from(secondProcess!.querySelectorAll('button')).find(
        (button) => button.textContent === 'Rename',
      )!,
    );
    fireEvent.change(screen.getByLabelText('Shell name'), {
      target: { value: 'server' },
    });
    fireEvent.click(screen.getByTitle('Save shell name'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/shells/shell-2',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ label: 'server' }),
        }),
      );
    });
    expect(await screen.findByTitle('rcx-shell-2')).toHaveTextContent('server');

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/shells/shell-2/terminate',
      expect.anything(),
    );
  });

  it('does not attach the same shell to two panes after switching processes', async () => {
    const firstShell = shell({ id: 'shell-1' });
    const secondShell = shell({ id: 'shell-2' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(shellState([firstShell, secondShell], firstShell.id))),
    );

    render(<ThreadShellPanel threadId={threadId} />);

    await screen.findByTitle('rcx-shell-1');
    fireEvent.click(screen.getByTitle('rcx-shell-2'));

    await waitFor(() => {
      expect(document.querySelectorAll('[data-pane-id]')).toHaveLength(1);
    });
    expect(document.querySelector('[data-pane-id="secondary"]')).not.toBeInTheDocument();
  });

  it('keeps the current shell connected when the previous socket closes late', async () => {
    const firstShell = shell({ id: 'shell-1' });
    const secondShell = shell({ id: 'shell-2' });
    const getBoundingClientRect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 960,
        height: 540,
        top: 0,
        left: 0,
        right: 960,
        bottom: 540,
        toJSON: () => ({}),
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(shellState([firstShell, secondShell], firstShell.id))),
    );

    render(<ThreadShellPanel threadId={threadId} />);

    await waitFor(() => {
      expect(MockWebSocket.instances[0]?.sentMessages).toContain(
        JSON.stringify({
          type: 'shell.attach',
          shellId: firstShell.id,
          cols: 120,
          rows: 36,
        }),
      );
    });
    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.emit('message', {
      data: JSON.stringify({
        type: 'shell.connected',
        shellId: firstShell.id,
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: { viewerId: 'viewer-1' },
      }),
    } as MessageEvent);

    fireEvent.click(screen.getByTitle('rcx-shell-2'));

    await waitFor(() => {
      expect(MockWebSocket.instances[1]?.sentMessages).toContain(
        JSON.stringify({
          type: 'shell.attach',
          shellId: secondShell.id,
          cols: 120,
          rows: 36,
        }),
      );
    });
    const secondSocket = MockWebSocket.instances[1]!;
    secondSocket.emit('message', {
      data: JSON.stringify({
        type: 'shell.connected',
        shellId: secondShell.id,
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: { viewerId: 'viewer-2' },
      }),
    } as MessageEvent);

    await screen.findByRole('button', { name: 'Disconnect shell' });
    firstSocket.emit('close', new Event('close'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Disconnect shell' })).toBeInTheDocument();
    });
    getBoundingClientRect.mockRestore();
  });

  it('creates the first shell automatically when the shell view opens empty', async () => {
    const firstShell = shell({ id: 'shell-1' });
    const getBoundingClientRect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 960,
        height: 540,
        top: 0,
        left: 0,
        right: 960,
        bottom: 540,
        toJSON: () => ({}),
      });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/threads/${threadId}/shell` && init?.method === 'POST') {
        return Response.json(shellState([firstShell], firstShell.id));
      }
      return Response.json(shellState([], null));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ThreadShellPanel threadId={threadId} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/threads/${threadId}/shell`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByTitle('rcx-shell-1')).toBeInTheDocument();
    await waitFor(() => {
      expect(MockWebSocket.instances[0]?.sentMessages).toContain(
        JSON.stringify({
          type: 'shell.attach',
          shellId: firstShell.id,
          cols: 120,
          rows: 36,
        }),
      );
    });
    getBoundingClientRect.mockRestore();
  });

  it('does not send backend resize messages just from hiding and showing the panel', async () => {
    const firstShell = shell({ id: 'shell-1' });
    const getBoundingClientRect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 960,
        height: 540,
        top: 0,
        left: 0,
        right: 960,
        bottom: 540,
        toJSON: () => ({}),
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(shellState([firstShell], firstShell.id))),
    );

    const { rerender } = render(
      <ThreadShellPanel threadId={threadId} isVisible />,
    );

    await waitFor(() => {
      expect(MockWebSocket.instances[0]?.sentMessages).toContain(
        JSON.stringify({
          type: 'shell.attach',
          shellId: firstShell.id,
          cols: 120,
          rows: 36,
        }),
      );
    });

    const socket = MockWebSocket.instances[0]!;
    socket.emit('message', {
      data: JSON.stringify({
        type: 'shell.connected',
        shellId: firstShell.id,
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: { viewerId: 'viewer-1' },
      }),
    } as MessageEvent);
    const sentBeforeToggle = socket.sentMessages.length;

    rerender(<ThreadShellPanel threadId={threadId} isVisible={false} />);
    rerender(<ThreadShellPanel threadId={threadId} isVisible />);

    await new Promise((resolve) =>
      window.requestAnimationFrame(() => resolve(undefined)),
    );

    expect(
      socket.sentMessages
        .slice(sentBeforeToggle)
        .map((message) => JSON.parse(message) as { type: string }),
    ).not.toContainEqual(expect.objectContaining({ type: 'shell.resize' }));
    getBoundingClientRect.mockRestore();
  });

  it('exposes live shell processes on mobile and can kill from that list', async () => {
    const firstShell = shell({ id: 'shell-1' });
    const secondShell = shell({ id: 'shell-2' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/shells/shell-2/terminate' && init?.method === 'POST') {
        return Response.json({ ...secondShell, status: 'exited' });
      }
      return Response.json(shellState([firstShell, secondShell], firstShell.id));
    });
    vi.stubGlobal('fetch', fetchMock);
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(max-width: 767px), (hover: none) and (pointer: coarse)',
      addEventListener,
      removeEventListener,
    })));

    render(<ThreadShellPanel threadId={threadId} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show shell processes' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show shell processes' }));

    const secondProcess = screen.getAllByTitle('rcx-shell-2')[0]?.closest('div');
    expect(secondProcess).not.toBeNull();
    fireEvent.click(
      Array.from(secondProcess!.querySelectorAll('button')).find(
        (button) => button.textContent === 'Kill',
      )!,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/shells/shell-2/terminate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
