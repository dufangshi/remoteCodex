import fs from 'node:fs/promises';

import {
  createShellSessionRecord,
  createViewerSessionRecord,
  deleteViewerSessionRecord,
  deleteViewerSessionsByShellId,
  getShellSessionRecordById,
  getShellSessionRecordByThreadId,
  getThreadRecordById,
  getViewerSessionRecordByShellId,
  getWorkspaceRecordById,
  listShellSessionRecords,
  updateShellSessionRecord,
  updateViewerSessionRecord,
  type DatabaseClient,
} from '../../../../packages/db/src/index';
import type {
  ShellEventEnvelope,
  ShellSessionDto,
  ShellStatusDto,
  ThreadShellStateDto,
} from '../../../../packages/shared/src/index';
import { SupervisorEventBus } from '../codex/event-bus';
import { TmuxManager } from './tmux-manager';

interface ShellAttachment {
  viewerId: string;
  onData: (
    data: string,
    options?: {
      replace?: boolean;
      cursorX?: number;
      cursorY?: number;
      paneHeight?: number;
    },
  ) => void;
  pollHandle: NodeJS.Timeout;
  lastSnapshot: string;
  polling: boolean;
}

type ShellOutputOptions = {
  replace?: boolean;
  cursorX?: number;
  cursorY?: number;
  paneHeight?: number;
};

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function shellThreadId(shell: {
  id: string;
  threadId: string | null;
}) {
  if (!shell.threadId) {
    throw new ShellServiceError(
      'shell_not_found',
      `Shell ${shell.id} is missing its thread binding.`,
    );
  }

  return shell.threadId;
}

function shellSessionName(shell: {
  id: string;
  tmuxSessionName: string | null;
}) {
  if (!shell.tmuxSessionName) {
    throw new ShellServiceError(
      'shell_not_found',
      `Shell ${shell.id} is missing its tmux session name.`,
    );
  }

  return shell.tmuxSessionName;
}

function shellDtoStatus(
  status: string | null,
  resolvedState: ShellStatusDto,
): ShellSessionDto['status'] {
  if (resolvedState === 'attached' || resolvedState === 'detached') {
    return resolvedState;
  }

  if (
    status === 'creating' ||
    status === 'running' ||
    status === 'exited' ||
    status === 'not_found'
  ) {
    return status;
  }

  return 'not_found';
}

function shellOutputOptions(input: {
  replace?: boolean;
  cursorX?: number | undefined;
  cursorY?: number | undefined;
  paneHeight?: number | undefined;
}): ShellOutputOptions {
  const output: ShellOutputOptions = {};
  if (input.replace) {
    output.replace = true;
  }
  if (input.cursorX !== undefined) {
    output.cursorX = input.cursorX;
  }
  if (input.cursorY !== undefined) {
    output.cursorY = input.cursorY;
  }
  if (input.paneHeight !== undefined) {
    output.paneHeight = input.paneHeight;
  }
  return output;
}

export class ShellServiceError extends Error {
  constructor(
    public readonly code:
      | 'thread_not_found'
      | 'shell_not_found'
      | 'workspace_missing'
      | 'shell_exists'
      | 'shell_not_running'
      | 'viewer_conflict'
      | 'viewer_not_attached'
      | 'invalid_viewer'
      | 'tmux_error',
    message: string,
  ) {
    super(message);
  }
}

export class ShellSessionService {
  private readonly attachments = new Map<string, ShellAttachment>();

  constructor(
    private readonly db: DatabaseClient,
    private readonly eventBus: SupervisorEventBus,
    private readonly tmuxManager: TmuxManager,
  ) {}

  async stop() {
    for (const [shellId, attachment] of this.attachments) {
      clearInterval(attachment.pollHandle);
      deleteViewerSessionRecord(this.db, attachment.viewerId);
      this.attachments.delete(shellId);
    }
  }

  async syncShellStateOnStartup() {
    const records = listShellSessionRecords(this.db);
    const sessionNames = new Set(await this.tmuxManager.listSessionNames());

    for (const record of records) {
      const sessionName = record.tmuxSessionName ?? '';
      const nextStatus = sessionNames.has(sessionName)
        ? 'running'
        : record.status === 'exited'
          ? 'exited'
          : 'not_found';
      updateShellSessionRecord(this.db, record.id, {
        status: nextStatus,
      });
      deleteViewerSessionsByShellId(this.db, record.id);
      this.emitShellEvent(record.id, 'shell.status', {
        threadId: record.threadId,
        state: nextStatus,
      });
    }
  }

