import fs from 'node:fs/promises';

import {
  createShellSessionRecord,
  createViewerSessionRecord,
  deleteViewerSessionRecord,
  deleteViewerSessionsByShellId,
  deleteViewerSessionsByThreadId,
  getShellSessionRecordById,
  getShellSessionRecordByThreadId,
  getThreadRecordById,
  getViewerSessionRecordByShellId,
  getWorkspaceRecordById,
  listShellSessionRecords,
  listShellSessionRecordsByThreadId,
  updateShellSessionRecord,
  updateViewerSessionRecord,
  type DatabaseClient,
} from '../../../../packages/db/src/index';
import type {
  ShellEventEnvelope,
  ShellEventPayloadMap,
  ShellSessionDto,
  ShellStatusDto,
  ThreadShellStateDto,
} from '../../../../packages/shared/src/index';
import { SupervisorEventBus } from '../event-bus';
import type { ShellBackend, ShellBackendAttachment } from './shell-backend';
import { basenameFromPath } from './shell-prompt';

interface ShellAttachment {
  viewerId: string;
  onData: (data: string, options?: ShellOutputOptions) => void;
  backendAttachment: ShellBackendAttachment;
}

type ShellOutputOptions = {
  replace?: boolean;
  cursorX?: number;
  cursorY?: number;
  paneHeight?: number;
  cwdBaseName?: string;
  envPrefix?: string;
  isCommandRunning?: boolean;
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

function uniqueShellSessionName(baseName: string, index: number) {
  if (index <= 1) {
    return baseName;
  }
  const suffix = `-${index}`;
  return `${baseName.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
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
  cwdBaseName?: string | undefined;
  envPrefix?: string | undefined;
  isCommandRunning?: boolean | undefined;
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
  if (input.cwdBaseName !== undefined) {
    output.cwdBaseName = input.cwdBaseName;
  }
  if (input.envPrefix !== undefined) {
    output.envPrefix = input.envPrefix;
  }
  if (input.isCommandRunning !== undefined) {
    output.isCommandRunning = input.isCommandRunning;
  }
  return output;
}

export class ShellServiceError extends Error {
  constructor(
    public readonly code:
      | 'thread_not_found'
      | 'thread_not_connected'
      | 'shell_not_found'
      | 'workspace_missing'
      | 'shell_exists'
      | 'shell_not_running'
      | 'viewer_conflict'
      | 'viewer_not_attached'
      | 'invalid_viewer'
      | 'plugin_disabled'
      | 'shell_backend_error',
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
    private readonly shellBackend: ShellBackend,
  ) {}

  async stop() {
    for (const [shellId, attachment] of this.attachments) {
      attachment.backendAttachment.dispose();
      deleteViewerSessionRecord(this.db, attachment.viewerId);
      this.attachments.delete(shellId);
    }
  }

  async syncShellStateOnStartup() {
    const records = listShellSessionRecords(this.db);
    const sessionNames = new Set(await this.shellBackend.listSessionNames());

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
        threadId: shellThreadId(record),
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

    const shells = listShellSessionRecordsByThreadId(this.db, threadId);
    const workspacePathStatus = (await pathExists(workspace.absPath))
      ? 'present'
      : 'missing';

    if (shells.length === 0) {
      return {
        threadId: thread.id,
        workspaceId: workspace.id,
        workspacePathStatus,
        state:
          workspacePathStatus === 'missing' ? 'workspace_missing' : 'not_created',
        shell: null,
        shells: [],
        activeShellId: null,
      };
    }

    const shellDtos = await Promise.all(
      shells.map((shell) => this.toShellSessionDto(shell.id)),
    );
    const activeShell =
      shellDtos.find((shell) => shell.status === 'attached') ??
      shellDtos.find(
        (shell) => shell.status !== 'exited' && shell.status !== 'not_found',
      ) ??
      shellDtos[0] ??
      null;

    return {
      threadId: thread.id,
      workspaceId: workspace.id,
      workspacePathStatus,
      state: activeShell ? activeShell.status : 'not_created',
      shell: activeShell,
      shells: shellDtos,
      activeShellId: activeShell?.id ?? null,
    };
  }

  async createShellForThread(
    threadId: string,
    options: { cols?: number; rows?: number; label?: string } = {},
  ): Promise<ThreadShellStateDto> {
    const thread = getThreadRecordById(this.db, threadId);
    if (!thread) {
      throw new ShellServiceError('thread_not_found', 'Thread not found.');
    }

    const workspace = getWorkspaceRecordById(this.db, thread.workspaceId);
    if (!workspace) {
      throw new ShellServiceError('thread_not_found', 'Workspace not found.');
    }

    if (thread.isConnected === false) {
      throw new ShellServiceError(
        'thread_not_connected',
        'Reconnect this thread before attaching or creating a shell.',
      );
    }

    if (!(await pathExists(workspace.absPath))) {
      throw new ShellServiceError(
        'workspace_missing',
        'Workspace path is missing on this machine.',
      );
    }

    const baseSessionName = this.shellBackend.sessionNameForThread(thread.id);
    const existingShells = listShellSessionRecordsByThreadId(this.db, threadId);
    const existingSessionNames = new Set(
      existingShells
        .map((shell) => shell.tmuxSessionName)
        .filter((name): name is string => Boolean(name)),
    );
    let sessionIndex = existingShells.length + 1;
    let tmuxSessionName = uniqueShellSessionName(baseSessionName, sessionIndex);
    while (
      existingSessionNames.has(tmuxSessionName) ||
      (await this.shellBackend.hasSession(tmuxSessionName))
    ) {
      sessionIndex += 1;
      tmuxSessionName = uniqueShellSessionName(baseSessionName, sessionIndex);
    }

    const record = createShellSessionRecord(this.db, {
      workspaceId: workspace.id,
      threadId: thread.id,
      label: options.label ?? null,
      tmuxSessionName,
      cwd: workspace.absPath,
      status: 'creating',
    });

    this.emitShellEvent(record.id, 'shell.status', {
      threadId: thread.id,
      state: 'creating',
    });

    try {
      const existingSession = await this.shellBackend.hasSession(tmuxSessionName);
      if (!existingSession) {
        await this.shellBackend.createSession({
          sessionId: tmuxSessionName,
          threadId: thread.id,
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
        'shell_backend_error',
        error instanceof Error ? error.message : 'Unable to start shell.',
      );
    }

    this.emitShellEvent(record.id, 'shell.status', {
      threadId: thread.id,
      state: 'detached',
    });

    const state = await this.getThreadShellState(threadId);
    const createdShell = await this.toShellSessionDto(record.id);
    return {
      ...state,
      state: createdShell.status,
      shell: createdShell,
      activeShellId: createdShell.id,
    };
  }

  async updateShell(shellId: string, input: { label?: string | null }) {
    const shell = getShellSessionRecordById(this.db, shellId);
    if (!shell) {
      throw new ShellServiceError('shell_not_found', 'Shell not found.');
    }

    const updates: { label?: string | null } = {};
    if ('label' in input) {
      const label = input.label?.trim() ?? '';
      updates.label = label.length > 0 ? label : null;
    }

    updateShellSessionRecord(this.db, shell.id, updates);
    const shellDto = await this.toShellSessionDto(shell.id);
    this.emitShellEvent(shell.id, 'shell.status', {
      threadId: shellThreadId(shell),
      state: shellDto.status,
    });
    return shellDto;
  }

  async detachThreadViewers(threadId: string) {
    const shell = getShellSessionRecordByThreadId(this.db, threadId);
    if (!shell) {
      return;
    }

    const attachment = this.attachments.get(shell.id);
    if (!attachment) {
      deleteViewerSessionsByThreadId(this.db, threadId);
      return;
    }

    attachment.backendAttachment.dispose();
    deleteViewerSessionRecord(this.db, attachment.viewerId);
    deleteViewerSessionsByThreadId(this.db, threadId);
    this.attachments.delete(shell.id);

    updateShellSessionRecord(this.db, shell.id, {
      status: 'running',
      lastActivityAt: nowIso(),
    });

    this.emitShellEvent(shell.id, 'shell.detached', {
      threadId: shellThreadId(shell),
      state: 'detached',
      viewerId: attachment.viewerId,
    });
  }

  async attachShell(
    shellId: string,
    options: {
      cols: number;
      rows: number;
      onData: (data: string, options?: ShellOutputOptions) => void;
      onConnected?: (attachment: {
        viewerId: string;
        shell: ShellSessionDto;
      }) => void;
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
      existingAttachment.backendAttachment.dispose();
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

    const hasSession = await this.shellBackend.hasSession(shellSessionName(shell));
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
        'The terminal is no longer available.',
      );
    }

    const viewer = createViewerSessionRecord(this.db, {
      threadId,
      shellId: shell.id,
      activeTab: 'shell',
    });
    const attached = await this.shellBackend.attach(shellSessionName(shell), {
      cols: options.cols,
      rows: options.rows,
      onData: (data, session, backendOptions) => {
        updateShellSessionRecord(this.db, shell.id, {
          lastActivityAt: nowIso(),
        });
        updateViewerSessionRecord(this.db, viewer.id, {
          lastHeartbeatAt: nowIso(),
          activeTab: 'shell',
        });
        options.onData(
          data,
          shellOutputOptions({
            replace: backendOptions?.replace === true,
            cursorX: session.runtime.cursorX,
            cursorY: session.runtime.cursorY,
            paneHeight: session.runtime.paneHeight,
            cwdBaseName: basenameFromPath(session.runtime.currentPath || shell.cwd),
            envPrefix: session.runtime.envPrefix ?? undefined,
            isCommandRunning: session.runtime.isCommandRunning,
          }),
        );
      },
      onExit: () => {
        void this.handleMissingShell(shell, viewer.id);
      },
    });
    const initialSnapshot = attached.session.snapshot;
    const initialRuntime = attached.session.runtime;
    const initialCwdBaseName = basenameFromPath(initialRuntime.currentPath || shell.cwd);
    const attachment: ShellAttachment = {
      viewerId: viewer.id,
      onData: options.onData,
      backendAttachment: attached.attachment,
    };
    this.attachments.set(shell.id, attachment);

    updateShellSessionRecord(this.db, shell.id, {
      status: 'running',
      lastActivityAt: nowIso(),
    });

    const shellDto = await this.toShellSessionDto(shell.id);
    options.onConnected?.({
      viewerId: viewer.id,
      shell: shellDto,
    });

    if (initialSnapshot) {
      options.onData(
        initialSnapshot,
        shellOutputOptions({
          replace: true,
          cursorX: initialRuntime.cursorX,
          cursorY: initialRuntime.cursorY,
          paneHeight: initialRuntime.paneHeight,
          cwdBaseName: initialCwdBaseName,
          envPrefix: initialRuntime.envPrefix ?? undefined,
          isCommandRunning: initialRuntime.isCommandRunning,
        }),
      );
    }

    this.emitShellEvent(shell.id, 'shell.status', {
      threadId,
      state: 'attached',
      viewerId: viewer.id,
    });

    return {
      viewerId: viewer.id,
      shell: shellDto,
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

    attachment.backendAttachment.dispose();
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
    const { shell } = this.requireOwnedAttachment(shellId, viewerId);
    await this.shellBackend.sendInput(shellSessionName(shell), data);
    updateShellSessionRecord(this.db, shellId, {
      lastActivityAt: nowIso(),
    });
    updateViewerSessionRecord(this.db, viewerId, {
      lastHeartbeatAt: nowIso(),
      activeTab: 'shell',
    });
  }

  async clearShell(shellId: string, viewerId: string) {
    const { shell, attachment } = this.requireOwnedAttachment(shellId, viewerId);
    const sessionName = shellSessionName(shell);

    const session = await this.shellBackend.clear(sessionName);

    updateShellSessionRecord(this.db, shellId, {
      lastActivityAt: nowIso(),
    });
    updateViewerSessionRecord(this.db, viewerId, {
      lastHeartbeatAt: nowIso(),
      activeTab: 'shell',
    });

    attachment.onData(
      session.snapshot,
      shellOutputOptions({
        replace: true,
        cursorX: session.runtime.cursorX,
        cursorY: session.runtime.cursorY,
        paneHeight: session.runtime.paneHeight,
        cwdBaseName: basenameFromPath(session.runtime.currentPath || shell.cwd),
        envPrefix: session.runtime.envPrefix ?? undefined,
        isCommandRunning: session.runtime.isCommandRunning,
      }),
    );
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

    await this.shellBackend.resize(shellSessionName(shell), cols, rows);
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
      attachment.backendAttachment.dispose();
      deleteViewerSessionRecord(this.db, attachment.viewerId);
      this.attachments.delete(shell.id);
    }

    await this.shellBackend.killSession(shellSessionName(shell));
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
      label: shell.label ?? null,
      tmuxSessionName: shellSessionName(shell),
      backend: this.shellBackend.kind,
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

  private requireOwnedAttachment(shellId: string, viewerId: string) {
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

    return { shell, attachment };
  }

  private async handleMissingShell(
    shell: { id: string; threadId: string | null },
    viewerId: string,
  ) {
    const attachment = this.attachments.get(shell.id);
    if (attachment) {
      attachment.backendAttachment.dispose();
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

  private emitShellEvent<Type extends keyof ShellEventPayloadMap>(
    shellId: string,
    type: Type,
    payload: ShellEventPayloadMap[Type],
  ) {
    this.eventBus.emitShellEvent({
      type,
      shellId,
      timestamp: nowIso(),
      payload,
    } as ShellEventEnvelope);
  }
}
