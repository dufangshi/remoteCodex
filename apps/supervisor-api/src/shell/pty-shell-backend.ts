import path from 'node:path';

import { spawn, type IPty, type IDisposable } from '@homebridge/node-pty-prebuilt-multiarch';

import type {
  ShellBackend,
  ShellBackendAttachOptions,
  ShellBackendCreateInput,
  ShellBackendSession,
  ShellRuntimeInfo,
} from './shell-backend';
import { resolveDefaultShell } from './default-shell';

interface PtySession {
  id: string;
  cwd: string;
  shell: string;
  pty: IPty;
  scrollback: string;
  exitCode: number | null;
  listeners: Set<(data: string) => void>;
  exitListeners: Set<() => void>;
  dataSubscription: IDisposable;
  exitSubscription: IDisposable;
}

const MAX_SCROLLBACK_BYTES = 512 * 1024;

function shellArgs(shell: string) {
  const shellName = path.basename(shell).toLowerCase();
  if (process.platform === 'win32') {
    return [];
  }
  if (shellName === 'bash' || shellName === 'zsh' || shellName === 'sh') {
    return ['-l'];
  }
  return [];
}

function trimScrollback(value: string) {
  if (value.length <= MAX_SCROLLBACK_BYTES) {
    return value;
  }
  return value.slice(value.length - MAX_SCROLLBACK_BYTES);
}

function lastVisibleLine(snapshot: string) {
  const normalized = snapshot.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const lines = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return lines.findLast((line) => line.trim().length > 0) ?? '';
}

function inferRuntime(session: PtySession): ShellRuntimeInfo {
  const promptLine = lastVisibleLine(session.scrollback);
  const shell = path.basename(session.shell);
  const isCommandRunning =
    session.exitCode !== null ? false : !/[$#>]\s*$/.test(promptLine.trimEnd());
  return {
    panePid: session.pty.pid,
    paneWidth: session.pty.cols,
    paneHeight: session.pty.rows,
    currentCommand: isCommandRunning ? session.pty.process : shell,
    currentPath: session.cwd,
    isCommandRunning,
  };
}

export class PtyShellBackend implements ShellBackend {
  readonly kind = 'pty';
  private readonly sessions = new Map<string, PtySession>();
  private readonly shell = resolveDefaultShell();

  sessionNameForThread(threadId: string) {
    return `rcx-${threadId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 28)}`;
  }

  async listSessionNames() {
    return [...this.sessions.keys()];
  }

  async hasSession(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  async createSession(input: ShellBackendCreateInput) {
    if (this.sessions.has(input.sessionId)) {
      return;
    }

    const pty = spawn(this.shell, shellArgs(this.shell), {
      name: 'xterm-256color',
      cwd: input.cwd,
      cols: input.cols ?? 120,
      rows: input.rows ?? 36,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: process.env.COLORTERM ?? 'truecolor',
      },
      handleFlowControl: true,
    });

    const session: PtySession = {
      id: input.sessionId,
      cwd: input.cwd,
      shell: this.shell,
      pty,
      scrollback: '',
      exitCode: null,
      listeners: new Set(),
      exitListeners: new Set(),
      dataSubscription: { dispose() {} },
      exitSubscription: { dispose() {} },
    };

    session.dataSubscription = pty.onData((data) => {
      session.scrollback = trimScrollback(session.scrollback + data);
      for (const listener of session.listeners) {
        listener(data);
      }
    });
    session.exitSubscription = pty.onExit(() => {
      session.exitCode = 0;
      this.sessions.delete(session.id);
      for (const listener of session.exitListeners) {
        listener();
      }
      session.dataSubscription.dispose();
      session.exitSubscription.dispose();
    });

    this.sessions.set(input.sessionId, session);
  }

  async attach(sessionId: string, options: ShellBackendAttachOptions) {
    const session = this.requireSession(sessionId);
    this.resizeIfChanged(session, options.cols, options.rows);
    const onData = (data: string) => options.onData(data, this.toBackendSession(session));
    const onExit = () => options.onExit();
    session.listeners.add(onData);
    session.exitListeners.add(onExit);

    return {
      session: this.toBackendSession(session),
      attachment: {
        dispose: () => {
          session.listeners.delete(onData);
          session.exitListeners.delete(onExit);
        },
      },
    };
  }

  async sendInput(sessionId: string, data: string) {
    this.requireSession(sessionId).pty.write(data);
  }

  async clear(sessionId: string) {
    const session = this.requireSession(sessionId);
    session.scrollback = '';
    session.pty.clear();
    session.pty.write('\u000c');
    return this.toBackendSession(session);
  }

  async resize(sessionId: string, cols: number, rows: number) {
    this.resizeIfChanged(this.requireSession(sessionId), cols, rows);
  }

  async snapshot(sessionId: string) {
    return this.toBackendSession(this.requireSession(sessionId));
  }

  async killSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.dataSubscription.dispose();
    session.exitSubscription.dispose();
    this.sessions.delete(sessionId);
    try {
      session.pty.kill();
    } catch {
      // The PTY may already be gone.
    }
  }

  private requireSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Shell session is no longer available.');
    }
    return session;
  }

  private resizeIfChanged(session: PtySession, cols: number, rows: number) {
    if (cols <= 0 || rows <= 0) {
      return;
    }
    if (session.pty.cols === cols && session.pty.rows === rows) {
      return;
    }
    session.pty.resize(cols, rows);
  }

  private toBackendSession(session: PtySession): ShellBackendSession {
    return {
      id: session.id,
      cwd: session.cwd,
      cols: session.pty.cols,
      rows: session.pty.rows,
      snapshot: session.scrollback,
      runtime: inferRuntime(session),
    };
  }
}
