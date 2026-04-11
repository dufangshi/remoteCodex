import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  showHeader?: boolean;
  showFloatingToolbox?: boolean;
  onStateChange?: (state: ThreadShellControlState) => void;
}

type ToolboxFeedbackState = 'idle' | 'done' | 'failed';

export interface ThreadShellControlState {
  status: ShellStatusDto;
  connectionButtonDisabled: boolean;
  connectionButtonLabel: string;
  shellInputEnabled: boolean;
  isCommandRunning: boolean;
  promptLabel: string | null;
  isMobileShell: boolean;
  hasShell: boolean;
  busy: boolean;
  loading: boolean;
  error: string | null;
}

export interface ThreadShellPanelHandle {
  toggleConnection: () => Promise<void>;
  sendInput: (data: string) => boolean;
  sendCommand: (command: string) => boolean;
  sendControl: (
    action: 'ctrl_c' | 'ctrl_d' | 'esc' | 'tab' | 'up' | 'down',
  ) => boolean;
  pasteFromClipboard: () => Promise<boolean>;
  copySelection: () => Promise<boolean>;
  terminate: () => Promise<void>;
  focus: () => void;
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

function renderShellSnapshot(
  terminal: Terminal,
  snapshot: string,
  cursorX?: number,
  cursorY?: number,
  paneHeight?: number,
) {
  const lines = snapshot.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let frame = '\x1b[?7l\x1b[2J\x1b[H';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    frame += `\x1b[${index + 1};1H${line}`;
  }

  frame += '\x1b[?7h';
  if (cursorX !== undefined && cursorY !== undefined) {
    const historyOffset =
      paneHeight !== undefined ? Math.max(0, lines.length - paneHeight) : 0;
    frame += `\x1b[${historyOffset + cursorY + 1};${cursorX + 1}H`;
  }

  terminal.write(frame);
}

function controlSequenceForLetter(key: string) {
  if (!/^[a-z]$/i.test(key)) {
    return null;
  }

  return String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
}

function getVisibleTerminalText(hostNode: HTMLDivElement | null) {
  if (!hostNode) {
    return '';
  }

  const rows = Array.from(hostNode.querySelectorAll('.xterm-rows > div'))
    .map((row) => row.textContent ?? '')
    .filter((line, index, items) => line.length > 0 || index < items.length - 1);

  return rows.join('\n').trimEnd();
}

function basenameFromPath(filePath: string | null | undefined) {
  if (!filePath) {
    return '';
  }

  const normalized = filePath.replace(/[\\/]+$/, '');
  if (!normalized) {
    return '';
  }

  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function buildPromptLabel(
  cwdBaseName: string | null | undefined,
  envPrefix: string | null | undefined,
) {
  const parts = [envPrefix?.trim(), cwdBaseName?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

function WrenchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 fill-none stroke-current"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.6 2.1a3.4 3.4 0 0 0 4.3 4.3l-6.4 6.4a1.8 1.8 0 1 1-2.6-2.6l6.4-6.4a3.4 3.4 0 0 0-1.7-1.7Z" />
      <path d="m10.8 3.3 1.9 1.9" />
    </svg>
  );
}

function ConnectionIcon({ connected }: { connected: boolean }) {
  if (!connected) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4.5 w-4.5 fill-none stroke-current"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13.181 8.68a4.503 4.503 0 0 1 1.903 6.405m-9.768-2.782L3.56 14.06a4.5 4.5 0 0 0 6.364 6.365l3.129-3.129m5.614-5.615 1.757-1.757a4.5 4.5 0 0 0-6.364-6.365l-4.5 4.5c-.258.26-.479.541-.661.84m1.903 6.405a4.495 4.495 0 0 1-1.242-.88 4.483 4.483 0 0 1-1.062-1.683m6.587 2.345 5.907 5.907m-5.907-5.907L8.898 8.898M2.991 2.99 8.898 8.9" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4.5 w-4.5 fill-none stroke-current"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 3.25h5" />
      <path d="M6.4 2h3.2a.9.9 0 0 1 .9.9v.35h1.3a1.2 1.2 0 0 1 1.2 1.2v7.35a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 11.8V4.45a1.2 1.2 0 0 1 1.2-1.2h1.3V2.9a.9.9 0 0 1 .9-.9Z" />
    </svg>
  );
}

