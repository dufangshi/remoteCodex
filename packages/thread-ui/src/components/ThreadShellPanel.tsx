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
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Terminal } from 'xterm';

import type {
  ShellEventEnvelope,
  ShellSessionDto,
  ShellStatusDto,
  ThreadShellStateDto,
} from '@remote-codex/shared';
import type {
  ShellSocketConnection,
  ThreadShellAdapter,
} from '../adapters';

interface ThreadShellPanelProps {
  threadId: string;
  shellAdapter: ThreadShellAdapter;
  isVisible?: boolean;
  showHeader?: boolean;
  showFloatingToolbox?: boolean;
  effectiveTheme?: 'light' | 'dark';
  loadSplitRatio?: (threadId: string) => number | null | undefined;
  saveSplitRatio?: (threadId: string, ratio: number) => void;
  onStateChange?: (state: ThreadShellControlState) => void;
}

type ToolboxFeedbackState = 'idle' | 'done' | 'failed';

export interface ThreadShellControlState {
  status: ShellStatusDto;
  connectionButtonDisabled: boolean;
  connectionButtonLabel: string;
  shellInputEnabled: boolean;
  isConnecting: boolean;
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
    action: 'ctrl_c' | 'ctrl_d' | 'esc' | 'tab' | 'up' | 'down' | 'clear',
  ) => boolean;
  copyLastCommandOutput: () => Promise<boolean>;
  terminate: () => Promise<void>;
  focus: () => void;
  refreshLayout: (options?: { focus?: boolean; syncBackendSize?: boolean }) => void;
}