  async getThreadShellState(threadId: string): Promise<ThreadShellStateDto> {
    const thread = getThreadRecordById(this.db, threadId);
    if (!thread) {
      throw new ShellServiceError('thread_not_found', 'Thread not found.');
    }

    const workspace = getWorkspaceRecordById(this.db, thread.workspaceId);
    if (!workspace) {
      throw new ShellServiceError('thread_not_found', 'Workspace not found.');
    }

    const shell = getShellSessionRecordByThreadId(this.db, threadId);
    const workspacePathStatus = (await pathExists(workspace.absPath))
      ? 'present'
      : 'missing';

    if (!shell) {
      return {
        threadId: thread.id,
        workspaceId: workspace.id,
        workspacePathStatus,
        state:
          workspacePathStatus === 'missing' ? 'workspace_missing' : 'not_created',
        shell: null,
      };
    }

    return {
      threadId: thread.id,
      workspaceId: workspace.id,
      workspacePathStatus,
      state: await this.resolveShellState(shell.id),
      shell: await this.toShellSessionDto(shell.id),
    };
  }

  async createShellForThread(
    threadId: string,
    options: { cols?: number; rows?: number } = {},
  ): Promise<ThreadShellStateDto> {
    const thread = getThreadRecordById(this.db, threadId);
    if (!thread) {
      throw new ShellServiceError('thread_not_found', 'Thread not found.');
    }

    const workspace = getWorkspaceRecordById(this.db, thread.workspaceId);
    if (!workspace) {
      throw new ShellServiceError('thread_not_found', 'Workspace not found.');
    }

    if (!(await pathExists(workspace.absPath))) {
      throw new ShellServiceError(
        'workspace_missing',
        'Workspace path is missing on this machine.',
      );
    }

    const tmuxSessionName = this.tmuxManager.sessionNameForThread(thread.id);
    const existing = getShellSessionRecordByThreadId(this.db, threadId);

    if (existing) {
      const canRevive =
        existing.status === 'exited' || existing.status === 'not_found';
      if (!canRevive) {
        throw new ShellServiceError(
          'shell_exists',
          'A durable shell already exists for this thread.',
        );
      }

      updateShellSessionRecord(this.db, existing.id, {
        tmuxSessionName,
        cwd: workspace.absPath,
        status: 'creating',
        lastActivityAt: nowIso(),
      });
    }

    const record =
      existing ??
      createShellSessionRecord(this.db, {
        workspaceId: workspace.id,
        threadId: thread.id,
        tmuxSessionName,
        cwd: workspace.absPath,
        status: 'creating',
      });

    this.emitShellEvent(record.id, 'shell.status', {
      threadId: thread.id,
      state: 'creating',
    });

    try {
      const existingSession = await this.tmuxManager.hasSession(tmuxSessionName);
      if (!existingSession) {
        await this.tmuxManager.createSession({
          sessionName: tmuxSessionName,
          cwd: workspace.absPath,
          ...(options.cols !== undefined ? { cols: options.cols } : {}),
          ...(options.rows !== undefined ? { rows: options.rows } : {}),
        });
      }
      updateShellSessionRecord(this.db, record.id, {
        status: 'running',
        lastActivityAt: nowIso(),
      });
    } catch (error) {
      updateShellSessionRecord(this.db, record.id, {
        status: 'not_found',
      });
      throw new ShellServiceError(
        'tmux_error',
        error instanceof Error ? error.message : 'Unable to start shell.',
      );
    }

    this.emitShellEvent(record.id, 'shell.status', {
      threadId: thread.id,
      state: 'detached',
    });

    return this.getThreadShellState(threadId);
  }

