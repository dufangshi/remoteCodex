import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'xterm/css/xterm.css';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from 'xterm';

import type {
  ShellEventEnvelope,
  ShellStatusDto,
  ThreadShellStateDto,
} from '../../../../packages/shared/src/index';
import {
  ApiError,
  connectShellSocket,
  createThreadShell,
  fetchThreadShellState,
  terminateShell,
} from '../lib/api';

interface ThreadShellPanelProps {
  threadId: string;
}

function statusToneClassName(status: ShellStatusDto) {
  switch (status) {
    case 'attached':
      return 'border-emerald-300/35 bg-emerald-300/12 text-emerald-100';
    case 'detached':
    case 'running':
      return 'border-sky-300/35 bg-sky-300/12 text-sky-100';
    case 'creating':
      return 'border-amber-300/35 bg-amber-300/12 text-amber-100';
    case 'workspace_missing':
    case 'not_found':
    case 'exited':
      return 'border-rose-300/35 bg-rose-300/12 text-rose-100';
    case 'not_created':
      return 'border-stone-700 bg-stone-900/80 text-stone-300';
  }
}

function statusLabel(status: ShellStatusDto) {
  switch (status) {
    case 'not_created':
      return 'Not created';
    case 'creating':
      return 'Creating';
    case 'running':
      return 'Running';
    case 'attached':
      return 'Attached';
    case 'detached':
      return 'Detached';
    case 'exited':
      return 'Exited';
    case 'not_found':
      return 'Missing';
    case 'workspace_missing':
      return 'Workspace missing';
  }
}

