import type {
  ShellBackend,
  ShellBackendAttachOptions,
  ShellBackendCreateInput,
  ShellBackendSession,
} from './shell-backend';
import {
  buildShellPromptInitCommand,
  isInteractiveShellCommand,
  resolvePaneEnvironmentPrefix,
} from './shell-prompt';
import { TmuxManager } from './tmux-manager';

interface TmuxAttachment {
  disposed: boolean;
  pollHandle: NodeJS.Timeout;
  lastSnapshot: string;
  polling: boolean;
}

export class TmuxShellBackend implements ShellBackend {
  readonly kind = 'tmux';
  private readonly attachments = new Map<string, TmuxAttachment>();

  constructor(private readonly tmuxManager = new TmuxManager()) {}

  sessionNameForThread(threadId: string) {
    return this.tmuxManager.sessionNameForThread(threadId);
  }

  listSessionNames() {
    return this.tmuxManager.listSessionNames();
  }

  hasSession(sessionId: string) {
    return this.tmuxManager.hasSession(sessionId);
  }

  async createSession(input: ShellBackendCreateInput) {
    await this.tmuxManager.createSession({
      sessionName: input.sessionId,
      cwd: input.cwd,
      ...(input.cols !== undefined ? { cols: input.cols } : {}),
      ...(input.rows !== undefined ? { rows: input.rows } : {}),
    });
    try {
      const runtime = await this.tmuxManager.getPaneRuntimeInfo(input.sessionId);
      if (isInteractiveShellCommand(runtime.currentCommand)) {
        await this.tmuxManager.sendInput(
          input.sessionId,
          await buildShellPromptInitCommand(runtime.currentCommand, {
            clearScreen: true,
          }),
        );
      }
    } catch {
      // Prompt initialization is cosmetic and must not fail shell creation.
    }
  }

  async attach(sessionId: string, options: ShellBackendAttachOptions) {
    const previous = this.attachments.get(sessionId);
    if (previous) {
      previous.disposed = true;
      clearInterval(previous.pollHandle);
      this.attachments.delete(sessionId);
    }
    await this.tmuxManager.resizeWindow(sessionId, options.cols, options.rows);
    const session = await this.snapshot(sessionId);
    const attachment: TmuxAttachment = {
      disposed: false,
      lastSnapshot: session.snapshot,
      polling: false,
      pollHandle: setInterval(() => {
        void this.poll(sessionId, attachment, options);
      }, 250),
    };
    this.attachments.set(sessionId, attachment);
    return {
      session,
      attachment: {
        dispose: () => {
          attachment.disposed = true;
          clearInterval(attachment.pollHandle);
          if (this.attachments.get(sessionId) === attachment) {
            this.attachments.delete(sessionId);
          }
        },
      },
    };
  }

  sendInput(sessionId: string, data: string) {
    return this.tmuxManager.sendInput(sessionId, data);
  }

  async clear(sessionId: string) {
    await this.tmuxManager.sendInput(sessionId, '\u000c');
    await this.tmuxManager.clearHistory(sessionId);
    const session = await this.snapshot(sessionId);
    const attachment = this.attachments.get(sessionId);
    if (attachment) {
      attachment.lastSnapshot = session.snapshot;
    }
    return session;
  }

  resize(sessionId: string, cols: number, rows: number) {
    return this.tmuxManager.resizeWindow(sessionId, cols, rows);
  }

  async snapshot(sessionId: string): Promise<ShellBackendSession> {
    const snapshot = await this.tmuxManager.capturePane(sessionId);
    const runtime = await this.tmuxManager.getPaneRuntimeInfo(sessionId);
    const envPrefix = await resolvePaneEnvironmentPrefix(
      this.tmuxManager,
      sessionId,
      runtime.panePid,
    );
    return {
      id: sessionId,
      cwd: runtime.currentPath,
      cols: runtime.paneWidth,
      rows: runtime.paneHeight,
      snapshot,
      runtime: {
        cursorX: runtime.cursorX,
        cursorY: runtime.cursorY,
        paneWidth: runtime.paneWidth,
        paneHeight: runtime.paneHeight,
        panePid: runtime.panePid,
        currentCommand: runtime.currentCommand,
        currentPath: runtime.currentPath,
        envPrefix,
        isCommandRunning: !isInteractiveShellCommand(runtime.currentCommand),
      },
    };
  }

  killSession(sessionId: string) {
    const attachment = this.attachments.get(sessionId);
    if (attachment) {
      attachment.disposed = true;
      clearInterval(attachment.pollHandle);
      this.attachments.delete(sessionId);
    }
    return this.tmuxManager.killSession(sessionId);
  }

  private async poll(
    sessionId: string,
    attachment: TmuxAttachment,
    options: ShellBackendAttachOptions,
  ) {
    if (attachment.disposed || attachment.polling) {
      return;
    }

    attachment.polling = true;
    try {
      const exists = await this.hasSession(sessionId);
      if (!exists) {
        attachment.disposed = true;
        clearInterval(attachment.pollHandle);
        this.attachments.delete(sessionId);
        options.onExit();
        return;
      }
      const session = await this.snapshot(sessionId);
      if (session.snapshot !== attachment.lastSnapshot) {
        attachment.lastSnapshot = session.snapshot;
        options.onData(session.snapshot, session, { replace: true });
      }
    } catch {
      attachment.disposed = true;
      clearInterval(attachment.pollHandle);
      this.attachments.delete(sessionId);
      options.onExit();
    } finally {
      attachment.polling = false;
    }
  }
}