function ControlIcon({
  label,
  tone = 'stone',
}: {
  label: string;
  tone?: 'stone' | 'rose' | 'sky';
}) {
  const toneClassName =
    tone === 'rose'
      ? 'border-rose-300/35 bg-rose-300/14 text-rose-50'
      : tone === 'sky'
        ? 'border-sky-300/35 bg-sky-300/14 text-sky-50'
        : 'border-stone-700/90 bg-stone-900/80 text-stone-100';

  return (
    <span
      className={`inline-flex min-w-[3.45rem] items-center justify-center rounded-full border px-2.5 py-1.5 text-[11px] font-medium tracking-[0.12em] ${toneClassName}`}
    >
      {label}
    </span>
  );
}

function shellControlSequence(
  action: 'ctrl_c' | 'ctrl_d' | 'esc' | 'tab' | 'up' | 'down',
) {
  switch (action) {
    case 'ctrl_c':
      return '\u0003';
    case 'ctrl_d':
      return '\u0004';
    case 'esc':
      return '\u001b';
    case 'tab':
      return '\t';
    case 'up':
      return '\u001b[A';
    case 'down':
      return '\u001b[B';
  }
}

export const ThreadShellPanel = forwardRef<
  ThreadShellPanelHandle,
  ThreadShellPanelProps
