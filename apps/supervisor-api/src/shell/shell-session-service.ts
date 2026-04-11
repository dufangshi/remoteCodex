import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
  onData: (data: string, options?: ShellOutputOptions) => void;
  pollHandle: NodeJS.Timeout;
  lastSnapshot: string;
  polling: boolean;
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

function waitForShellTick(milliseconds: number) {
  if (process.env.VITEST) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function basenameFromPath(filePath: string | null | undefined) {
  if (!filePath) {
    return '';
  }

  const normalized = filePath.replace(/[\\/]+$/, '');
  if (!normalized) {
    return '';
  }

  return path.basename(normalized) || normalized;
}

function isInteractiveShellCommand(command: string | null | undefined) {
  const normalized = (command ?? '').trim().toLowerCase();
  return new Set([
    'zsh',
    'bash',
    'sh',
    'dash',
    'ksh',
    'fish',
    'tcsh',
    'csh',
    'login',
  ]).has(normalized);
}

function extractEnvironmentValue(environmentText: string, key: string) {
  const marker = `${key}=`;
  const start = environmentText.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const valueStart = start + marker.length;
  const remainder = environmentText.slice(valueStart);
  const nextVariableMatch = remainder.match(/\s+[A-Z_][A-Z0-9_]*=/);
  const value = nextVariableMatch
    ? remainder.slice(0, nextVariableMatch.index)
    : remainder;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveEnvironmentPrefix(environmentText: string) {
  const condaPromptModifier = extractEnvironmentValue(
    environmentText,
    'CONDA_PROMPT_MODIFIER',
  );
  if (condaPromptModifier) {
    return condaPromptModifier.trim();
  }

  const condaDefaultEnv = extractEnvironmentValue(
    environmentText,
    'CONDA_DEFAULT_ENV',
  );
  if (condaDefaultEnv) {
    return `(${condaDefaultEnv})`;
  }

  const virtualEnvPrompt = extractEnvironmentValue(
    environmentText,
    'VIRTUAL_ENV_PROMPT',
  );
  if (virtualEnvPrompt) {
    return virtualEnvPrompt.trim();
  }

  const virtualEnvPath = extractEnvironmentValue(environmentText, 'VIRTUAL_ENV');
  if (virtualEnvPath) {
    const name = basenameFromPath(virtualEnvPath);
    if (name) {
      return `(${name})`;
    }
  }

  return null;
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function resolvePaneEnvironmentPrefix(
  tmuxManager: TmuxManager,
  sessionName: string,
  panePid: number,
) {
  const sessionPrefix = await tmuxManager.getSessionEnvironmentVariable(
    sessionName,
    'REMOTE_CODEX_ENV_PREFIX',
  );
  if (sessionPrefix) {
    return sessionPrefix;
  }

  try {
    const environment = await tmuxManager.readProcessEnvironment(panePid);
    return resolveEnvironmentPrefix(environment);
  } catch {
    return null;
  }
}

function buildShellPromptInitScriptContents(command: string) {
  const normalized = command.trim().toLowerCase();

  if (normalized === 'zsh') {
    return (
      [
        'export CONDA_CHANGEPS1=no VIRTUAL_ENV_DISABLE_PROMPT=1',
        'typeset -ga precmd_functions',
        '__remote_codex_env_prefix() {',
        '  if [[ -n "${CONDA_PROMPT_MODIFIER:-}" ]]; then',
        '    print -r -- "${CONDA_PROMPT_MODIFIER% }"',
        '  elif [[ -n "${CONDA_DEFAULT_ENV:-}" ]]; then',
        '    print -r -- "(${CONDA_DEFAULT_ENV})"',
        '  elif [[ -n "${VIRTUAL_ENV_PROMPT:-}" ]]; then',
        '    print -r -- "${VIRTUAL_ENV_PROMPT% }"',
        '  elif [[ -n "${VIRTUAL_ENV:-}" ]]; then',
        '    print -r -- "(${VIRTUAL_ENV:t})"',
        '  fi',
        '}',
        '__remote_codex_sync_tmux_env_prefix() {',
        '  local prefix="$(__remote_codex_env_prefix)"',
        '  local session_name=""',
        '  if [[ -n "${TMUX:-}" ]]; then',
        `    session_name="$(tmux display-message -p '#S' 2>/dev/null || true)"`,
        '    if [[ -n "$session_name" ]]; then',
        '      if [[ -n "$prefix" ]]; then',
        '        tmux set-environment -t "$session_name" REMOTE_CODEX_ENV_PREFIX "$prefix" >/dev/null 2>&1 || true',
        '      else',
        '        tmux set-environment -u -t "$session_name" REMOTE_CODEX_ENV_PREFIX >/dev/null 2>&1 || true',
        '      fi',
        '    fi',
        '  fi',
        '}',
        '__remote_codex_prompt_precmd() {',
        '  __remote_codex_sync_tmux_env_prefix',
        '  PROMPT="$ "',
        '  RPROMPT=""',
        '}',
        'if (( ${precmd_functions[(Ie)__remote_codex_prompt_precmd]} == 0 )); then precmd_functions+=(__remote_codex_prompt_precmd); fi',
        '__remote_codex_prompt_precmd',
        '',
      ].join('\n')
    );
  }

  return (
    [
      'export CONDA_CHANGEPS1=no VIRTUAL_ENV_DISABLE_PROMPT=1',
      '__remote_codex_env_prefix() {',
      '  if [ -n "${CONDA_PROMPT_MODIFIER:-}" ]; then',
      '    printf "%s" "${CONDA_PROMPT_MODIFIER% }"',
      '  elif [ -n "${CONDA_DEFAULT_ENV:-}" ]; then',
      '    printf "(%s)" "${CONDA_DEFAULT_ENV}"',
      '  elif [ -n "${VIRTUAL_ENV_PROMPT:-}" ]; then',
      '    printf "%s" "${VIRTUAL_ENV_PROMPT% }"',
      '  elif [ -n "${VIRTUAL_ENV:-}" ]; then',
      '    printf "(%s)" "${VIRTUAL_ENV##*/}"',
      '  fi',
      '}',
      '__remote_codex_sync_tmux_env_prefix() {',
      '  prefix="$(__remote_codex_env_prefix)"',
      '  session_name=""',
      '  if [ -n "${TMUX:-}" ]; then',
      `    session_name="$(tmux display-message -p '#S' 2>/dev/null || true)"`,
      '    if [ -n "$session_name" ]; then',
      '      if [ -n "$prefix" ]; then',
      '        tmux set-environment -t "$session_name" REMOTE_CODEX_ENV_PREFIX "$prefix" >/dev/null 2>&1 || true',
      '      else',
      '        tmux set-environment -u -t "$session_name" REMOTE_CODEX_ENV_PREFIX >/dev/null 2>&1 || true',
      '      fi',
      '    fi',
      '  fi',
      '}',
      '__remote_codex_prompt_precmd() {',
      '  __remote_codex_sync_tmux_env_prefix',
      '  PS1="$ "',
      '}',
      'case ";$PROMPT_COMMAND;" in',
      '  *";__remote_codex_prompt_precmd;"*) ;;',
      '  *) PROMPT_COMMAND="__remote_codex_prompt_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;',
      'esac',
      '__remote_codex_prompt_precmd',
      '',
    ].join('\n')
  );
}

async function ensureShellPromptInitScript(command: string) {
  const normalized = command.trim().toLowerCase();
  const extension = normalized === 'zsh' ? 'zsh' : 'sh';
  const filePath = path.join(
    os.tmpdir(),
    `remote-codex-shell-prompt.${extension}`,
  );
  await fs.writeFile(filePath, buildShellPromptInitScriptContents(command), 'utf8');
  return filePath;
}

async function buildShellPromptInitCommand(
  command: string,
  options: { clearScreen?: boolean } = {},
) {
  const scriptPath = await ensureShellPromptInitScript(command);
  const normalized = command.trim().toLowerCase();
  const sourceCommand =
    normalized === 'zsh'
      ? `source ${shellSingleQuote(scriptPath)} >/dev/null 2>&1`
      : `. ${shellSingleQuote(scriptPath)} >/dev/null 2>&1`;

  return options.clearScreen ? `${sourceCommand}\nclear\n` : `${sourceCommand}\n`;
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
        try {
          const runtime = await this.tmuxManager.getPaneRuntimeInfo(tmuxSessionName);
          if (isInteractiveShellCommand(runtime.currentCommand)) {
            await this.tmuxManager.sendInput(
              tmuxSessionName,
              await buildShellPromptInitCommand(runtime.currentCommand, {
                clearScreen: true,
              }),
            );
            await waitForShellTick(120);
          }
        } catch {
          // The shell can lag a moment behind the tmux session coming up.
          // Failing prompt initialization must not fail shell creation.
        }
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

    clearInterval(attachment.pollHandle);
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
    const initialRuntime = await this.tmuxManager.getPaneRuntimeInfo(
      shellSessionName(shell),
    );
    const initialCwdBaseName = basenameFromPath(initialRuntime.currentPath || shell.cwd);
    const initialEnvPrefix = await resolvePaneEnvironmentPrefix(
      this.tmuxManager,
      shellSessionName(shell),
      initialRuntime.panePid,
    );
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
          cursorX: initialRuntime.cursorX,
          cursorY: initialRuntime.cursorY,
          paneHeight: initialRuntime.paneHeight,
          cwdBaseName: initialCwdBaseName,
          envPrefix: initialEnvPrefix ?? undefined,
          isCommandRunning: !isInteractiveShellCommand(
            initialRuntime.currentCommand,
          ),
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
    const { shell } = this.requireOwnedAttachment(shellId, viewerId);
    await this.tmuxManager.sendInput(shellSessionName(shell), data);
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

    await this.tmuxManager.sendInput(sessionName, '\u000c');
    await waitForShellTick(60);
    await this.tmuxManager.clearHistory(sessionName);
    await waitForShellTick(60);

    updateShellSessionRecord(this.db, shellId, {
      lastActivityAt: nowIso(),
    });
    updateViewerSessionRecord(this.db, viewerId, {
      lastHeartbeatAt: nowIso(),
      activeTab: 'shell',
    });

    await this.pushSnapshot(shell, attachment);
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
      await this.pushSnapshot(shell, attachment);
    } finally {
      attachment.polling = false;
    }
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

  private async pushSnapshot(
    shell: {
      id: string;
      cwd: string;
      tmuxSessionName: string | null;
    },
    attachment: ShellAttachment,
  ) {
    const sessionName = shellSessionName(shell);
    const snapshot = await this.tmuxManager.capturePane(sessionName);
    const runtime = await this.tmuxManager.getPaneRuntimeInfo(sessionName);
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
        cursorX: runtime.cursorX,
        cursorY: runtime.cursorY,
        paneHeight: runtime.paneHeight,
        cwdBaseName: basenameFromPath(runtime.currentPath || shell.cwd),
        envPrefix:
          (await resolvePaneEnvironmentPrefix(
            this.tmuxManager,
            sessionName,
            runtime.panePid,
          )) ?? undefined,
        isCommandRunning: !isInteractiveShellCommand(runtime.currentCommand),
      }),
    );
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