export function ThreadShellPanel({ threadId }: ThreadShellPanelProps) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ReturnType<typeof connectShellSocket> | null>(null);
  const viewerIdRef = useRef<string | null>(null);
  const shellIdRef = useRef<string | null>(null);
  const shellStateRef = useRef<ThreadShellStateDto | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [shellState, setShellState] = useState<ThreadShellStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);

  const loadShellState = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchThreadShellState(threadId);
      setShellState(response);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Unable to load shell state.',
      );
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void loadShellState();
  }, [loadShellState]);

  useEffect(() => {
    shellIdRef.current = shellState?.shell?.id ?? null;
  }, [shellState?.shell?.id]);

  useEffect(() => {
    shellStateRef.current = shellState;
  }, [shellState]);

  useEffect(() => {
    if (!terminalHostRef.current || terminalRef.current) {
      return;
    }

    let cancelled = false;
    let inputSubscription: { dispose: () => void } | null = null;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('@xterm/addon-fit'),
      ]);

      if (cancelled || !terminalHostRef.current) {
        return;
      }

      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: 'IBM Plex Mono, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.25,
        scrollback: 3000,
        theme: {
          background: '#0c1117',
          foreground: '#d6dde6',
          cursor: '#d6dde6',
          black: '#0f1720',
          brightBlack: '#475569',
          red: '#f87171',
          brightRed: '#fb7185',
          green: '#86efac',
          brightGreen: '#4ade80',
          yellow: '#fbbf24',
          brightYellow: '#fcd34d',
          blue: '#93c5fd',
          brightBlue: '#60a5fa',
          magenta: '#c4b5fd',
          brightMagenta: '#a78bfa',
          cyan: '#67e8f9',
          brightCyan: '#22d3ee',
          white: '#e2e8f0',
          brightWhite: '#f8fafc',
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalHostRef.current);
      fitAddon.fit();
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      resizeObserverRef.current = new ResizeObserver(() => {
        fitAddon.fit();
        if (socketRef.current && shellIdRef.current && viewerIdRef.current) {
          socketRef.current.send({
            type: 'shell.resize',
            shellId: shellIdRef.current,
            viewerId: viewerIdRef.current,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
      });
      resizeObserverRef.current.observe(terminalHostRef.current);

      inputSubscription = terminal.onData((data) => {
        if (!socketRef.current || !shellIdRef.current || !viewerIdRef.current) {
          return;
        }

        socketRef.current.send({
          type: 'shell.input',
          shellId: shellIdRef.current,
          viewerId: viewerIdRef.current,
          data,
        });
      });
    })();

    return () => {
      cancelled = true;
      inputSubscription?.dispose();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const currentShellState = shellStateRef.current;
    const shellId = currentShellState?.shell?.id;
    if (!shellId) {
      return;
    }

    const shellStatus = currentShellState?.state;
    if (
      shellStatus === 'not_created' ||
      shellStatus === 'workspace_missing' ||
      shellStatus === 'creating' ||
      shellStatus === 'not_found' ||
      shellStatus === 'exited'
    ) {
      return;
    }

    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.reset();
    setConnectionError(null);
    viewerIdRef.current = null;

    const shellSocket = connectShellSocket({
      onConnected: () => {
        shellSocket.send({
          type: 'shell.attach',
          shellId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      },
      onShellEvent: (event: ShellEventEnvelope) => {
        if (event.shellId !== shellId) {
          return;
        }

        if (event.type === 'shell.connected') {
          const viewerId = String(event.payload.viewerId ?? '');
          viewerIdRef.current = viewerId || null;
          setShellState((current) =>
            current
              ? {
                  ...current,
                  state: 'attached',
                  shell: current.shell
                    ? { ...current.shell, status: 'attached', attachedViewerId: viewerId }
                    : current.shell,
                }
              : current,
          );
          return;
        }

        if (event.type === 'shell.output') {
          const data = typeof event.payload.data === 'string' ? event.payload.data : '';
          const replace = event.payload.replace === true;
          if (data) {
            if (replace) {
              terminal.reset();
            }
            terminal.write(data);
          }
          return;
        }

        if (event.type === 'shell.error') {
          setConnectionError(String(event.payload.message ?? 'Shell connection failed.'));
          if (event.payload.code === 'viewer_conflict') {
            setShellState((current) =>
              current
                ? {
                    ...current,
                    state: 'detached',
                    shell: current.shell
                      ? { ...current.shell, status: 'detached', attachedViewerId: null }
                      : current.shell,
                  }
                : current,
            );
          }
          return;
        }

        if (event.type === 'shell.exited') {
          viewerIdRef.current = null;
          const nextState =
            event.payload.state === 'exited' ? 'exited' : 'not_found';
          setShellState((current) =>
            current
              ? {
                  ...current,
                  state: nextState,
                  shell: current.shell
                    ? {
                        ...current.shell,
                        status: nextState,
                        attachedViewerId: null,
                      }
                    : current.shell,
                }
              : current,
          );
          return;
        }

        const nextState = event.payload.state as ShellStatusDto | undefined;
        if (nextState) {
          if (nextState !== 'attached') {
            viewerIdRef.current = null;
          }
          setShellState((current) =>
            current
              ? {
                  ...current,
                  state: nextState,
                  shell: current.shell
                    ? {
                        ...current.shell,
                        status:
                          nextState === 'attached' || nextState === 'detached'
                            ? nextState
                            : current.shell.status,
                        attachedViewerId:
                          nextState === 'attached' ? current.shell.attachedViewerId : null,
                      }
                    : current.shell,
                }
              : current,
          );
        }
      },
    });

    socketRef.current = shellSocket;

    shellSocket.socket.addEventListener('close', () => {
      if (socketRef.current?.socket === shellSocket.socket) {
        socketRef.current = null;
      }
    });

    return () => {
      const viewerId = viewerIdRef.current;
      if (viewerId) {
        shellSocket.send({
          type: 'shell.detach',
          shellId,
          viewerId,
        });
      }
      viewerIdRef.current = null;
      shellSocket.socket.close();
      if (socketRef.current?.socket === shellSocket.socket) {
        socketRef.current = null;
      }
    };
  }, [reconnectKey, shellState?.shell?.id]);

  async function handleCreateShell() {
    setBusy(true);
    try {
      const terminal = terminalRef.current;
      const response = await createThreadShell(threadId, {
        ...(terminal?.cols !== undefined ? { cols: terminal.cols } : {}),
        ...(terminal?.rows !== undefined ? { rows: terminal.rows } : {}),
      });
      setShellState(response);
      setReconnectKey((current) => current + 1);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(
        error instanceof ApiError ? error.payload.message : 'Unable to create shell.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleTerminateShell() {
    if (!shellState?.shell) {
      return;
    }

    setBusy(true);
    try {
      await terminateShell(shellState.shell.id);
      await loadShellState();
      setConnectionError(null);
    } catch (error) {
      setConnectionError(
        error instanceof ApiError ? error.payload.message : 'Unable to terminate shell.',
      );
    } finally {
      setBusy(false);
    }
  }

  const status = shellState?.state ?? 'not_created';
  const shellMeta = useMemo(() => shellState?.shell ?? null, [shellState?.shell]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-stone-900/30">
      <div className="shrink-0 border-b border-stone-800/80 bg-stone-900/90 px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Shell</p>
            <p className="mt-1 truncate text-sm text-stone-300">
              {shellMeta?.cwd ?? 'Create a durable shell for this thread.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${statusToneClassName(status)}`}
            >
              {statusLabel(status)}
            </span>
            {!shellMeta && (
              <button
                type="button"
                disabled={busy || loading || status === 'workspace_missing'}
                onClick={() => void handleCreateShell()}
                className="rounded-full bg-emerald-300 px-3 py-2 text-sm font-medium text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
              >
                {busy ? 'Creating...' : 'Create Shell'}
              </button>
            )}
            {shellMeta && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReconnectKey((current) => current + 1)}
                  className="rounded-full border border-sky-300/35 bg-sky-300/12 px-3 py-2 text-sm text-sky-100 transition hover:bg-sky-300/18 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Reconnect
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleTerminateShell()}
                  className="rounded-full border border-rose-300/35 bg-rose-300/12 px-3 py-2 text-sm text-rose-100 transition hover:bg-rose-300/18 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Terminate
                </button>
              </>
            )}
          </div>
        </div>
        {(connectionError || loading || shellState?.workspacePathStatus === 'missing') && (
          <div className="mt-3 rounded-2xl border border-stone-800/80 bg-stone-950/55 px-3 py-3 text-sm">
            {loading && <p className="text-stone-400">Loading shell state...</p>}
            {!loading && shellState?.workspacePathStatus === 'missing' && (
              <p className="text-rose-100">
                Workspace path is missing on this machine. Restore the path before creating a shell.
              </p>
            )}
            {!loading && connectionError && (
              <p className="text-amber-100">{connectionError}</p>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {status === 'not_created' || status === 'workspace_missing' ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="max-w-md rounded-[1.6rem] border border-stone-800 bg-stone-950/55 px-6 py-8">
              <p className="text-base font-medium text-stone-100">Durable thread shell</p>
              <p className="mt-3 text-sm leading-6 text-stone-400">
                The shell runs under supervisor-managed tmux and survives browser disconnects.
                Create it explicitly when you want to inspect or take over the workspace.
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full min-h-0 p-2 sm:p-3">
            <div className="h-full rounded-[1.4rem] border border-stone-800 bg-[#0c1117] shadow-inner shadow-black/25">
              <div ref={terminalHostRef} className="h-full w-full px-2 py-2 sm:px-3 sm:py-3" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
