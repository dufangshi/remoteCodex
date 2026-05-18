import type {
  ApplyCodexHostConfigArchiveResultDto,
  ApiErrorShape,
  CodexHostConfigArchiveDto,
  CodexHostFileDto,
  CodexHostFileNameDto,
  CodexStatusDto,
  CreateCodexHostConfigArchiveInput,
  CreateThreadInput,
  ExportThreadPdfInput,
  ThreadExportFormatDto,
  ForkThreadInput,
  CreateWorkspaceInput,
  HealthDto,
  ImportThreadInput,
  PromptAttachmentManifestEntryDto,
  InterruptTurnInput,
  ModelOptionDto,
  RespondThreadActionRequestInput,
  ResumeThreadInput,
  RuntimeConfigDto,
  SendThreadPromptInput,
  ShellEventEnvelope,
  ShellSessionDto,
  SupervisorConnectedEnvelope,
  SupervisorSocketClientEnvelope,
  SupervisorSocketServerEnvelope,
  ThreadDetailDto,
  ThreadExportTurnOptionsDto,
  ThreadHistoryItemDetailDto,
  ThreadGoalDto,
  UpdateThreadGoalInput,
  ThreadMcpServersDto,
  ThreadSkillsDto,
  ThreadDto,
  ThreadEventEnvelope,
  ThreadForkResultDto,
  ThreadForkTurnOptionDto,
  ThreadShellStateDto,
  RenameCodexHostConfigArchiveInput,
  UpdateThreadSettingsInput,
  UpdateCodexHostFileInput,
  UpdateThreadInput,
  UpdateWorkspaceSettingsInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceFavoriteInput,
  WorkspaceDto,
  WorkspaceSettingsDto,
} from '../../../../packages/shared/src/index';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly payload: ApiErrorShape
  ) {
    super(payload.message);
  }
}

export interface FileDownloadResult {
  blob: Blob;
  filename: string;
}

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    headers,
    ...init
  });

  if (!response.ok) {
    const payload = (await response.json()) as ApiErrorShape;
    throw new ApiError(response.status, payload);
  }

  return (await response.json()) as T;
}

function fallbackDownloadFilename(input: RequestInfo | URL) {
  const url = String(input);
  if (!url.includes('/exports/pdf')) {
    return 'download';
  }

  return url.includes('format=html')
    ? 'remote-codex-transcript.html'
    : 'remote-codex-transcript.pdf';
}