  async attachShell(
    shellId: string,
    options: {
      cols: number;
      rows: number;
      onData: (
        data: string,
        options?: {
          replace?: boolean;
          cursorX?: number;
          cursorY?: number;
          paneHeight?: number;
        },
      ) => void;
    },
  ) {
    const shell = getShellSessionRecordById(this.db, shellId);
    if (!shell) {
      throw new ShellServiceError('shell_not_found', 'Shell not found.');
    }

    const threadId = shellThreadId(shell);
    const existingViewer = getViewerSessionRecordByShellId(this.db, shell.id);
    const existingAttachment = this.attachments.get(shell.id);

    if (existingAttachment) {
      clearInterval(existingAttachment.pollHandle);
      deleteViewerSessionRecord(this.db, existingAttachment.viewerId);
      this.attachments.delete(shell.id);
      this.emitShellEvent(shell.id, 'shell.detached', {
        threadId,
        state: 'detached',
        viewerId: existingAttachment.viewerId,
        reason: 'replaced',
      });
    } else if (existingViewer) {
      deleteViewerSessionRecord(this.db, existingViewer.id);
    }

    const hasSession = await this.tmuxManager.hasSession(shellSessionName(shell));
    if (!hasSession) {
      updateShellSessionRecord(this.db, shell.id, {
        status: 'not_found',
      });
      this.emitShellEvent(shell.id, 'shell.status', {
        threadId,
        state: 'not_found',
      });
      throw new ShellServiceError(
        'shell_not_running',
        'The durable shell is no longer available.',
      );
    }

    const viewer = createViewerSessionRecord(this.db, {
      threadId,
      shellId: shell.id,
      activeTab: 'shell',
    });
    await this.tmuxManager.resizeWindow(
      shellSessionName(shell),
      options.cols,
      options.rows,
    );

    const initialSnapshot = await this.tmuxManager.capturePane(shellSessionName(shell));
    const initialCursor = await this.tmuxManager.getPaneCursor(shellSessionName(shell));
    const attachment: ShellAttachment = {
      viewerId: viewer.id,
      onData: options.onData,
      pollHandle: setInterval(() => {
        void this.pollAttachment(shell.id);
      }, 250),
      lastSnapshot: initialSnapshot,
      polling: false,
    };
    this.attachments.set(shell.id, attachment);

    if (initialSnapshot) {
      options.onData(
        initialSnapshot,
        shellOutputOptions({
          replace: true,
          cursorX: initialCursor.cursorX,
          cursorY: initialCursor.cursorY,
          paneHeight: initialCursor.paneHeight,
        }),
      );
    }

    updateShellSessionRecord(this.db, shell.id, {
      status: 'running',
      lastActivityAt: nowIso(),
    });

    this.emitShellEvent(shell.id, 'shell.status', {
      threadId,
      state: 'attached',
      viewerId: viewer.id,
    });

    return {
      viewerId: viewer.id,
      shell: await this.toShellSessionDto(shell.id),
    };
  }

  async detachShell(shellId: string, viewerId: string) {
    const shell = getShellSessionRecordById(this.db, shellId);
    if (!shell) {
      throw new ShellServiceError('shell_not_found', 'Shell not found.');
    }

    const attachment = this.attachments.get(shell.id);
    if (!attachment) {
      throw new ShellServiceError(
        'viewer_not_attached',
        'This shell is not currently attached.',
      );
    }

    if (attachment.viewerId !== viewerId) {
      throw new ShellServiceError(
        'invalid_viewer',
        'This browser session does not own the shell attachment.',
      );
    }

    clearInterval(attachment.pollHandle);
    deleteViewerSessionRecord(this.db, viewerId);
    this.attachments.delete(shell.id);

    updateShellSessionRecord(this.db, shell.id, {
      status: 'running',
      lastActivityAt: nowIso(),
    });

    this.emitShellEvent(shell.id, 'shell.detached', {
      threadId: shellThreadId(shell),
      state: 'detached',
      viewerId,
    });
  }

  async sendInput(shellId: string, viewerId: string, data: string) {
    const shell = getShellSessionRecordById(this.db, shellId);
    if (!shell) {
      throw new ShellServiceError('shell_not_found', 'Shell not found.');
    }

    const attachment = this.attachments.get(shellId);
    if (!attachment) {
      throw new ShellServiceError(
        'viewer_not_attached',
        'This shell is not currently attached.',
      );
    }

    if (attachment.viewerId !== viewerId) {
      throw new ShellServiceError(
        'invalid_viewer',
        'This browser session does not own the shell attachment.',
      );
    }

    await this.tmuxManager.sendInput(shellSessionName(shell), data);
    updateShellSessionRecord(this.db, shellId, {
      lastActivityAt: nowIso(),
    });
    updateViewerSessionRecord(this.db, viewerId, {
      lastHeartbeatAt: nowIso(),
      activeTab: 'shell',
    });
  }

  async resizeShell(
    shellId: string,
    viewerId: string,
    cols: number,
    rows: number,
  ) {
    const shell = getShellSessionRecordById(this.db, shellId);
    if (!shell) {
      throw new ShellServiceError('shell_not_found', 'Shell not found.');
    }

    const attachment = this.attachments.get(shellId);
    if (!attachment) {
      throw new ShellServiceError(
        'viewer_not_attached',
        'This shell is not currently attached.',
      );
    }

    if (attachment.viewerId !== viewerId) {
      throw new ShellServiceError(
        'invalid_viewer',
        'This browser session does not own the shell attachment.',
      );
    }

    await this.tmuxManager.resizeWindow(shellSessionName(shell), cols, rows);
    updateViewerSessionRecord(this.db, viewerId, {
      lastHeartbeatAt: nowIso(),
      activeTab: 'shell',
    });
  }