function terminalThemeFor(effectiveTheme: 'light' | 'dark') {
  return {
    background: effectiveTheme === 'light' ? '#f2ede5' : '#0c1117',
    foreground: effectiveTheme === 'light' ? '#3f3a36' : '#d6dde6',
    cursor: effectiveTheme === 'light' ? '#3f3a36' : '#d6dde6',
    black: effectiveTheme === 'light' ? '#d8cfc2' : '#0f1720',
    brightBlack: effectiveTheme === 'light' ? '#8a7f73' : '#475569',
    red: '#f87171',
    brightRed: '#fb7185',
    green: effectiveTheme === 'light' ? '#16a34a' : '#86efac',
    brightGreen: effectiveTheme === 'light' ? '#22c55e' : '#4ade80',
    yellow: '#fbbf24',
    brightYellow: '#fcd34d',
    blue: effectiveTheme === 'light' ? '#2563eb' : '#93c5fd',
    brightBlue: effectiveTheme === 'light' ? '#3b82f6' : '#60a5fa',
    magenta: effectiveTheme === 'light' ? '#7c3aed' : '#c4b5fd',
    brightMagenta: effectiveTheme === 'light' ? '#8b5cf6' : '#a78bfa',
    cyan: effectiveTheme === 'light' ? '#0891b2' : '#67e8f9',
    brightCyan: effectiveTheme === 'light' ? '#06b6d4' : '#22d3ee',
    white: effectiveTheme === 'light' ? '#5b5148' : '#e2e8f0',
    brightWhite: effectiveTheme === 'light' ? '#2c2723' : '#f8fafc',
  };
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
  const normalizedSnapshot = snapshot.replace(/\r\n/g, '\n');
  const lines = normalizedSnapshot.split('\n');
  if (normalizedSnapshot.endsWith('\n') && lines.at(-1) === '') {
    lines.pop();
  }
  const serializedSnapshot = lines.join('\r\n');
  let frame = serializedSnapshot;

  if (cursorX !== undefined && cursorY !== undefined) {
    const historyOffset =
      paneHeight !== undefined ? Math.max(0, lines.length - paneHeight) : 0;
    const cursorLineIndex = historyOffset + cursorY;
    const linesBelowCursor = Math.max(0, lines.length - cursorLineIndex - 1);

    if (linesBelowCursor > 0) {
      frame += `\x1b[${linesBelowCursor}A`;
    }

    frame += `\r\x1b[${cursorX + 1}G`;
  }

  terminal.reset();
  terminal.write(frame, () => {
    terminal.scrollToBottom();
  });
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

function normalizeShellSnapshot(snapshot: string) {
  return snapshot.replace(/\r\n/g, '\n');
}

function splitShellSnapshotLines(snapshot: string) {
  const normalized = normalizeShellSnapshot(snapshot);
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n') && lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function looksLikePromptLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return /(?:[$%#>])\s*$/.test(trimmed);
}

function stripEchoedCommandLine(lines: string[], command: string) {
  const commandText = command.trim();
  if (!commandText || lines.length === 0) {
    return lines;
  }

  const [firstLine, ...rest] = lines;
  if (firstLine === undefined) {
    return lines;
  }
  const normalizedFirstLine = firstLine.trim();
  if (
    normalizedFirstLine === commandText ||
    normalizedFirstLine.endsWith(` ${commandText}`) ||
    normalizedFirstLine.endsWith(`$ ${commandText}`) ||
    normalizedFirstLine.endsWith(`% ${commandText}`) ||
    normalizedFirstLine.endsWith(`# ${commandText}`) ||
    normalizedFirstLine.endsWith(`> ${commandText}`)
  ) {
    return rest;
  }

  return lines;
}

function extractCommandOutput(
  beforeSnapshot: string,
  afterSnapshot: string,
  command: string,
) {
  const beforeLines = splitShellSnapshotLines(beforeSnapshot);
  const afterLines = splitShellSnapshotLines(afterSnapshot);

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] ===
      afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  let addedLines = afterLines.slice(prefix, afterLines.length - suffix);
  addedLines = stripEchoedCommandLine(addedLines, command);

  while (addedLines.length > 0 && addedLines[0]?.trim() === '') {
    addedLines.shift();
  }

  while (
    addedLines.length > 0 &&
    (addedLines.at(-1)?.trim() === '' || looksLikePromptLine(addedLines.at(-1) ?? ''))
  ) {
    addedLines.pop();
  }

  return addedLines.join('\n').trimEnd();
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

function clampPaneRatio(value: number) {
  return Math.min(75, Math.max(25, value));
}

function WrenchScrewdriverIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4 fill-current"
    >
      <path
        fillRule="evenodd"
        d="M14.5 10C16.9853 10 19 7.98528 19 5.5C19 5.01783 18.9242 4.55338 18.7838 4.11791C18.6792 3.79367 18.2734 3.72683 18.0325 3.96772L15.3402 6.66002C15.2098 6.79041 15.0168 6.84163 14.8466 6.77074C14.1172 6.46695 13.5334 5.88351 13.2292 5.15431C13.1582 4.98403 13.2094 4.79088 13.3398 4.66042L16.0327 1.9676C16.2735 1.72672 16.2067 1.32092 15.8825 1.21636C15.4469 1.07588 14.9823 1 14.5 1C12.0147 1 10 3.01472 10 5.5C10 5.59783 10.0031 5.69494 10.0093 5.79122C10.065 6.66418 9.88174 7.59855 9.20974 8.15855L1.98017 14.1832C1.3591 14.7008 1 15.4674 1 16.2759C1 17.7804 2.21962 19 3.7241 19C4.53256 19 5.29925 18.6409 5.81681 18.0198L11.8414 10.7903C12.4014 10.1183 13.3358 9.93497 14.2088 9.99073C14.3051 9.99688 14.4022 10 14.5 10ZM5 16C5 16.5523 4.55228 17 4 17C3.44772 17 3 16.5523 3 16C3 15.4477 3.44772 15 4 15C4.55228 15 5 15.4477 5 16Z"
        clipRule="evenodd"
      />
      <path d="M14.5 11.5C14.6731 11.5 14.8445 11.4927 15.0138 11.4783L18.7678 15.2323C19.7441 16.2086 19.7441 17.7915 18.7678 18.7678C17.7915 19.7441 16.2086 19.7441 15.2323 18.7678L10.8216 14.3571L12.9938 11.7505C13.0455 11.6885 13.1413 11.6131 13.3357 11.5552C13.5378 11.4951 13.805 11.468 14.1132 11.4877C14.2413 11.4959 14.3702 11.5 14.5 11.5Z" />
      <path d="M6.00003 4.58582L8.33056 6.91635C8.3027 6.95627 8.27496 6.98497 8.24946 7.00622L6.79994 8.21415L4.58582 6.00003H3.30905C3.11966 6.00003 2.94653 5.89303 2.86184 5.72364L1.1612 2.32237C1.06495 2.12987 1.10268 1.89739 1.25486 1.74521L1.74521 1.25486C1.89739 1.10268 2.12987 1.06495 2.32237 1.1612L5.72364 2.86184C5.89303 2.94653 6.00003 3.11966 6.00003 3.30905V4.58582Z" />
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
      ? 'border-rose-300/35 bg-rose-300/14 text-rose-600 dark:text-rose-50'
      : tone === 'sky'
        ? 'border-sky-300/35 bg-sky-300/14 text-sky-600 dark:text-sky-50'
        : 'shell-control-chip border';

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

type ShellPaneId = 'primary' | 'secondary';

interface ShellPaneRuntimeState {
  status: ShellStatusDto;
  shellInputEnabled: boolean;
  isConnecting: boolean;
  isCommandRunning: boolean;
  promptLabel: string | null;
  error: string | null;
  hasShell: boolean;
}

interface ShellPaneHandle {
  disconnect: () => void;
  reconnect: () => Promise<boolean>;
  sendInput: (data: string) => boolean;
  sendCommand: (command: string) => boolean;
  sendControl: (
    action: 'ctrl_c' | 'ctrl_d' | 'esc' | 'tab' | 'up' | 'down' | 'clear',
  ) => boolean;
  copyLastCommandOutput: () => Promise<boolean>;
  focus: () => void;
  refreshLayout: (options?: { focus?: boolean; syncBackendSize?: boolean }) => void;
}

interface ShellPaneProps {
  paneId: ShellPaneId;
  shell: ShellSessionDto | null;
  isActive: boolean;
  isVisible: boolean;
  isMobileShell: boolean;
  effectiveTheme: 'light' | 'dark';
  workspacePathMissing: boolean;
  shellAdapter: ThreadShellAdapter;
  onActivate: () => void;
  onShellUpdate: (
    shellId: string,
    updater: (shell: ShellSessionDto) => ShellSessionDto,
    nextState?: ShellStatusDto,
  ) => void;
  onRuntimeStateChange: (state: ShellPaneRuntimeState) => void;
  onFeedback?: (tone: ToolboxFeedbackState, text: string) => void;
}

const ShellPane = forwardRef<ShellPaneHandle, ShellPaneProps>(function ShellPane(
  {
    paneId,
    shell,
    isActive,
    isVisible,
    isMobileShell,
    effectiveTheme,
    workspacePathMissing,
    shellAdapter,
    onActivate,
    onShellUpdate,
    onRuntimeStateChange,
    onFeedback,
  },
  ref,
) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ShellSocketConnection | null>(null);
  const viewerIdRef = useRef<string | null>(null);
  const shellIdRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attachTimeoutRef = useRef<number | null>(null);
  const attachRetryTimerRef = useRef<number | null>(null);
  const intentionalDisconnectRef = useRef(false);
  const userDisconnectedShellIdRef = useRef<string | null>(null);
  const shellSnapshotRef = useRef('');
  const pendingCommandRef = useRef<{
    command: string;
    beforeSnapshot: string;
  } | null>(null);
  const lastCommandOutputRef = useRef('');
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const snapshotCursorRef = useRef<{
    cursorX: number | undefined;
    cursorY: number | undefined;
    paneHeight: number | undefined;
  }>({
    cursorX: undefined,
    cursorY: undefined,
    paneHeight: undefined,
  });
  const terminalInitializingRef = useRef(false);
  const terminalInputSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const isVisibleRef = useRef(isVisible);
  const isMobileShellRef = useRef(isMobileShell);
  const sendShellInputRef = useRef<(data: string) => boolean>(() => false);
  const syncTerminalSizeRef = useRef<() => { cols: number; rows: number } | null>(
    () => null,
  );
  const refreshTerminalLayoutRef = useRef<() => void>(() => {});
  const attachPromiseRef = useRef<{
    waiters: Array<(connected: boolean) => void>;
    timer: number | null;
  } | null>(null);
  const [terminalHostNode, setTerminalHostNode] = useState<HTMLDivElement | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [viewerId, setViewerIdState] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [runtimePromptLabel, setRuntimePromptLabel] = useState<string | null>(null);
  const [isCommandRunning, setIsCommandRunning] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const shellStatus = shell?.status ?? 'not_created';
  const canAttachShell = Boolean(
    shell &&
      !workspacePathMissing &&
      shell.status !== 'exited' &&
      shell.status !== 'not_found',
  );
  const fallbackPromptLabel = useMemo(
    () => buildPromptLabel(basenameFromPath(shell?.cwd), null),
    [shell?.cwd],
  );
  const promptLabel = runtimePromptLabel ?? fallbackPromptLabel;

  const setViewerId = useCallback((nextViewerId: string | null) => {
    viewerIdRef.current = nextViewerId;
    setViewerIdState(nextViewerId);
  }, []);

  const settleAttachPromise = useCallback((connected: boolean) => {
    const pending = attachPromiseRef.current;
    if (!pending) {
      return;
    }
    attachPromiseRef.current = null;
    if (pending.timer !== null) {
      window.clearTimeout(pending.timer);
    }
    for (const resolve of pending.waiters) {
      resolve(connected);
    }
  }, []);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    isMobileShellRef.current = isMobileShell;
  }, [isMobileShell]);

  useEffect(() => {
    shellIdRef.current = shell?.id ?? null;
  }, [shell?.id]);

  const sendShellInput = useCallback((data: string) => {
    const socket = socketRef.current;
    const shellId = shellIdRef.current;
    const currentViewerId = viewerIdRef.current;
    if (!socket || !shellId || !currentViewerId) {
      return false;
    }

    socket.send({
      type: 'shell.input',
      shellId,
      viewerId: currentViewerId,
      data,
    });
    return true;
  }, []);

  useEffect(() => {
    sendShellInputRef.current = sendShellInput;
  }, [sendShellInput]);

  const sendShellClear = useCallback(() => {
    const socket = socketRef.current;
    const shellId = shellIdRef.current;
    const currentViewerId = viewerIdRef.current;
    if (!socket || !shellId || !currentViewerId) {
      return false;
    }

    socket.send({
      type: 'shell.clear',
      shellId,
      viewerId: currentViewerId,
    });
    return true;
  }, []);

  const isTerminalVisible = useCallback(() => {
    if (!isVisible || !terminalHostNode) {
      return false;
    }
    const rect = terminalHostNode.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, [isVisible, terminalHostNode]);

  const syncTerminalSize = useCallback((options?: { syncBackendSize?: boolean }) => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || !isTerminalVisible()) {
      return null;
    }

    fitAddon.fit();
    if (terminal.cols <= 0 || terminal.rows <= 0) {
      return null;
    }

    const size = { cols: terminal.cols, rows: terminal.rows };
    if (options?.syncBackendSize === false) {
      return size;
    }

    const previous = lastSentSizeRef.current;
    if (previous?.cols === size.cols && previous.rows === size.rows) {
      return size;
    }

    lastSentSizeRef.current = size;
    if (socketRef.current && shellIdRef.current && viewerIdRef.current) {
      socketRef.current.send({
        type: 'shell.resize',
        shellId: shellIdRef.current,
        viewerId: viewerIdRef.current,
        cols: size.cols,
        rows: size.rows,
      });
    }
    return size;
  }, [isTerminalVisible]);

  useEffect(() => {
    syncTerminalSizeRef.current = syncTerminalSize;
  }, [syncTerminalSize]);

  const refreshTerminalLayout = useCallback(
    (options?: { focus?: boolean; syncBackendSize?: boolean }) => {
      const terminal = terminalRef.current;
      if (!terminal || !isTerminalVisible()) {
        return;
      }

      syncTerminalSize(
        options?.syncBackendSize === undefined
          ? undefined
          : { syncBackendSize: options.syncBackendSize },
      );
      if (shellSnapshotRef.current && !getVisibleTerminalText(terminalHostNode)) {
        renderShellSnapshot(
          terminal,
          shellSnapshotRef.current,
          snapshotCursorRef.current.cursorX,
          snapshotCursorRef.current.cursorY,
          snapshotCursorRef.current.paneHeight,
        );
      } else {
        terminal.scrollToBottom();
      }

      if (options?.focus && !isMobileShell) {
        terminal.focus();
      }
    },
    [isMobileShell, isTerminalVisible, syncTerminalSize, terminalHostNode],
  );

  useEffect(() => {
    refreshTerminalLayoutRef.current = () => refreshTerminalLayout();
  }, [refreshTerminalLayout]);

  useEffect(() => {
    onRuntimeStateChange({
      status: viewerId ? 'attached' : shellStatus,
      shellInputEnabled: Boolean(viewerId && shell),
      isConnecting,
      isCommandRunning,
      promptLabel,
      error: connectionError,
      hasShell: Boolean(shell),
    });
  }, [
    connectionError,
    isConnecting,
    isCommandRunning,
    onRuntimeStateChange,
    promptLabel,
    shell,
    shellStatus,
    viewerId,
  ]);

  useEffect(() => {
    if (!terminalHostNode || terminalRef.current || terminalInitializingRef.current) {
      return;
    }

    let cancelled = false;
    terminalInitializingRef.current = true;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('@xterm/addon-fit'),
      ]);

      if (cancelled || !terminalHostNode) {
        terminalInitializingRef.current = false;
        return;
      }

      const terminal = new Terminal({
        cursorBlink: true,
        disableStdin: isMobileShellRef.current,
        fontFamily: 'IBM Plex Mono, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.25,
        scrollback: 3000,
        theme: terminalThemeFor(effectiveTheme),
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalHostNode);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      syncTerminalSizeRef.current();
      terminal.attachCustomKeyEventHandler((event) => {
        if (isMobileShellRef.current || event.type !== 'keydown') {
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

          if (sendShellInputRef.current(sequence)) {
            event.preventDefault();
            return false;
          }
        }

        return true;
      });
      setTerminalReady(true);
      terminalInitializingRef.current = false;

      resizeObserverRef.current = new ResizeObserver(() => {
        refreshTerminalLayoutRef.current();
      });
      resizeObserverRef.current.observe(terminalHostNode);

      terminalInputSubscriptionRef.current = terminal.onData((data) => {
        if (isMobileShellRef.current) {
          return;
        }
        sendShellInputRef.current(data);
      });
    })();

    return () => {
      cancelled = true;
      terminalInitializingRef.current = false;
      terminalInputSubscriptionRef.current?.dispose();
      terminalInputSubscriptionRef.current = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      setTerminalReady(false);
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      lastSentSizeRef.current = null;
    };
  }, [effectiveTheme, terminalHostNode]);

  useEffect(() => {
    if (shell) {
      return;
    }
    setViewerId(null);
    setIsConnecting(false);
    settleAttachPromise(false);
    setConnectionError(null);
    setRuntimePromptLabel(null);
    setIsCommandRunning(false);
    shellSnapshotRef.current = '';
    lastCommandOutputRef.current = '';
    pendingCommandRef.current = null;
    terminalRef.current?.reset();
  }, [setViewerId, settleAttachPromise, shell]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = terminalThemeFor(effectiveTheme);
  }, [effectiveTheme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.disableStdin = isMobileShell;
  }, [isMobileShell]);

  useEffect(() => {
    if (!isVisible || !terminalReady) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      refreshTerminalLayout({ focus: isActive, syncBackendSize: false });
      if (
        !socketRef.current &&
        shell?.id &&
        userDisconnectedShellIdRef.current !== shell.id
      ) {
        setReconnectKey((current) => current + 1);
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isActive, isVisible, refreshTerminalLayout, shell?.id, terminalReady]);

  useEffect(() => {
    const shellId = shell?.id;
    if (!shellId || !terminalReady || !isVisibleRef.current || !canAttachShell) {
      return;
    }
    if (userDisconnectedShellIdRef.current === shellId) {
      return;
    }

    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const attachSize = syncTerminalSizeRef.current();
    if (!attachSize) {
      if (attachRetryTimerRef.current === null) {
        attachRetryTimerRef.current = window.setTimeout(() => {
          attachRetryTimerRef.current = null;
          setReconnectKey((current) => current + 1);
        }, 120);
      }
      return;
    }
    if (attachRetryTimerRef.current !== null) {
      window.clearTimeout(attachRetryTimerRef.current);
      attachRetryTimerRef.current = null;
    }

    if (socketRef.current && shellIdRef.current === shellId) {
      return;
    }

    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    shellIdRef.current = shellId;
    terminal.reset();
    setConnectionError(null);
    setViewerId(null);
    setIsConnecting(true);
    intentionalDisconnectRef.current = false;

    const shellSocket = shellAdapter.connectSocket({
      onConnected: () => {
        if (socketRef.current?.socket !== shellSocket.socket) {
          return;
        }
        shellSocket.send({
          type: 'shell.attach',
          shellId,
          cols: attachSize.cols,
          rows: attachSize.rows,
        });
        if (attachTimeoutRef.current !== null) {
          window.clearTimeout(attachTimeoutRef.current);
        }
        attachTimeoutRef.current = window.setTimeout(() => {
          attachTimeoutRef.current = null;
          if (
            shellSocket.socket &&
            socketRef.current?.socket !== shellSocket.socket
          ) {
            return;
          }
          if (viewerIdRef.current) {
            return;
          }
          setConnectionError('Shell connection timed out. Reconnecting...');
          setIsConnecting(false);
          settleAttachPromise(false);
          shellSocket.close?.();
          shellSocket.socket?.close();
        }, 4000);
      },
      onShellEvent: (event: ShellEventEnvelope) => {
        if (
          shellSocket.socket &&
          socketRef.current?.socket !== shellSocket.socket
        ) {
          return;
        }
        if (event.shellId !== shellId) {
          return;
        }

        if (event.type === 'shell.connected') {
          if (attachTimeoutRef.current !== null) {
            window.clearTimeout(attachTimeoutRef.current);
            attachTimeoutRef.current = null;
          }
          const nextViewerId = String(event.payload.viewerId ?? '');
          setViewerId(nextViewerId || null);
          setIsConnecting(false);
          settleAttachPromise(Boolean(nextViewerId));
          onShellUpdate(
            shellId,
            (entry) => ({
              ...entry,
              status: 'attached',
              attachedViewerId: nextViewerId,
            }),
            'attached',
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
            cwdBaseName ?? basenameFromPath(shell?.cwd),
            envPrefix,
          );
          const nextIsCommandRunning = event.payload.isCommandRunning === true;

          snapshotCursorRef.current = {
            cursorX,
            cursorY,
            paneHeight,
          };

          setRuntimePromptLabel(nextPromptLabel);
          setIsCommandRunning(nextIsCommandRunning);
          if (data) {
            if (replace) {
              const nextSnapshot = normalizeShellSnapshot(data);
              shellSnapshotRef.current = nextSnapshot;
              renderShellSnapshot(terminal, data, cursorX, cursorY, paneHeight);
              if (!nextIsCommandRunning && pendingCommandRef.current) {
                lastCommandOutputRef.current = extractCommandOutput(
                  pendingCommandRef.current.beforeSnapshot,
                  nextSnapshot,
                  pendingCommandRef.current.command,
                );
                pendingCommandRef.current = null;
              }
            } else {
              shellSnapshotRef.current = normalizeShellSnapshot(
                `${shellSnapshotRef.current}${data}`,
              );
              terminal.write(data);
            }
          }
          return;
        }

        if (event.type === 'shell.error') {
          setConnectionError(String(event.payload.message ?? 'Shell connection failed.'));
          setIsConnecting(false);
          settleAttachPromise(false);
          if (event.payload.code === 'viewer_conflict') {
            onShellUpdate(
              shellId,
              (entry) => ({ ...entry, status: 'detached', attachedViewerId: null }),
              'detached',
            );
          }
          return;
        }

        if (event.type === 'shell.detached') {
          const detachedViewerId = String(event.payload.viewerId ?? '');
          const detachedReason = String(event.payload.reason ?? '');
          if (detachedViewerId && detachedViewerId === viewerIdRef.current) {
            setViewerId(null);
            setIsConnecting(false);
            settleAttachPromise(false);
            onShellUpdate(
              shellId,
              (entry) => ({ ...entry, status: 'detached', attachedViewerId: null }),
              'detached',
            );
            if (detachedReason === 'replaced') {
              intentionalDisconnectRef.current = true;
              setConnectionError('This shell connection was taken over by another pane or device.');
            } else {
              setConnectionError(null);
            }
            setIsCommandRunning(false);
            shellSocket.socket.close();
          }
          return;
        }

        if (event.type === 'shell.exited') {
          setViewerId(null);
          setIsCommandRunning(false);
          setIsConnecting(false);
          settleAttachPromise(false);
          intentionalDisconnectRef.current = true;
          const nextState =
            event.payload.state === 'exited' ? 'exited' : 'not_found';
          onShellUpdate(
            shellId,
            (entry) => ({
              ...entry,
              status: nextState,
              attachedViewerId: null,
            }),
            nextState,
          );
          shellSocket.socket.close();
          return;
        }

        const nextState = event.payload.state as ShellStatusDto | undefined;
        if (nextState) {
          if (nextState !== 'attached') {
            setViewerId(null);
            setIsCommandRunning(false);
            setIsConnecting(false);
            settleAttachPromise(false);
          }
          onShellUpdate(
            shellId,
            (entry) => ({
              ...entry,
              status:
                nextState === 'attached' || nextState === 'detached'
                  ? nextState
                  : entry.status,
              attachedViewerId:
                nextState === 'attached' ? entry.attachedViewerId : null,
            }),
            nextState,
          );
        }
      },
    });

    socketRef.current = shellSocket;

    shellSocket.socket.addEventListener('close', () => {
      if (socketRef.current?.socket !== shellSocket.socket) {
        return;
      }
      if (attachTimeoutRef.current !== null) {
        window.clearTimeout(attachTimeoutRef.current);
        attachTimeoutRef.current = null;
      }
      socketRef.current = null;
      const hadViewer = Boolean(viewerIdRef.current);
      setViewerId(null);
      setIsConnecting(false);
      settleAttachPromise(false);
      if (hadViewer) {
        onShellUpdate(
          shellId,
          (entry) => ({
            ...entry,
            status: entry.status === 'attached' ? 'detached' : entry.status,
            attachedViewerId: null,
          }),
          'detached',
        );
      }
      if (
        !intentionalDisconnectRef.current &&
        userDisconnectedShellIdRef.current !== shellId
      ) {
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          setReconnectKey((current) => current + 1);
        }, 800);
      }
    });

    return () => {
      const currentViewerId = viewerIdRef.current;
      intentionalDisconnectRef.current = true;
      if (attachRetryTimerRef.current !== null) {
        window.clearTimeout(attachRetryTimerRef.current);
        attachRetryTimerRef.current = null;
      }
      if (currentViewerId && shellSocket.socket.readyState === WebSocket.OPEN) {
        shellSocket.send({
          type: 'shell.detach',
          shellId,
          viewerId: currentViewerId,
        });
      }
      setViewerId(null);
      setIsConnecting(false);
      settleAttachPromise(false);
      if (attachTimeoutRef.current !== null) {
        window.clearTimeout(attachTimeoutRef.current);
        attachTimeoutRef.current = null;
      }
      shellSocket.socket.close();
      if (socketRef.current?.socket === shellSocket.socket) {
        socketRef.current = null;
      }
    };
  }, [
    canAttachShell,
    onShellUpdate,
    reconnectKey,
    setViewerId,
    settleAttachPromise,
    shell?.cwd,
    shell?.id,
    terminalReady,
  ]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (attachTimeoutRef.current !== null) {
        window.clearTimeout(attachTimeoutRef.current);
      }
      if (attachRetryTimerRef.current !== null) {
        window.clearTimeout(attachRetryTimerRef.current);
      }
      settleAttachPromise(false);
    };
  }, [settleAttachPromise]);

  useImperativeHandle(
    ref,
    () => ({
      disconnect() {
        const socket = socketRef.current;
        const shellId = shellIdRef.current;
        const currentViewerId = viewerIdRef.current;
        userDisconnectedShellIdRef.current = shellId;
        intentionalDisconnectRef.current = true;
        if (socket && shellId && currentViewerId) {
          socket.send({
            type: 'shell.detach',
            shellId,
            viewerId: currentViewerId,
          });
        }
        setViewerId(null);
        setIsConnecting(false);
        settleAttachPromise(false);
        socket?.socket.close();
        socketRef.current = null;
        lastSentSizeRef.current = null;
        if (shellId) {
          onShellUpdate(
            shellId,
            (entry) => ({ ...entry, status: 'detached', attachedViewerId: null }),
            'detached',
          );
        }
      },
      reconnect() {
        if (!shellIdRef.current || !terminalReady || workspacePathMissing) {
          return Promise.resolve(false);
        }
        if (viewerIdRef.current) {
          return Promise.resolve(true);
        }
        if (attachPromiseRef.current) {
          return new Promise<boolean>((resolve) => {
            attachPromiseRef.current?.waiters.push(resolve);
          });
        }
        const attachPromise = new Promise<boolean>((resolve) => {
          const timer = window.setTimeout(() => {
            setIsConnecting(false);
            attachPromiseRef.current = null;
            resolve(false);
          }, 4500);
          attachPromiseRef.current = { waiters: [resolve], timer };
        });
        if (userDisconnectedShellIdRef.current === shellIdRef.current) {
          userDisconnectedShellIdRef.current = null;
        }
        intentionalDisconnectRef.current = false;
        setConnectionError(null);
        setIsConnecting(true);
        setReconnectKey((current) => current + 1);
        return attachPromise;
      },
      sendInput(data: string) {
        return sendShellInput(data);
      },
      sendCommand(command: string) {
        const pendingCommand = {
          command,
          beforeSnapshot: shellSnapshotRef.current,
        };
        pendingCommandRef.current = pendingCommand;
        if (command.trim() === 'clear') {
          const sent = sendShellClear();
          if (!sent && pendingCommandRef.current === pendingCommand) {
            pendingCommandRef.current = null;
          }
          return sent;
        }
        const normalized = command.endsWith('\n') ? command : `${command}\n`;
        const sent = sendShellInput(normalized);
        if (!sent && pendingCommandRef.current === pendingCommand) {
          pendingCommandRef.current = null;
        }
        return sent;
      },
      sendControl(action) {
        if (action === 'clear') {
          return sendShellClear();
        }
        return sendShellInput(shellControlSequence(action));
      },
      async copyLastCommandOutput() {
        const output =
          lastCommandOutputRef.current.trim() || getVisibleTerminalText(terminalHostNode);
        if (!output) {
          onFeedback?.('failed', 'Nothing to copy');
          return false;
        }

        try {
          await navigator.clipboard.writeText(output);
          onFeedback?.('done', 'Copied');
          return true;
        } catch {
          onFeedback?.('failed', 'Copy failed');
          return false;
        }
      },
      focus() {
        terminalRef.current?.focus();
      },
      refreshLayout(options) {
        refreshTerminalLayout(options);
      },
    }),
    [
      onFeedback,
      onShellUpdate,
      refreshTerminalLayout,
      sendShellClear,
      sendShellInput,
      setViewerId,
      settleAttachPromise,
      terminalHostNode,
      terminalReady,
      workspacePathMissing,
    ],
  );

  return (
    <div
      className={`relative min-h-0 flex-1 overflow-hidden ${
        isActive ? 'shell-pane-active' : ''
      }`}
      onMouseDown={onActivate}
      data-pane-id={paneId}
    >
      <div
        ref={setTerminalHostNode}
        className={`h-full w-full px-2 py-2 sm:px-3 sm:py-3 ${
          isMobileShell ? 'mobile-shell-selectable' : ''
        }`}
        onMouseDown={() => {
          onActivate();
          terminalRef.current?.focus();
        }}
      />
      {isActive && (
        <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-sky-300/30 bg-sky-300/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-sky-100">
          Active
        </div>
      )}
    </div>
  );
});