function parseContentDispositionFilename(value: string | null) {
  if (!value) {
    return null;
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const quotedMatch = value.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const plainMatch = value.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}

async function downloadFile(input: RequestInfo | URL, init?: RequestInit): Promise<FileDownloadResult> {
  const response = await fetch(input, init);

  if (!response.ok) {
    let payload: ApiErrorShape | null = null;
    try {
      payload = (await response.json()) as ApiErrorShape;
    } catch {
      payload = null;
    }

    throw new ApiError(response.status, payload ?? {
      code: 'internal_error',
      message: 'Unable to download file.',
    });
  }

  const filename =
    parseContentDispositionFilename(response.headers.get('content-disposition')) ??
    fallbackDownloadFilename(input);

  return {
    blob: await response.blob(),
    filename,
  };
}

export interface PromptAttachmentUpload
  extends PromptAttachmentManifestEntryDto {
  file: File;
}

export interface SendThreadPromptRequestInput extends SendThreadPromptInput {
  attachments?: PromptAttachmentUpload[];
}

function normalizedUploadFileName(attachment: PromptAttachmentUpload, index: number) {
  const explicitName = attachment.originalName.trim();
  if (explicitName) {
    return explicitName;
  }

  const fileName = attachment.file.name.trim();
  if (fileName) {
    return fileName;
  }

  return attachment.kind === 'photo' ? `photo-${index + 1}.jpg` : `file-${index + 1}`;
}

export function fetchRuntimeConfig() {
  return request<RuntimeConfigDto>('/api/config/runtime');
}

export function fetchWorkspaceSettings() {
  return request<WorkspaceSettingsDto>('/api/config/workspace-settings', {
    cache: 'no-store',
  });
}

export function updateWorkspaceSettings(input: UpdateWorkspaceSettingsInput) {
  return request<WorkspaceSettingsDto>('/api/config/workspace-settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function fetchCodexHostFile(name: CodexHostFileNameDto) {
  return request<CodexHostFileDto>(`/api/config/codex-files/${encodeURIComponent(name)}`, {
    cache: 'no-store',
  });
}

export function updateCodexHostFile(
  name: CodexHostFileNameDto,
  input: UpdateCodexHostFileInput,
) {
  return request<CodexHostFileDto>(`/api/config/codex-files/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function fetchCodexHostConfigArchives() {
  return request<CodexHostConfigArchiveDto[]>('/api/config/codex-archives', {
    cache: 'no-store',
  });
}

export function createCodexHostConfigArchive(input: CreateCodexHostConfigArchiveInput = {}) {
  return request<CodexHostConfigArchiveDto>('/api/config/codex-archives', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function renameCodexHostConfigArchive(
  id: string,
  input: RenameCodexHostConfigArchiveInput,
) {
  return request<CodexHostConfigArchiveDto>(
    `/api/config/codex-archives/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export function applyCodexHostConfigArchive(id: string) {
  return request<ApplyCodexHostConfigArchiveResultDto>(
    `/api/config/codex-archives/${encodeURIComponent(id)}/apply`,
    {
      method: 'POST',
    },
  );
}

export function fetchCodexStatus() {
  return request<CodexStatusDto>('/api/codex/status');
}

export function restartCodexAppServer() {
  return request<CodexStatusDto>('/api/codex/restart', {
    method: 'POST',
  });
}

export function buildAndRestartService() {
  return request<{ status: 'launched'; pid: number | null; message: string }>(
    '/api/codex/build-restart',
    {
      method: 'POST',
    },
  );
}

export function fetchCodexModels() {
  return request<ModelOptionDto[]>('/api/codex/models');
}

export function fetchSupervisorHealth() {
  return request<HealthDto>('/healthz', {
    cache: 'no-store'
  });
}

export function fetchWorkspaces() {
  return request<WorkspaceDto[]>('/api/workspaces');
}

export function fetchThreads() {
  return request<ThreadDto[]>('/api/threads');
}

export function fetchThreadDetail(
  id: string,
  options: { limit?: number; beforeTurnId?: string } = {},
) {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options.beforeTurnId) {
    params.set('beforeTurnId', options.beforeTurnId);
  }

  return request<ThreadDetailDto>(
    `/api/threads/${id}${params.size > 0 ? `?${params.toString()}` : ''}`,
  );
}

export function fetchThreadHistoryItemDetail(id: string, itemId: string) {
  return request<ThreadHistoryItemDetailDto>(
    `/api/threads/${id}/items/${encodeURIComponent(itemId)}/detail`,
  );
}

export function fetchThreadExportTurns(id: string) {
  return request<ThreadExportTurnOptionsDto>(`/api/threads/${id}/export-turns`, {
    cache: 'no-store',
  });
}

export function buildThreadPdfExportUrl(id: string, input: ExportThreadPdfInput) {
  const params = new URLSearchParams();
  if (input.format !== undefined) {
    params.set('format', input.format);
  }
  params.set('mode', input.mode);
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.turnIds !== undefined) {
    params.set('turnIds', input.turnIds.join(','));
  }
  if (input.profile !== undefined) {
    params.set('profile', input.profile);
  }
  if (input.options?.includeTokenAndPrice !== undefined) {
    params.set('includeTokenAndPrice', String(input.options.includeTokenAndPrice));
  }
  if (input.options?.includeCommandOutput !== undefined) {
    params.set('includeCommandOutput', String(input.options.includeCommandOutput));
  }
  if (input.options?.includeAbsolutePaths !== undefined) {
    params.set('includeAbsolutePaths', String(input.options.includeAbsolutePaths));
  }

  return `/api/threads/${encodeURIComponent(id)}/exports/pdf?${params.toString()}`;
}

export function downloadThreadPdfExport(id: string, input: ExportThreadPdfInput) {
  return downloadFile(buildThreadPdfExportUrl(id, input), {
    cache: 'no-store',
  });
}

export function downloadThreadTranscriptExport(
  id: string,
  input: ExportThreadPdfInput & { format?: ThreadExportFormatDto },
) {
  return downloadFile(buildThreadPdfExportUrl(id, input), {
    cache: 'no-store',
  });
}

export function fetchThreadShellState(id: string) {
  return request<ThreadShellStateDto>(`/api/threads/${id}/shell`);
}

export function createThread(input: CreateThreadInput) {
  return request<ThreadDto>('/api/threads/start', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function importThread(sessionId: ImportThreadInput['sessionId']) {
  return request<ThreadDetailDto>('/api/threads/import', {
    method: 'POST',
    body: JSON.stringify({ sessionId })
  });
}

export function createThreadShell(id: string, input: { cols?: number; rows?: number } = {}) {
  return request<ThreadShellStateDto>(`/api/threads/${id}/shell`, {
    method: 'POST',
    ...(Object.keys(input).length > 0 ? { body: JSON.stringify(input) } : {})
  });
}

export function terminateShell(id: string) {
  return request<ShellSessionDto>(`/api/shells/${id}/terminate`, {
    method: 'POST'
  });
}

export function resumeThread(id: string, input: ResumeThreadInput = {}) {
  return request<ThreadDetailDto>(`/api/threads/${id}/resume`, {
    method: 'POST',
    ...(Object.keys(input).length > 0 ? { body: JSON.stringify(input) } : {})
  });
}

export function disconnectThread(id: string) {
  return request<ThreadDetailDto>(`/api/threads/${id}/disconnect`, {
    method: 'POST'
  });
}

export function sendThreadPrompt(id: string, input: SendThreadPromptRequestInput) {
  const attachments = input.attachments ?? [];

  if (attachments.length === 0) {
    return request<ThreadDto>(`/api/threads/${id}/prompt`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  const formData = new FormData();
  formData.append('prompt', input.prompt);
  if (input.clientRequestId !== undefined) {
    formData.append('clientRequestId', input.clientRequestId);
  }
  if (input.model !== undefined) {
    formData.append('model', input.model);
  }
  if (input.reasoningEffort !== undefined && input.reasoningEffort !== null) {
    formData.append('reasoningEffort', input.reasoningEffort);
  }
  if (input.collaborationMode !== undefined) {
    formData.append('collaborationMode', input.collaborationMode);
  }
  if (input.sandboxMode !== undefined && input.sandboxMode !== null) {
    formData.append('sandboxMode', input.sandboxMode);
  }

  const manifest: PromptAttachmentManifestEntryDto[] = attachments.map(
    (attachment, index) => ({
      clientId: attachment.clientId,
      kind: attachment.kind,
      originalName: normalizedUploadFileName(attachment, index),
      placeholder: attachment.placeholder,
    }),
  );
  formData.append('attachmentManifest', JSON.stringify(manifest));
  for (const [index, attachment] of attachments.entries()) {
    formData.append(
      'attachments',
      attachment.file,
      normalizedUploadFileName(attachment, index),
    );
  }

  return request<ThreadDto>(`/api/threads/${id}/prompt`, {
    method: 'POST',
    body: formData
  });
}

export function interruptThread(id: string, input: InterruptTurnInput = {}) {
  return request<ThreadDto>(`/api/threads/${id}/interrupt`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function updateThread(id: string, input: UpdateThreadInput) {
  return request<ThreadDto>(`/api/threads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function deleteThread(id: string) {
  return request<{ id: string }>(`/api/threads/${id}`, {
    method: 'DELETE'
  });
}

export function updateThreadSettings(id: string, input: UpdateThreadSettingsInput) {
  return request<ThreadDto>(`/api/threads/${id}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function compactThread(id: string) {
  return request<ThreadDto>(`/api/threads/${id}/compact`, {
    method: 'POST',
  });
}

export function fetchThreadGoal(id: string) {
  return request<{ goal: ThreadGoalDto | null }>(`/api/threads/${id}/goal`, {
    cache: 'no-store',
  });
}

export function updateThreadGoal(id: string, input: UpdateThreadGoalInput) {
  return request<{ goal: ThreadGoalDto | null }>(`/api/threads/${id}/goal`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function clearThreadGoal(id: string) {
  return request<{ cleared: boolean; goalHistory?: ThreadGoalDto[] }>(`/api/threads/${id}/goal`, {
    method: 'DELETE',
  });
}

export function fetchThreadForkTurns(id: string) {
  return request<ThreadForkTurnOptionDto[]>(`/api/threads/${id}/fork-turns`, {
    cache: 'no-store',
  });
}

export function forkThread(id: string, input: ForkThreadInput) {
  return request<ThreadForkResultDto>(`/api/threads/${id}/fork`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchThreadSkills(id: string) {
  return request<ThreadSkillsDto>(`/api/threads/${id}/skills`, {
    cache: 'no-store',
  });
}

export function fetchThreadMcpServers(id: string) {
  return request<ThreadMcpServersDto>(`/api/threads/${id}/mcp-servers`, {
    cache: 'no-store',
  });
}

export function respondToThreadRequest(
  id: string,
  requestId: string,
  input: RespondThreadActionRequestInput
) {
  return request<ThreadDetailDto>(`/api/threads/${id}/requests/${encodeURIComponent(requestId)}/respond`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function createWorkspace(input: CreateWorkspaceInput) {
  return request<WorkspaceDto>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function updateWorkspace(id: string, input: UpdateWorkspaceInput) {
  return request<WorkspaceDto>(`/api/workspaces/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function deleteWorkspace(id: string) {
  return request<{ id: string }>(`/api/workspaces/${id}`, {
    method: 'DELETE'
  });
}

export function updateWorkspaceFavorite(id: string, input: UpdateWorkspaceFavoriteInput) {
  return request<WorkspaceDto>(`/api/workspaces/${id}/favorite`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function connectSupervisorEvents(onEvent: (event: ThreadEventEnvelope) => void) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isLocalViteSession =
    import.meta.env.DEV &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const socketHost = isLocalViteSession ? '127.0.0.1:8787' : window.location.host;
  const socket = new WebSocket(`${protocol}//${socketHost}/ws`);

  socket.addEventListener('message', (message) => {
    try {
      const parsed = JSON.parse(message.data as string) as SupervisorSocketServerEnvelope;
      if ('threadId' in parsed && parsed.type.startsWith('thread.')) {
        onEvent(parsed);
      }
    } catch {
      // Ignore malformed socket payloads.
    }
  });

  return socket;
}

export function connectShellSocket(
  handlers: {
    onConnected?: (event: SupervisorConnectedEnvelope) => void;
    onShellEvent?: (event: ShellEventEnvelope) => void;
  } = {}
) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isLocalViteSession =
    import.meta.env.DEV &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const socketHost = isLocalViteSession ? '127.0.0.1:8787' : window.location.host;
  const socket = new WebSocket(`${protocol}//${socketHost}/ws`);

  socket.addEventListener('message', (message) => {
    try {
      const parsed = JSON.parse(message.data as string) as SupervisorSocketServerEnvelope;
      if (parsed.type === 'supervisor.connected') {
        handlers.onConnected?.(parsed);
        return;
      }
      if ('shellId' in parsed && parsed.type.startsWith('shell.')) {
        handlers.onShellEvent?.(parsed);
      }
    } catch {
      // Ignore malformed socket payloads.
    }
  });

  return {
    socket,
    send(message: SupervisorSocketClientEnvelope) {
      socket.send(JSON.stringify(message));
    }
  };
}