  async terminateShell(shellId: string) {
    const shell = getShellSessionRecordById(this.db, shellId);
    if (!shell) {
      throw new ShellServiceError('shell_not_found', 'Shell not found.');
    }

    const attachment = this.attachments.get(shell.id);
    if (attachment) {
      clearInterval(attachment.pollHandle);
      deleteViewerSessionRecord(this.db, attachment.viewerId);
      this.attachments.delete(shell.id);
    }

    await this.tmuxManager.killSession(shellSessionName(shell));
    updateShellSessionRecord(this.db, shell.id, {
      status: 'exited',
      lastActivityAt: nowIso(),
    });
    deleteViewerSessionsByShellId(this.db, shell.id);

    this.emitShellEvent(shell.id, 'shell.exited', {
      threadId: shellThreadId(shell),
      state: 'exited',
    });

    return this.toShellSessionDto(shell.id);
  }

  private async toShellSessionDto(shellId: string): Promise<ShellSessionDto> {
    const shell = getShellSessionRecordById(this.db, shellId);
    if (!shell) {
      throw new ShellServiceError('shell_not_found', 'Shell not found.');
    }

    const status = await this.resolveShellState(shell.id);
    return {
      id: shell.id,
      threadId: shellThreadId(shell),
      workspaceId: shell.workspaceId,
      tmuxSessionName: shellSessionName(shell),
      cwd: shell.cwd,
      status: shellDtoStatus(shell.status, status),
      attachedViewerId: this.attachments.get(shell.id)?.viewerId ?? null,
      createdAt: shell.createdAt,
      updatedAt: shell.updatedAt,
      lastActivityAt: shell.lastActivityAt,
    };
  }

  private async resolveShellState(shellId: string): Promise<ShellStatusDto> {
    const shell = getShellSessionRecordById(this.db, shellId);
    if (!shell) {
      return 'not_created';
    }

    if (shell.status === 'creating') {
      return 'creating';
    }

    if (shell.status === 'exited') {
      return 'exited';
    }

    if (shell.status === 'not_found') {
      return 'not_found';
    }

    const attachment = this.attachments.get(shell.id);
    return attachment ? 'attached' : 'detached';
  }

  private async pollAttachment(shellId: string) {
    const attachment = this.attachments.get(shellId);
    if (!attachment || attachment.polling) {
      return;
    }

    attachment.polling = true;
    const shell = getShellSessionRecordById(this.db, shellId);
    if (!shell) {
      clearInterval(attachment.pollHandle);
      this.attachments.delete(shellId);
      deleteViewerSessionRecord(this.db, attachment.viewerId);
      return;
    }

    try {
      const hasSession = await this.tmuxManager.hasSession(shellSessionName(shell));
      if (!hasSession) {
        await this.handleMissingShell(shell, attachment.viewerId);
        return;
      }

      const snapshot = await this.tmuxManager.capturePane(shellSessionName(shell));
      const cursor = await this.tmuxManager.getPaneCursor(shellSessionName(shell));
      if (snapshot === attachment.lastSnapshot) {
        return;
      }

      attachment.lastSnapshot = snapshot;
      updateShellSessionRecord(this.db, shell.id, {
        lastActivityAt: nowIso(),
      });
      updateViewerSessionRecord(this.db, attachment.viewerId, {
        lastHeartbeatAt: nowIso(),
        activeTab: 'shell',
      });
      attachment.onData(
        snapshot,
        shellOutputOptions({
          replace: true,
          cursorX: cursor.cursorX,
          cursorY: cursor.cursorY,
          paneHeight: cursor.paneHeight,
        }),
      );
    } finally {
      attachment.polling = false;
    }
  }

  private async handleMissingShell(
    shell: { id: string; threadId: string | null },
    viewerId: string,
  ) {
    const attachment = this.attachments.get(shell.id);
    if (attachment) {
      clearInterval(attachment.pollHandle);
      this.attachments.delete(shell.id);
    }
    deleteViewerSessionRecord(this.db, viewerId);

    updateShellSessionRecord(this.db, shell.id, {
      status: 'not_found',
      lastActivityAt: nowIso(),
    });

    this.emitShellEvent(shell.id, 'shell.exited', {
      threadId: shellThreadId(shell),
      state: 'not_found',
    });
  }

  private emitShellEvent(
    shellId: string,
    type: ShellEventEnvelope['type'],
    payload: Record<string, unknown>,
  ) {
    this.eventBus.emitShellEvent({
      type,
      shellId,
      timestamp: nowIso(),
      payload,
    });
  }
}