export const ThreadShellPanel = forwardRef<
  ThreadShellPanelHandle,
  ThreadShellPanelProps
>(function ThreadShellPanel(
  {
    threadId,
    shellAdapter,
    isVisible = true,
    showHeader = true,
    showFloatingToolbox = true,
    effectiveTheme = 'dark',
    loadSplitRatio,
    saveSplitRatio,
    onStateChange,
  }: ThreadShellPanelProps,
  ref,
) {
  const primaryPaneRef = useRef<ShellPaneHandle | null>(null);
  const secondaryPaneRef = useRef<ShellPaneHandle | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const terminalSplitHostRef = useRef<HTMLDivElement | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const createShellInFlightRef = useRef(false);
  const [shellState, setShellState] = useState<ThreadShellStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePaneId, setActivePaneId] = useState<ShellPaneId>('primary');
  const [primaryShellId, setPrimaryShellId] = useState<string | null>(null);
  const [secondaryShellId, setSecondaryShellId] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState<'single' | 'columns'>('single');
  const [splitRatio, setSplitRatio] = useState(50);
  const [renamingShellId, setRenamingShellId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [isMobileShell, setIsMobileShell] = useState(false);
  const [mobileProcessListOpen, setMobileProcessListOpen] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [paneRuntime, setPaneRuntime] = useState<Record<ShellPaneId, ShellPaneRuntimeState>>({
    primary: {
      status: 'not_created',
      shellInputEnabled: false,
      isConnecting: false,
      isCommandRunning: false,
      promptLabel: null,
      error: null,
      hasShell: false,
    },
    secondary: {
      status: 'not_created',
      shellInputEnabled: false,
      isConnecting: false,
      isCommandRunning: false,
      promptLabel: null,
      error: null,
      hasShell: false,
    },
  });
  const [toolboxFeedback, setToolboxFeedback] = useState<{
    tone: ToolboxFeedbackState;
    text: string;
  } | null>(null);
  const status = shellState?.state ?? 'not_created';
  const shells = useMemo(() => shellState?.shells ?? [], [shellState?.shells]);
  const liveShells = useMemo(
    () => shells.filter((shell) => shell.status !== 'exited' && shell.status !== 'not_found'),
    [shells],
  );
  const primaryShell = useMemo(
    () => liveShells.find((shell) => shell.id === primaryShellId) ?? null,
    [liveShells, primaryShellId],
  );
  const secondaryShell = useMemo(
    () => liveShells.find((shell) => shell.id === secondaryShellId) ?? null,
    [liveShells, secondaryShellId],
  );
  const activeShell = activePaneId === 'secondary' ? secondaryShell : primaryShell;
  const activeRuntime = paneRuntime[activePaneId];
  const workspacePathMissing = shellState?.workspacePathStatus === 'missing';
  const connectionButtonDisabled = busy || loading || status === 'creating' || workspacePathMissing;
  const activePaneRef = activePaneId === 'secondary' ? secondaryPaneRef : primaryPaneRef;
  const connectionButtonLabel = activeRuntime.shellInputEnabled
    ? 'Disconnect shell'
    : activeShell && (activeShell.status === 'exited' || activeShell.status === 'not_found')
      ? 'Restart shell'
      : activeShell
        ? 'Connect shell'
        : 'Create shell';
  const connectionButtonClassName = activeRuntime.shellInputEnabled
    ? 'border-emerald-300/45 bg-emerald-300/18 text-emerald-50 ring-1 ring-emerald-300/20 hover:bg-emerald-300/24'
    : activeShell?.status === 'exited' || activeShell?.status === 'not_found'
      ? 'border-stone-600 bg-stone-800/90 text-stone-100 hover:border-stone-500 hover:bg-stone-800'
      : workspacePathMissing
        ? 'border-rose-300/35 bg-rose-300/12 text-rose-100'
        : 'border-stone-600 bg-stone-800/90 text-stone-100 hover:border-stone-500 hover:bg-stone-800';
  const toolboxFeedbackToneClassName =
    toolboxFeedback?.tone === 'done'
      ? 'shell-floating-feedback shell-floating-feedback-done'
      : toolboxFeedback?.tone === 'failed'
        ? 'shell-floating-feedback shell-floating-feedback-failed'
        : 'shell-floating-feedback';

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

  const updateShellEntry = useCallback(
    (
      shellId: string,
      updater: (shell: ShellSessionDto) => ShellSessionDto,
      nextState?: ShellStatusDto,
    ) => {
      setShellState((current) => {
        if (!current) {
          return current;
        }

        const nextShells = current.shells.map((shell) =>
          shell.id === shellId ? updater(shell) : shell,
        );
        const nextShell =
          current.shell?.id === shellId
            ? updater(current.shell)
            : nextShells.find((shell) => shell.id === current.shell?.id) ?? current.shell;

        return {
          ...current,
          ...(nextState ? { state: nextState } : {}),
          shell: nextShell,
          shells: nextShells,
        };
      });
    },
    [],
  );

  const loadShellState = useCallback(async () => {
    setLoading(true);
    try {
      const response = await shellAdapter.fetchState(threadId);
      setShellState(response);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load shell state.');
    } finally {
      setLoading(false);
    }
  }, [shellAdapter, threadId]);

  useEffect(() => {
    void loadShellState();
  }, [loadShellState]);

  useEffect(() => {
    const storedRatio = loadSplitRatio?.(threadId);
    if (storedRatio === null || storedRatio === undefined) {
      setSplitRatio(50);
      return;
    }
    const parsed =
      typeof storedRatio === 'number'
        ? storedRatio
        : Number.parseFloat(String(storedRatio));
    setSplitRatio(Number.isFinite(parsed) ? clampPaneRatio(parsed) : 50);
  }, [loadSplitRatio, threadId]);

  useEffect(() => {
    if (!shellState) {
      setPrimaryShellId(null);
      setSecondaryShellId(null);
      return;
    }

    const isLiveShell = (shell: ShellSessionDto) =>
      shell.status !== 'exited' && shell.status !== 'not_found';
    const nextActiveShell =
      (shellState.activeShellId
        ? shellState.shells.find((shell) => shell.id === shellState.activeShellId && isLiveShell(shell))
        : null) ??
      (shellState.shell && isLiveShell(shellState.shell) ? shellState.shell : null) ??
      shellState.shells.find(isLiveShell) ??
      null;

    setPrimaryShellId((current) => {
      if (current && shellState.shells.some((shell) => shell.id === current && isLiveShell(shell))) {
        return current;
      }
      return nextActiveShell?.id ?? null;
    });
    setSecondaryShellId((current) => {
      if (splitMode !== 'columns') {
        return null;
      }
      if (current && shellState.shells.some((shell) => shell.id === current && isLiveShell(shell))) {
        return current;
      }
      const fallback = shellState.shells.find(
        (shell) => isLiveShell(shell) && shell.id !== nextActiveShell?.id,
      );
      return fallback?.id ?? null;
    });
  }, [shellState, splitMode]);

  useEffect(() => {
    if (splitMode === 'columns') {
      return;
    }
    setActivePaneId('primary');
    setSecondaryShellId(null);
  }, [splitMode]);

  useEffect(() => {
    if (splitMode !== 'columns' || secondaryShellId || liveShells.length < 2) {
      return;
    }
    const nextSecondary = liveShells.find((shell) => shell.id !== primaryShell?.id) ?? null;
    if (nextSecondary) {
      setSecondaryShellId(nextSecondary.id);
    }
  }, [liveShells, primaryShell?.id, secondaryShellId, splitMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)');
    const update = () => {
      setIsMobileShell(mediaQuery.matches);
      if (!mediaQuery.matches) {
        setToolboxOpen(false);
        setMobileProcessListOpen(false);
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
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  const updatePaneRuntime = useCallback(
    (paneId: ShellPaneId, nextState: ShellPaneRuntimeState) => {
      setPaneRuntime((current) => {
        const previous = current[paneId];
        if (
          previous.status === nextState.status &&
          previous.shellInputEnabled === nextState.shellInputEnabled &&
          previous.isConnecting === nextState.isConnecting &&
          previous.isCommandRunning === nextState.isCommandRunning &&
          previous.promptLabel === nextState.promptLabel &&
          previous.error === nextState.error &&
          previous.hasShell === nextState.hasShell
        ) {
          return current;
        }
        return {
          ...current,
          [paneId]: nextState,
        };
      });
    },
    [],
  );
  const handlePrimaryRuntimeStateChange = useCallback(
    (nextState: ShellPaneRuntimeState) => updatePaneRuntime('primary', nextState),
    [updatePaneRuntime],
  );
  const handleSecondaryRuntimeStateChange = useCallback(
    (nextState: ShellPaneRuntimeState) => updatePaneRuntime('secondary', nextState),
    [updatePaneRuntime],
  );

  const shellLabel = useCallback(
    (shell: ShellSessionDto) => {
      if (shell.label?.trim()) {
        return shell.label.trim();
      }
      const index = shells.findIndex((entry) => entry.id === shell.id);
      return `Shell ${index >= 0 ? index + 1 : ''}`.trim();
    },
    [shells],
  );

  const handleStartRenameShell = useCallback(
    (shell: ShellSessionDto) => {
      setRenamingShellId(shell.id);
      setRenameDraft(shell.label?.trim() || shellLabel(shell));
    },
    [shellLabel],
  );

  const handleCancelRenameShell = useCallback(() => {
    setRenamingShellId(null);
    setRenameDraft('');
  }, []);

  const handleSubmitRenameShell = useCallback(async () => {
    if (!renamingShellId) {
      return;
    }

    setBusy(true);
    try {
      const label = renameDraft.trim();
      const updated = await shellAdapter.updateShell(renamingShellId, {
        label: label.length > 0 ? label : null,
      });
      setShellState((current) =>
        current
          ? {
              ...current,
              state: current.activeShellId === updated.id ? updated.status : current.state,
              shell: current.shell?.id === updated.id ? updated : current.shell,
              shells: current.shells.map((shell) =>
                shell.id === updated.id ? updated : shell,
              ),
            }
          : current,
      );
      setRenamingShellId(null);
      setRenameDraft('');
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to rename shell.');
    } finally {
      setBusy(false);
    }
  }, [renameDraft, renamingShellId, shellAdapter]);

  const setPaneShell = useCallback((paneId: ShellPaneId, shellId: string) => {
    if (paneId === 'primary') {
      setPrimaryShellId(shellId);
      setSecondaryShellId((current) => (current === shellId ? null : current));
      return;
    }
    setSecondaryShellId(shellId);
    setPrimaryShellId((current) => (current === shellId ? null : current));
  }, []);

  const handleClosePane = useCallback((paneId: ShellPaneId) => {
    if (paneId === 'primary') {
      primaryPaneRef.current?.disconnect();
      setPrimaryShellId(null);
      if (splitMode === 'columns') {
        setActivePaneId('secondary');
      }
      return;
    }
    secondaryPaneRef.current?.disconnect();
    setSecondaryShellId(null);
    setActivePaneId('primary');
    setSplitMode('single');
  }, [splitMode]);

  const handleSelectShell = useCallback(
    (shell: ShellSessionDto, paneId: ShellPaneId = activePaneId) => {
      const targetPaneId = splitMode === 'columns' ? paneId : 'primary';
      setPaneShell(targetPaneId, shell.id);
      if (splitMode !== 'columns') {
        setSecondaryShellId(null);
      }
      setActivePaneId(targetPaneId);
    },
    [activePaneId, setPaneShell, splitMode],
  );

  const handleCreateShell = useCallback(
    async (paneId: ShellPaneId = activePaneId) => {
      if (createShellInFlightRef.current) {
        return;
      }
      createShellInFlightRef.current = true;
      setBusy(true);
      try {
        const response = await shellAdapter.createShell(threadId);
        setShellState(response);
        const shellId = response.activeShellId ?? response.shell?.id ?? null;
        if (shellId) {
          const targetPaneId = splitMode === 'columns' ? paneId : 'primary';
          setPaneShell(targetPaneId, shellId);
          if (splitMode !== 'columns') {
            setSecondaryShellId(null);
          }
          setActivePaneId(targetPaneId);
        }
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Unable to create shell.',
        );
      } finally {
        createShellInFlightRef.current = false;
        setBusy(false);
      }
    },
    [activePaneId, setPaneShell, shellAdapter, splitMode, threadId],
  );

  useEffect(() => {
    if (
      !isVisible ||
      !shellState ||
      loading ||
      busy ||
      workspacePathMissing ||
      status === 'creating' ||
      liveShells.length > 0
    ) {
      return;
    }

    void handleCreateShell('primary');
  }, [
    busy,
    handleCreateShell,
    isVisible,
    liveShells.length,
    loading,
    shellState,
    status,
    workspacePathMissing,
  ]);

  const handleTerminateShell = useCallback(
    async (shellId: string = activeShell?.id ?? '') => {
      if (!shellId) {
        return;
      }

      setBusy(true);
      try {
        await shellAdapter.terminateShell(shellId);
        setPrimaryShellId((current) => (current === shellId ? null : current));
        setSecondaryShellId((current) => (current === shellId ? null : current));
        await loadShellState();
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Unable to terminate shell.',
        );
      } finally {
        setBusy(false);
      }
    },
    [activeShell?.id, loadShellState, shellAdapter],
  );

  const handleConnectionToggle = useCallback(async () => {
    if (connectionButtonDisabled) {
      return;
    }
    if (activeRuntime.shellInputEnabled) {
      activePaneRef.current?.disconnect();
      return;
    }
    if (!activeShell || activeShell.status === 'exited' || activeShell.status === 'not_found') {
      await handleCreateShell(activePaneId);
      return;
    }
    await activePaneRef.current?.reconnect();
  }, [
    activePaneId,
    activePaneRef,
    activeRuntime.shellInputEnabled,
    activeShell,
    connectionButtonDisabled,
    handleCreateShell,
  ]);

  const persistSplitRatio = useCallback(
    (nextRatio: number) => {
      if (typeof window === 'undefined') {
        return;
      }
      saveSplitRatio?.(threadId, clampPaneRatio(nextRatio));
    },
    [saveSplitRatio, threadId],
  );

  const refreshPaneLayouts = useCallback(() => {
    primaryPaneRef.current?.refreshLayout({ syncBackendSize: true });
    secondaryPaneRef.current?.refreshLayout({ syncBackendSize: true });
  }, []);

  const handleSplitDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (splitMode !== 'columns') {
        return;
      }
      const host = terminalSplitHostRef.current;
      if (!host) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const updateRatioFromClientX = (clientX: number) => {
        const rect = host.getBoundingClientRect();
        if (rect.width <= 0) {
          return;
        }
        const nextRatio = clampPaneRatio(((clientX - rect.left) / rect.width) * 100);
        setSplitRatio(nextRatio);
        if (dragFrameRef.current !== null) {
          window.cancelAnimationFrame(dragFrameRef.current);
        }
        dragFrameRef.current = window.requestAnimationFrame(() => {
          dragFrameRef.current = null;
          refreshPaneLayouts();
        });
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateRatioFromClientX(moveEvent.clientX);
      };
      const handlePointerUp = (upEvent: PointerEvent) => {
        updateRatioFromClientX(upEvent.clientX);
        const rect = host.getBoundingClientRect();
        if (rect.width > 0) {
          persistSplitRatio(((upEvent.clientX - rect.left) / rect.width) * 100);
        }
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp, { once: true });
    },
    [persistSplitRatio, refreshPaneLayouts, splitMode],
  );

  const handleAssignShellToPane = useCallback(
    (shell: ShellSessionDto, paneId: ShellPaneId) => {
      setPaneShell(paneId, shell.id);
      setActivePaneId(paneId);
    },
    [setPaneShell],
  );

  const handleCopyVisibleShellText = useCallback(async () => {
    const copied = await activePaneRef.current?.copyLastCommandOutput();
    if (!copied) {
      setTransientToolboxFeedback('failed', 'Nothing to copy');
      return false;
    }
    return true;
  }, [activePaneRef, setTransientToolboxFeedback]);

  useEffect(() => {
    onStateChange?.({
      status: activeRuntime.status,
      connectionButtonDisabled,
      connectionButtonLabel,
      shellInputEnabled: activeRuntime.shellInputEnabled,
      isConnecting: activeRuntime.isConnecting,
      isCommandRunning: activeRuntime.isCommandRunning,
      promptLabel: activeRuntime.promptLabel ?? (activeShell ? buildPromptLabel(basenameFromPath(activeShell.cwd), null) : null),
      isMobileShell,
      hasShell: Boolean(activeShell),
      busy,
      loading,
      error: activeRuntime.error ?? error,
    });
  }, [
    activeRuntime,
    activeShell,
    busy,
    connectionButtonDisabled,
    connectionButtonLabel,
    error,
    isMobileShell,
    loading,
    onStateChange,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      async toggleConnection() {
        await handleConnectionToggle();
      },
      sendInput(data: string) {
        return activePaneRef.current?.sendInput(data) ?? false;
      },
      sendCommand(command: string) {
        return activePaneRef.current?.sendCommand(command) ?? false;
      },
      sendControl(action) {
        return activePaneRef.current?.sendControl(action) ?? false;
      },
      async copyLastCommandOutput() {
        return (await activePaneRef.current?.copyLastCommandOutput()) ?? false;
      },
      async terminate() {
        await handleTerminateShell();
      },
      focus() {
        activePaneRef.current?.focus();
      },
      refreshLayout(options) {
        primaryPaneRef.current?.refreshLayout(options);
        if (splitMode === 'columns') {
          secondaryPaneRef.current?.refreshLayout(options);
        }
      },
    }),
    [activePaneRef, handleConnectionToggle, handleTerminateShell, splitMode],
  );

  const renderProcessRow = (shell: ShellSessionDto) => (
    <div
      key={shell.id}
      className={`rounded-md border px-2 py-1.5 text-xs ${
        shell.id === activeShell?.id
          ? 'border-sky-300/40 bg-sky-300/12 text-sky-50'
          : 'border-stone-800 bg-stone-900/40 text-stone-300'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        {renamingShellId === shell.id ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmitRenameShell();
            }}
          >
            <input
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  handleCancelRenameShell();
                }
              }}
              autoFocus
              className="w-full rounded border border-sky-300/35 bg-stone-950/70 px-2 py-1 text-xs text-stone-100 outline-none"
              aria-label="Shell name"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => handleSelectShell(shell)}
            onDoubleClick={() => handleStartRenameShell(shell)}
            className="min-w-0 flex-1 text-left"
            title={shell.tmuxSessionName}
          >
            <span className="block truncate">{shellLabel(shell)}</span>
            <span className="block truncate text-[10px] text-[var(--theme-fg-muted)]">
              {statusLabel(shell.status)} · {basenameFromPath(shell.cwd) || shell.cwd}
            </span>
          </button>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {renamingShellId === shell.id ? (
            <>
              <button
                type="button"
                onClick={() => void handleSubmitRenameShell()}
                className="rounded border border-sky-300/35 bg-sky-300/12 px-1.5 py-1 text-[10px] text-sky-50"
                title="Save shell name"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleCancelRenameShell}
                className="rounded border border-stone-700 px-1.5 py-1 text-[10px] text-stone-200"
                title="Cancel rename"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => handleStartRenameShell(shell)}
              className="rounded border border-stone-700 px-1.5 py-1 text-[10px] text-stone-200 hover:border-sky-300/40"
              title="Rename shell"
            >
              Rename
            </button>
          )}
          {splitMode === 'columns' && (
            <>
              <button
                type="button"
                onClick={() => handleAssignShellToPane(shell, 'primary')}
                className="rounded border border-stone-700 px-1.5 py-1 text-[10px] text-stone-200 hover:border-sky-300/40"
                title="Open in left pane"
              >
                L
              </button>
              <button
                type="button"
                onClick={() => handleAssignShellToPane(shell, 'secondary')}
                className="rounded border border-stone-700 px-1.5 py-1 text-[10px] text-stone-200 hover:border-sky-300/40"
                title="Open in right pane"
              >
                R
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleTerminateShell(shell.id)}
            className="rounded border border-rose-300/35 bg-rose-300/12 px-1.5 py-1 text-[10px] text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            title="Kill shell process"
          >
            Kill
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="shell-panel flex min-h-0 flex-1 flex-col">
      {showHeader && (
        <div className="shell-header shrink-0 border-b px-3 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--theme-fg-muted)]">Shell</p>
              <p className="mt-1 truncate text-sm text-[var(--theme-fg-soft)]">
                {activeRuntime.promptLabel ?? activeShell?.cwd ?? 'Create a terminal for this thread.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={connectionButtonLabel}
                title={`${connectionButtonLabel} (${statusLabel(activeRuntime.status)})`}
                disabled={connectionButtonDisabled}
                onClick={() => void handleConnectionToggle()}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-lg shadow-stone-950/25 transition disabled:cursor-not-allowed disabled:opacity-60 ${connectionButtonClassName}`}
              >
                <ConnectionIcon connected={activeRuntime.shellInputEnabled} />
              </button>
              {activeShell && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleTerminateShell(activeShell.id)}
                  className="rounded-full border border-rose-300/35 bg-rose-300/12 px-3 py-2 text-sm text-rose-600 transition hover:bg-rose-300/18 dark:text-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Terminate
                </button>
              )}
            </div>
          </div>
          {(error || loading || workspacePathMissing) && (
            <div className="shell-banner mt-3 rounded-2xl border px-3 py-3 text-sm">
              {loading && <p className="text-[var(--theme-fg-muted)]">Loading shell state...</p>}
              {!loading && workspacePathMissing && (
                <p className="text-rose-600 dark:text-rose-100">
                  Workspace path is missing on this machine. Restore the path before creating a shell.
                </p>
              )}
              {!loading && error && (
                <p className="text-amber-700 dark:text-amber-100">{error}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <div className="flex h-full min-h-0 flex-col">
          <div className="shell-terminal-bar flex shrink-0 items-center gap-2 border-b px-2 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
              <span className="min-w-0 truncate text-xs text-[var(--theme-fg-soft)]">
                {activeShell ? shellLabel(activeShell) : 'No live shell process'}
              </span>
              {activeShell && (
                <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-[var(--theme-fg-muted)]">
                  {statusLabel(activeRuntime.status)}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="hidden text-xs text-[var(--theme-fg-muted)] sm:inline">
                Live {liveShells.length}
              </span>
              <button
                type="button"
                aria-expanded={mobileProcessListOpen}
                aria-label={mobileProcessListOpen ? 'Hide shell processes' : 'Show shell processes'}
                onClick={() => setMobileProcessListOpen((current) => !current)}
                className="rounded-md border border-stone-700/80 bg-stone-900/50 px-2.5 py-1.5 text-xs text-stone-200 sm:hidden"
              >
                Processes
              </button>
            </div>
          </div>
          {mobileProcessListOpen && (
            <div className="shrink-0 border-b border-stone-800/80 bg-stone-950/55 p-2 sm:hidden">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-fg-muted)]">
                  Processes
                </p>
                <span className="text-[10px] text-[var(--theme-fg-muted)]">
                  {liveShells.length} live
                </span>
              </div>
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {liveShells.map(renderProcessRow)}
                {liveShells.length === 0 && (
                  <p className="px-2 py-3 text-xs text-[var(--theme-fg-muted)]">No live shell processes</p>
                )}
              </div>
              <div className="mt-2 flex justify-end border-t border-stone-800/80 pt-2">
                <button
                  type="button"
                  aria-label="New shell"
                  title="New shell"
                  disabled={busy || loading || workspacePathMissing}
                  onClick={() => void handleCreateShell(activePaneId)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-sky-300/35 bg-sky-300/12 text-base leading-none text-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {status === 'not_created' || workspacePathMissing ? (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <div className="shell-empty-state max-w-md rounded-[1.6rem] border px-6 py-8">
                <p className="text-base font-medium text-[var(--theme-fg)]">Durable thread shell</p>
                <p className="mt-3 text-sm leading-6 text-[var(--theme-fg-muted)]">
                  The shell runs under a supervisor-managed PTY and reconnects after browser disconnects.
                  Create it explicitly when you want to inspect or take over the workspace.
                </p>
                {!workspacePathMissing && (
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void handleCreateShell('primary')}
                    className="mt-5 rounded-md border border-sky-300/35 bg-sky-300/12 px-3 py-2 text-sm text-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    New Shell
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-1 gap-2 p-2 sm:grid-cols-[minmax(0,1fr)_16rem] sm:p-3">
              <div className="shell-terminal-frame relative min-h-0 overflow-hidden rounded-[1.4rem] border shadow-inner">
                {!showHeader && (error || loading || workspacePathMissing) && (
                  <div className="shell-banner absolute left-2 right-2 top-2 z-10 rounded-2xl border px-3 py-3 text-sm backdrop-blur sm:left-3 sm:right-3 sm:top-3">
                    {loading && <p className="text-[var(--theme-fg-muted)]">Loading shell state...</p>}
                    {!loading && workspacePathMissing && (
                      <p className="text-rose-600 dark:text-rose-100">
                        Workspace path is missing on this machine. Restore the path before creating a shell.
                      </p>
                    )}
                    {!loading && error && (
                      <p className="text-amber-700 dark:text-amber-100">{error}</p>
                    )}
                  </div>
                )}
                <div
                  ref={terminalSplitHostRef}
                  className={`relative grid h-full min-h-0 ${
                    splitMode === 'columns' ? 'grid-cols-1 sm:grid-cols-[var(--shell-left)_0.35rem_var(--shell-right)]' : 'grid-cols-1'
                  }`}
                  style={
                    splitMode === 'columns'
                      ? ({
                          '--shell-left': `${splitRatio}fr`,
                          '--shell-right': `${100 - splitRatio}fr`,
                        } as CSSProperties)
                      : undefined
                  }
                  data-shell-split-ratio={splitRatio}
                >
                  <ShellPane
                    ref={primaryPaneRef}
                    paneId="primary"
                    shell={primaryShell}
                    isActive={activePaneId === 'primary'}
                    isVisible={isVisible}
                    isMobileShell={isMobileShell}
                    effectiveTheme={effectiveTheme}
                    workspacePathMissing={workspacePathMissing}
                    shellAdapter={shellAdapter}
                    onActivate={() => setActivePaneId('primary')}
                    onShellUpdate={updateShellEntry}
                    onRuntimeStateChange={handlePrimaryRuntimeStateChange}
                    onFeedback={setTransientToolboxFeedback}
                  />
                  {splitMode === 'columns' && (
                    <button
                      type="button"
                      onClick={() => handleClosePane('primary')}
                      className="absolute left-2 top-2 z-10 rounded-md border border-stone-700/80 bg-stone-950/70 px-2 py-1 text-[10px] text-stone-200 hover:border-rose-300/40"
                      title="Close left pane"
                    >
                      Close
                    </button>
                  )}
                  {splitMode === 'columns' && (
                    <button
                      type="button"
                      aria-label="Resize shell panes"
                      title="Resize shell panes"
                      onPointerDown={handleSplitDividerPointerDown}
                      className="hidden cursor-col-resize border-x border-stone-800/80 bg-stone-900/60 transition hover:border-sky-300/40 hover:bg-sky-300/10 sm:block"
                    />
                  )}
                  {splitMode === 'columns' && (
                    <div className="relative min-h-0 border-t border-stone-800/80 sm:border-l sm:border-t-0">
                      <ShellPane
                        ref={secondaryPaneRef}
                        paneId="secondary"
                        shell={secondaryShell}
                        isActive={activePaneId === 'secondary'}
                        isVisible={isVisible}
                        isMobileShell={isMobileShell}
                        effectiveTheme={effectiveTheme}
                        workspacePathMissing={workspacePathMissing}
                        shellAdapter={shellAdapter}
                        onActivate={() => setActivePaneId('secondary')}
                        onShellUpdate={updateShellEntry}
                        onRuntimeStateChange={handleSecondaryRuntimeStateChange}
                        onFeedback={setTransientToolboxFeedback}
                      />
                      <button
                        type="button"
                        onClick={() => handleClosePane('secondary')}
                        className="absolute left-2 top-2 z-10 rounded-md border border-stone-700/80 bg-stone-950/70 px-2 py-1 text-[10px] text-stone-200 hover:border-rose-300/40"
                        title="Close right pane"
                      >
                        Close
                      </button>
                    </div>
                  )}
                </div>
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
                      <div className="shell-toolbox pointer-events-auto rounded-[1.2rem] border p-2 shadow-2xl backdrop-blur">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setTransientToolboxFeedback('idle', 'Use the prompt box tools to paste');
                            }}
                            className="inline-flex items-center justify-center rounded-full border border-sky-300/35 bg-sky-300/12 px-2.5 py-2 text-sky-600 dark:text-sky-50"
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <ClipboardIcon />
                              <span className="text-[11px] font-medium tracking-[0.12em]">Paste</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyVisibleShellText()}
                            className="shell-toolbox-copy inline-flex items-center justify-center rounded-full border px-2.5 py-2"
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <ClipboardIcon />
                              <span className="text-[11px] font-medium tracking-[0.12em]">Copy</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            disabled={!activeRuntime.shellInputEnabled}
                            onClick={() => {
                              if (activePaneRef.current?.sendControl('clear')) {
                                setTransientToolboxFeedback('done', 'Cleared');
                              } else {
                                setTransientToolboxFeedback('failed', 'Connect the shell first');
                              }
                            }}
                            className="disabled:opacity-45"
                          >
                            <ControlIcon label="CLEAR" tone="sky" />
                          </button>
                          <button
                            type="button"
                            disabled={!activeRuntime.shellInputEnabled || !activeRuntime.isCommandRunning}
                            onClick={() => {
                              if (activePaneRef.current?.sendInput('\u0003')) {
                                setTransientToolboxFeedback('done', 'Sent Ctrl-C');
                              } else {
                                setTransientToolboxFeedback('failed', 'Connect the shell first');
                              }
                            }}
                            className="disabled:opacity-45"
                          >
                            <ControlIcon label="CTRL-C" tone="rose" />
                          </button>
                          {(['ctrl_d', 'esc', 'tab', 'up', 'down'] as const).map((action) => (
                            <button
                              key={action}
                              type="button"
                              disabled={!activeRuntime.shellInputEnabled}
                              onClick={() => {
                                if (activePaneRef.current?.sendControl(action)) {
                                  setTransientToolboxFeedback('done', `Sent ${action.toUpperCase().replace('_', '-')}`);
                                } else {
                                  setTransientToolboxFeedback('failed', 'Connect the shell first');
                                }
                              }}
                              className="disabled:opacity-45"
                            >
                              <ControlIcon label={action.toUpperCase().replace('_', '-')} tone="stone" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      aria-expanded={toolboxOpen}
                      aria-label={toolboxOpen ? 'Close shell tools' : 'Open shell tools'}
                      onClick={() => setToolboxOpen((current) => !current)}
                      className="shell-toolbox-trigger pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border shadow-2xl backdrop-blur transition"
                    >
                      <WrenchScrewdriverIcon />
                    </button>
                  </div>
                )}
              </div>

              <aside className="hidden min-h-0 overflow-hidden rounded-[1rem] border border-stone-800/80 bg-stone-950/30 p-2 sm:flex sm:flex-col">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-fg-muted)]">
                    Processes
                  </p>
                  <span className="text-[10px] text-[var(--theme-fg-muted)]">{liveShells.length} live</span>
                </div>
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                  {liveShells.map(renderProcessRow)}
                  {liveShells.length === 0 && (
                    <p className="px-2 py-3 text-xs text-[var(--theme-fg-muted)]">No live shell processes</p>
                  )}
                </div>
                <div className="mt-2 flex justify-end border-t border-stone-800/80 pt-2">
                  <button
                    type="button"
                    aria-label="New shell"
                    title="New shell"
                    disabled={busy || loading || workspacePathMissing}
                    onClick={() => void handleCreateShell(activePaneId)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-sky-300/35 bg-sky-300/12 text-base leading-none text-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    +
                  </button>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