>(function ThreadShellPanel(
  {
    threadId,
    showHeader = true,
    showFloatingToolbox = true,
    onStateChange,
  }: ThreadShellPanelProps,
  ref,
) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ReturnType<typeof connectShellSocket> | null>(null);
  const viewerIdRef = useRef<string | null>(null);
  const shellIdRef = useRef<string | null>(null);
  const shellStateRef = useRef<ThreadShellStateDto | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const [terminalHostNode, setTerminalHostNode] = useState<HTMLDivElement | null>(null);
  const [shellState, setShellState] = useState<ThreadShellStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [terminalReady, setTerminalReady] = useState(false);
  const [isMobileShell, setIsMobileShell] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [runtimePromptLabel, setRuntimePromptLabel] = useState<string | null>(null);
  const [isCommandRunning, setIsCommandRunning] = useState(false);
  const [toolboxFeedback, setToolboxFeedback] = useState<{
    tone: ToolboxFeedbackState;
    text: string;
  } | null>(null);

  const setTransientToolboxFeedback = useCallback(
    (tone: ToolboxFeedbackState, text: string) => {
      setToolboxFeedback({ tone, text });
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      feedbackTimerRef.current = window.setTimeout(() => {
        setToolboxFeedback(null);
        feedbackTimerRef.current = null;
      }, 1800);
    },
    [],
  );

  const sendShellInput = useCallback((data: string) => {
    const socket = socketRef.current;
    const shellId = shellIdRef.current;
    const viewerId = viewerIdRef.current;
    if (!socket || !shellId || !viewerId) {
      return false;
    }

    socket.send({
      type: 'shell.input',
      shellId,
      viewerId,
      data,
    });
    terminalRef.current?.focus();
    return true;
  }, []);

  const status = shellState?.state ?? 'not_created';
  const shellMeta = useMemo(() => shellState?.shell ?? null, [shellState?.shell]);
  const shellInputEnabled = Boolean(viewerIdRef.current && shellMeta);
  const fallbackPromptLabel = useMemo(
    () => buildPromptLabel(basenameFromPath(shellMeta?.cwd), null),
    [shellMeta?.cwd],
  );
  const promptLabel = runtimePromptLabel ?? fallbackPromptLabel;
  const connectionButtonDisabled =
    busy || loading || status === 'creating' || status === 'workspace_missing';
  const connectionButtonClassName =
    status === 'attached'
      ? 'border-emerald-300/45 bg-emerald-300/18 text-emerald-50 ring-1 ring-emerald-300/20 hover:bg-emerald-300/24'
      : status === 'exited' || status === 'not_found'
        ? 'border-stone-600 bg-stone-800/90 text-stone-100 hover:border-stone-500 hover:bg-stone-800'
        : status === 'workspace_missing'
          ? 'border-rose-300/35 bg-rose-300/12 text-rose-100'
          : 'border-stone-600 bg-stone-800/90 text-stone-100 hover:border-stone-500 hover:bg-stone-800';
  const connectionButtonLabel =
    status === 'attached'
      ? 'Disconnect shell'
      : status === 'exited' || status === 'not_found'
        ? 'Restart shell'
        : shellMeta
          ? 'Connect shell'
          : 'Create shell';
  const toolboxFeedbackToneClassName =
    toolboxFeedback?.tone === 'done'
      ? 'border-emerald-300/35 bg-emerald-300/12 text-emerald-50'
      : toolboxFeedback?.tone === 'failed'
        ? 'border-rose-300/35 bg-rose-300/12 text-rose-50'
        : 'border-stone-700/90 bg-stone-900/90 text-stone-200';

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
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)');
    const update = () => {
      setIsMobileShell(mediaQuery.matches);
      if (!mediaQuery.matches) {
        setToolboxOpen(false);
      }
    };

    update();
    mediaQuery.addEventListener('change', update);
    return () => {
      mediaQuery.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!terminalHostNode || terminalRef.current) {
      return;
    }

    let cancelled = false;
    let inputSubscription: { dispose: () => void } | null = null;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('@xterm/addon-fit'),
      ]);

      if (cancelled || !terminalHostNode) {
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
      terminal.open(terminalHostNode);
      fitAddon.fit();
      terminal.attachCustomKeyEventHandler((event) => {
        if (isMobileShell || event.type !== 'keydown') {
          return true;
        }

        if (
          event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          const sequence = controlSequenceForLetter(event.key);
          if (!sequence) {
            return true;
          }

          if (sendShellInput(sequence)) {
            event.preventDefault();
            return false;
          }

          return true;
        }

        return true;
      });
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      setTerminalReady(true);

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
      resizeObserverRef.current.observe(terminalHostNode);

      inputSubscription = terminal.onData((data) => {
        sendShellInput(data);
      });
    })();

    return () => {
      cancelled = true;
      inputSubscription?.dispose();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      setTerminalReady(false);
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [isMobileShell, sendShellInput, terminalHostNode]);

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
    if (!terminal || !terminalReady) {
      return;
    }

    terminal.reset();
    setConnectionError(null);
    viewerIdRef.current = null;
    terminal.focus();

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
          const cursorX =
            typeof event.payload.cursorX === 'number' ? event.payload.cursorX : undefined;
          const cursorY =
            typeof event.payload.cursorY === 'number' ? event.payload.cursorY : undefined;
          const paneHeight =
            typeof event.payload.paneHeight === 'number'
              ? event.payload.paneHeight
              : undefined;
          const cwdBaseName =
            typeof event.payload.cwdBaseName === 'string'
              ? event.payload.cwdBaseName
              : null;
          const envPrefix =
            typeof event.payload.envPrefix === 'string'
              ? event.payload.envPrefix
              : null;
          const nextPromptLabel = buildPromptLabel(
            cwdBaseName ?? basenameFromPath(shellMeta?.cwd),
            envPrefix,
          );
          setRuntimePromptLabel(nextPromptLabel);
          setIsCommandRunning(event.payload.isCommandRunning === true);
          if (data) {
            if (replace) {
              renderShellSnapshot(terminal, data, cursorX, cursorY, paneHeight);
            } else {
              terminal.write(data);
            }
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

        if (event.type === 'shell.detached') {
          const detachedViewerId = String(event.payload.viewerId ?? '');
          const detachedReason = String(event.payload.reason ?? '');
          if (detachedViewerId && detachedViewerId === viewerIdRef.current) {
            viewerIdRef.current = null;
            setShellState((current) =>
              current
                ? {
                    ...current,
                    state: 'detached',
                    shell: current.shell
                      ? {
                          ...current.shell,
                          status: 'detached',
                          attachedViewerId: null,
                        }
                      : current.shell,
                  }
                : current,
            );
            if (detachedReason === 'replaced') {
              setConnectionError('This shell connection was taken over by another device.');
            } else {
              setConnectionError(null);
            }
            setIsCommandRunning(false);
            shellSocket.socket.close();
          }
          return;
        }

        if (event.type === 'shell.exited') {
          viewerIdRef.current = null;
          setIsCommandRunning(false);
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
            setIsCommandRunning(false);
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
  }, [reconnectKey, shellMeta?.cwd, shellState?.shell?.id, terminalReady]);

  const handleCreateShell = useCallback(async () => {
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
  }, [threadId]);

  const handleReconnectShell = useCallback(async () => {
    if (status === 'exited' || status === 'not_found') {
      await handleCreateShell();
      return;
    }

    setConnectionError(null);
    setReconnectKey((current) => current + 1);
  }, [handleCreateShell, status]);

  const handleTerminateShell = useCallback(async () => {
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
  }, [loadShellState, shellState?.shell]);

  const handleDisconnectShell = useCallback(() => {
    const socket = socketRef.current;
    const shellId = shellIdRef.current;
    const viewerId = viewerIdRef.current;

    if (!socket || !shellId) {
      return;
    }

    if (viewerId) {
      socket.send({
        type: 'shell.detach',
        shellId,
        viewerId,
      });
    }

    viewerIdRef.current = null;
    socket.socket.close();
    if (socketRef.current?.socket === socket.socket) {
      socketRef.current = null;
    }

    setConnectionError(null);
    setShellState((current) =>
      current
        ? {
            ...current,
            state: 'detached',
            shell: current.shell
              ? {
                  ...current.shell,
                  status: 'detached',
                  attachedViewerId: null,
                }
              : current.shell,
          }
        : current,
    );
  }, []);

  const handleConnectionToggle = useCallback(async () => {
    if (busy || loading || status === 'creating' || status === 'workspace_missing') {
      return;
    }

    if (status === 'attached') {
      handleDisconnectShell();
      return;
    }

    if (status === 'exited' || status === 'not_found' || !shellMeta) {
      await handleCreateShell();
      return;
    }

    await handleReconnectShell();
  }, [
    busy,
    handleCreateShell,
    handleDisconnectShell,
    handleReconnectShell,
    loading,
    shellMeta,
    status,
  ]);

  const handlePasteFromClipboard = useCallback(async () => {
    if (!navigator.clipboard?.readText) {
      setTransientToolboxFeedback('failed', 'Paste is unavailable here');
      return false;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText) {
        setTransientToolboxFeedback('failed', 'Clipboard is empty');
        return false;
      }

      if (!sendShellInput(clipboardText)) {
        setTransientToolboxFeedback('failed', 'Connect the shell first');
        return false;
      }

      setTransientToolboxFeedback('done', 'Pasted');
      return true;
    } catch {
      setTransientToolboxFeedback('failed', 'Paste was blocked');
      return false;
    }
  }, [sendShellInput, setTransientToolboxFeedback]);

  const handleCopySelection = useCallback(async () => {
    try {
      const selectedText =
        terminalRef.current?.getSelection()?.trim() ||
        window.getSelection?.()?.toString().trim() ||
        getVisibleTerminalText(terminalHostNode);

      if (!selectedText) {
        setTransientToolboxFeedback('failed', 'Nothing to copy');
        return false;
      }

      await navigator.clipboard.writeText(selectedText);
      setTransientToolboxFeedback('done', 'Copied');
      return true;
    } catch {
      setTransientToolboxFeedback('failed', 'Copy failed');
      return false;
    }
  }, [terminalHostNode, setTransientToolboxFeedback]);

  useEffect(() => {
    if (!shellMeta?.cwd) {
      setRuntimePromptLabel(null);
      return;
    }

    setRuntimePromptLabel((current) => current ?? buildPromptLabel(basenameFromPath(shellMeta.cwd), null));
  }, [shellMeta?.cwd]);

  useEffect(() => {
    onStateChange?.({
      status,
      connectionButtonDisabled,
      connectionButtonLabel,
      shellInputEnabled,
      isCommandRunning,
      promptLabel,
      isMobileShell,
      hasShell: Boolean(shellMeta),
      busy,
      loading,
      error: connectionError,
    });
  }, [
    busy,
    connectionButtonDisabled,
    connectionButtonLabel,
    connectionError,
    isMobileShell,
    isCommandRunning,
    loading,
    onStateChange,
    promptLabel,
    shellMeta,
    shellInputEnabled,
    status,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      async toggleConnection() {
        await handleConnectionToggle();
      },
      sendInput(data: string) {
        return sendShellInput(data);
      },
      sendCommand(command: string) {
        const normalized = command.endsWith('\n') ? command : `${command}\n`;
        return sendShellInput(normalized);
      },
      sendControl(action) {
        return sendShellInput(shellControlSequence(action));
      },
      async pasteFromClipboard() {
        return await handlePasteFromClipboard();
      },
      async copySelection() {
        return await handleCopySelection();
      },
      async terminate() {
        await handleTerminateShell();
      },
      focus() {
        terminalRef.current?.focus();
      },
    }),
    [
      handleConnectionToggle,
      handleCopySelection,
      handlePasteFromClipboard,
      handleTerminateShell,
      sendShellInput,
    ],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-stone-900/30">
      {showHeader && (
        <div className="shrink-0 border-b border-stone-800/80 bg-stone-900/90 px-3 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Shell</p>
              <p className="mt-1 truncate text-sm text-stone-300">
                {promptLabel ?? shellMeta?.cwd ?? 'Create a durable shell for this thread.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={connectionButtonLabel}
                title={`${connectionButtonLabel} (${statusLabel(status)})`}
                disabled={connectionButtonDisabled}
                onClick={() => void handleConnectionToggle()}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-lg shadow-stone-950/25 transition disabled:cursor-not-allowed disabled:opacity-60 ${connectionButtonClassName}`}
              >
                <ConnectionIcon connected={status === 'attached'} />
              </button>
              {shellMeta && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleTerminateShell()}
                  className="rounded-full border border-rose-300/35 bg-rose-300/12 px-3 py-2 text-sm text-rose-100 transition hover:bg-rose-300/18 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Terminate
                </button>
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
      )}

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
            <div className="relative h-full rounded-[1.4rem] border border-stone-800 bg-[#0c1117] shadow-inner shadow-black/25">
              {!showHeader &&
                (connectionError ||
                  loading ||
                  shellState?.workspacePathStatus === 'missing') && (
                  <div className="absolute left-2 right-2 top-2 z-10 rounded-2xl border border-stone-800/80 bg-stone-950/88 px-3 py-3 text-sm backdrop-blur sm:left-3 sm:right-3 sm:top-3">
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
              <div
                ref={setTerminalHostNode}
                className={`h-full w-full px-2 py-2 sm:px-3 sm:py-3 ${isMobileShell ? 'mobile-shell-selectable' : ''}`}
                onMouseDown={() => {
                  terminalRef.current?.focus();
                }}
              />
              {showFloatingToolbox && isMobileShell && (
                <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
                  {toolboxFeedback && (
                    <div
                      className={`pointer-events-auto rounded-full border px-3 py-1.5 text-[11px] shadow-lg shadow-stone-950/30 backdrop-blur ${toolboxFeedbackToneClassName}`}
                    >
                      {toolboxFeedback.text}
                    </div>
                  )}
                  {toolboxOpen && (
                    <div className="pointer-events-auto rounded-[1.2rem] border border-stone-700/90 bg-stone-950/92 p-2 shadow-2xl shadow-black/35 backdrop-blur">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void handlePasteFromClipboard()}
                          className="inline-flex items-center justify-center rounded-full border border-sky-300/35 bg-sky-300/12 px-2.5 py-2 text-sky-50"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <ClipboardIcon />
                            <span className="text-[11px] font-medium tracking-[0.12em]">
                              Paste
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopySelection()}
                          className="inline-flex items-center justify-center rounded-full border border-stone-700/90 bg-stone-900/80 px-2.5 py-2 text-stone-100"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <ClipboardIcon />
                            <span className="text-[11px] font-medium tracking-[0.12em]">
                              Copy
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={!shellInputEnabled || !isCommandRunning}
                          onClick={() => {
                            if (sendShellInput('\u0003')) {
                              setTransientToolboxFeedback('done', 'Sent Ctrl-C');
                            } else {
                              setTransientToolboxFeedback('failed', 'Connect the shell first');
                            }
                          }}
                          className="disabled:opacity-45"
                        >
                          <ControlIcon label="CTRL-C" tone="rose" />
                        </button>
                        <button
                          type="button"
                          disabled={!shellInputEnabled}
                          onClick={() => {
                            if (sendShellInput('\u0004')) {
                              setTransientToolboxFeedback('done', 'Sent Ctrl-D');
                            } else {
                              setTransientToolboxFeedback('failed', 'Connect the shell first');
                            }
                          }}
                          className="disabled:opacity-45"
                        >
                          <ControlIcon label="CTRL-D" tone="stone" />
                        </button>
                        <button
                          type="button"
                          disabled={!shellInputEnabled}
                          onClick={() => {
                            if (sendShellInput('\u001b')) {
                              setTransientToolboxFeedback('done', 'Sent Esc');
                            } else {
                              setTransientToolboxFeedback('failed', 'Connect the shell first');
                            }
                          }}
                          className="disabled:opacity-45"
                        >
                          <ControlIcon label="ESC" tone="stone" />
                        </button>
                        <button
                          type="button"
                          disabled={!shellInputEnabled}
                          onClick={() => {
                            if (sendShellInput('\t')) {
                              setTransientToolboxFeedback('done', 'Sent Tab');
                            } else {
                              setTransientToolboxFeedback('failed', 'Connect the shell first');
                            }
                          }}
                          className="disabled:opacity-45"
                        >
                          <ControlIcon label="TAB" tone="stone" />
                        </button>
                        <button
                          type="button"
                          disabled={!shellInputEnabled}
                          onClick={() => {
                            if (sendShellInput('\u001b[A')) {
                              setTransientToolboxFeedback('done', 'Sent Up');
                            } else {
                              setTransientToolboxFeedback('failed', 'Connect the shell first');
                            }
                          }}
                          className="disabled:opacity-45"
                        >
                          <ControlIcon label="UP" tone="stone" />
                        </button>
                        <button
                          type="button"
                          disabled={!shellInputEnabled}
                          onClick={() => {
                            if (sendShellInput('\u001b[B')) {
                              setTransientToolboxFeedback('done', 'Sent Down');
                            } else {
                              setTransientToolboxFeedback('failed', 'Connect the shell first');
                            }
                          }}
                          className="disabled:opacity-45"
                        >
                          <ControlIcon label="DOWN" tone="stone" />
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-expanded={toolboxOpen}
                    aria-label={toolboxOpen ? 'Close shell tools' : 'Open shell tools'}
                    onClick={() => setToolboxOpen((current) => !current)}
                    className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-700/90 bg-stone-950/90 text-stone-100 shadow-2xl shadow-black/35 backdrop-blur transition hover:bg-stone-900"
                  >
                    <WrenchIcon />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
