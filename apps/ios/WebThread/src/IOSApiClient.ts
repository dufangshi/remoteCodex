import type {
  ApplyProviderHostConfigArchiveResultDto,
  ApiErrorShape,
  AgentBackendDto,
  AgentBackendIdDto,
  AgentSubscriptionUsageDto,
  CreateProviderHostConfigArchiveInput,
  CreateRelaySessionShareInput,
  CreateThreadHookInput,
  CreateThreadInput,
  ExportThreadPdfInput,
  ForkThreadInput,
  ModelOptionDto,
  PluginDto,
  ProviderHostConfigArchiveDto,
  ProviderHostFileDto,
  RelayEffectiveAccessDto,
  RelayPortalSummaryDto,
  RelaySessionShareDto,
  RenameProviderHostConfigArchiveInput,
  RespondThreadActionRequestInput,
  ThreadDetailDto,
  ThreadDto,
  ThreadExportFormatDto,
  ThreadForkResultDto,
  ThreadForkTurnOptionDto,
  ThreadExportTurnOptionsDto,
  ThreadHistoryItemDetailDto,
  ThreadGoalDto,
  ThreadWorkspaceFilePreviewDto,
  ThreadWorkspaceTreeNodeDto,
  ThreadWorkspaceUploadResultDto,
  ThreadShellStateDto,
  ThreadHooksDto,
  ThreadMcpServersDto,
  ThreadSkillsDto,
  ShellSessionDto,
  UpdatePluginInput,
  UpdateProviderHostFileInput,
  UpdateShellInput,
  UpdateThreadHookInput,
  TrustThreadHookInput,
  UntrustThreadHookInput,
  UpdateThreadSettingsInput,
  UpdateThreadGoalInput,
  WorkspaceFileDto,
  WorkspaceDto,
} from '@remote-codex/shared';
import type { IOSBootstrap } from './IOSBootstrap';
import { supervisorApiUrl } from './IOSConnection';

export class IOSApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly payload: ApiErrorShape,
  ) {
    super(payload.message);
  }
}

export interface IOSDownloadedFile {
  blob: Blob;
  filename: string;
  contentType: string;
}

function authHeaders(bootstrap: IOSBootstrap) {
  const headers = new Headers();
  if (bootstrap.authToken) {
    headers.set('authorization', `Bearer ${bootstrap.authToken}`);
  }
  return headers;
}

async function readError(response: Response): Promise<ApiErrorShape> {
  const fallback = `Request failed (${response.status}).`;
  try {
    const payload = (await response.json()) as Partial<ApiErrorShape>;
    return {
      code: payload.code ?? 'internal_error',
      message: payload.message ?? fallback,
      ...(payload.details ? { details: payload.details } : {}),
    };
  } catch {
    return {
      code: 'internal_error',
      message: fallback,
    };
  }
}

function filenameFromContentDisposition(value: string | null, fallback: string) {
  if (!value) {
    return fallback;
  }

  const encodedMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].trim());
    } catch {
      return encodedMatch[1].trim();
    }
  }

  const quotedMatch = value.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const plainMatch = value.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || fallback;
}

function buildExportQuery(input: ExportThreadPdfInput) {
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
    params.set(
      'includeTokenAndPrice',
      String(input.options.includeTokenAndPrice),
    );
  }
  if (input.options?.includeCommandOutput !== undefined) {
    params.set(
      'includeCommandOutput',
      String(input.options.includeCommandOutput),
    );
  }
  if (input.options?.includeAbsolutePaths !== undefined) {
    params.set(
      'includeAbsolutePaths',
      String(input.options.includeAbsolutePaths),
    );
  }
  return params.toString();
}

function buildWorkspacePreviewQuery(input: {
  path: string;
  offset?: number;
  limit?: number;
}) {
  const params = new URLSearchParams({ path: input.path });
  if (input.offset !== undefined) {
    params.set('offset', String(input.offset));
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  return params.toString();
}

function buildWorkspaceFileQuery(input: { path: string }) {
  return new URLSearchParams({ path: input.path }).toString();
}

function buildBrowserAssetQuery(
  bootstrap: IOSBootstrap,
  input: { path: string },
) {
  const params = new URLSearchParams({ path: input.path });
  if (bootstrap.authToken) {
    params.set(bootstrap.mode === 'relay' ? 'relaySession' : 'token', bootstrap.authToken);
  }
  return params.toString();
}

export class IOSApiClient {
  constructor(private readonly bootstrap: IOSBootstrap) {}

  async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = authHeaders(this.bootstrap);
    const provided = new Headers(init.headers);
    provided.forEach((value, key) => headers.set(key, value));
    if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const response = await fetch(supervisorApiUrl(this.bootstrap, path), {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new IOSApiError(response.status, await readError(response));
    }

    return (await response.json()) as T;
  }

  async requestDownload(
    path: string,
    init: RequestInit = {},
    fallbackFilename = 'download',
  ): Promise<IOSDownloadedFile> {
    const headers = authHeaders(this.bootstrap);
    const provided = new Headers(init.headers);
    provided.forEach((value, key) => headers.set(key, value));

    const response = await fetch(supervisorApiUrl(this.bootstrap, path), {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new IOSApiError(response.status, await readError(response));
    }

    const blob = await response.blob();
    return {
      blob,
      filename: filenameFromContentDisposition(
        response.headers.get('content-disposition'),
        fallbackFilename,
      ),
      contentType:
        response.headers.get('content-type') ||
        blob.type ||
        'application/octet-stream',
    };
  }

  listThreads() {
    return this.requestJson<ThreadDto[]>('/api/threads');
  }

  listWorkspaces() {
    return this.requestJson<WorkspaceDto[]>('/api/workspaces', {
      cache: 'no-store',
    });
  }

  fetchAgentSubscriptionUsage(provider: AgentBackendIdDto) {
    return this.requestJson<{ usage: AgentSubscriptionUsageDto | null }>(
      `/api/agent-runtimes/${encodeURIComponent(provider)}/subscription-usage`,
      { cache: 'no-store' },
    );
  }

  listAgentRuntimes() {
    return this.requestJson<AgentBackendDto[]>('/api/agent-runtimes', {
      cache: 'no-store',
    });
  }

  fetchThreadDetail(
    threadId: string,
    input: number | { limit?: number; beforeTurnId?: string | null } = 30,
  ) {
    const params = new URLSearchParams();
    if (typeof input === 'number') {
      params.set('limit', String(input));
    } else {
      if (input.limit !== undefined) {
        params.set('limit', String(input.limit));
      }
      if (input.beforeTurnId) {
        params.set('beforeTurnId', input.beforeTurnId);
      }
    }
    const query = params.toString();
    return this.requestJson<ThreadDetailDto>(
      `/api/threads/${encodeURIComponent(threadId)}${query ? `?${query}` : ''}`,
    );
  }

  listAgents(provider: ThreadDto['provider']) {
    return this.requestJson<ModelOptionDto[]>(
      `/api/agent-runtimes/${encodeURIComponent(provider)}/agents`,
      { cache: 'no-store' },
    );
  }

  listModels(
    provider: ThreadDto['provider'],
    options: { agentId?: string | null; cwd?: string | null } = {},
  ) {
    const params = new URLSearchParams();
    if (options.agentId) {
      params.set('agentId', options.agentId);
    }
    if (options.cwd) {
      params.set('cwd', options.cwd);
    }
    const query = params.toString();
    return this.requestJson<ModelOptionDto[]>(
      `/api/agent-runtimes/${encodeURIComponent(provider)}/models${query ? `?${query}` : ''}`,
      { cache: 'no-store' },
    );
  }

  installAgentAdapter(provider: ThreadDto['provider'], modelId: string) {
    return this.requestJson<AgentBackendDto>(
      `/api/agent-runtimes/${encodeURIComponent(provider)}/install`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'install', modelId }),
      },
    );
  }

  listPlugins() {
    return this.requestJson<PluginDto[]>('/api/plugins', { cache: 'no-store' });
  }

  updatePlugin(pluginId: string, input: UpdatePluginInput) {
    return this.requestJson<PluginDto>(`/api/plugins/${encodeURIComponent(pluginId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  fetchProviderHostFile(provider: ThreadDto['provider'], name: string) {
    return this.requestJson<ProviderHostFileDto>(
      `/api/config/providers/${encodeURIComponent(provider)}/files/${encodeURIComponent(name)}`,
      { cache: 'no-store' },
    );
  }

  updateProviderHostFile(
    provider: ThreadDto['provider'],
    name: string,
    input: UpdateProviderHostFileInput,
  ) {
    return this.requestJson<ProviderHostFileDto>(
      `/api/config/providers/${encodeURIComponent(provider)}/files/${encodeURIComponent(name)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
  }

  restartAgentBackend(provider: ThreadDto['provider']) {
    return this.requestJson<AgentBackendDto>(
      `/api/agent-runtimes/${encodeURIComponent(provider)}/restart`,
      { method: 'POST' },
    );
  }

  installOrUpdateAgentBackend(
    provider: ThreadDto['provider'],
    action: 'install' | 'update',
  ) {
    return this.requestJson<AgentBackendDto>(
      `/api/agent-runtimes/${encodeURIComponent(provider)}/install`,
      { method: 'POST', body: JSON.stringify({ action }) },
    );
  }

  buildAndRestartService() {
    return this.requestJson<{ status: 'launched'; pid: number | null; message: string }>(
      '/api/service/build-restart',
      { method: 'POST' },
    );
  }

  fetchProviderHostConfigArchives(provider: ThreadDto['provider']) {
    return this.requestJson<ProviderHostConfigArchiveDto[]>(
      `/api/config/providers/${encodeURIComponent(provider)}/archives`,
      { cache: 'no-store' },
    );
  }

  createProviderHostConfigArchive(
    provider: ThreadDto['provider'],
    input: CreateProviderHostConfigArchiveInput = {},
  ) {
    return this.requestJson<ProviderHostConfigArchiveDto>(
      `/api/config/providers/${encodeURIComponent(provider)}/archives`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  renameProviderHostConfigArchive(
    provider: ThreadDto['provider'],
    id: string,
    input: RenameProviderHostConfigArchiveInput,
  ) {
    return this.requestJson<ProviderHostConfigArchiveDto>(
      `/api/config/providers/${encodeURIComponent(provider)}/archives/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
  }

  applyProviderHostConfigArchive(provider: ThreadDto['provider'], id: string) {
    return this.requestJson<ApplyProviderHostConfigArchiveResultDto>(
      `/api/config/providers/${encodeURIComponent(provider)}/archives/${encodeURIComponent(id)}/apply`,
      { method: 'POST' },
    );
  }

  fetchThreadSkills(threadId: string) {
    return this.requestJson<ThreadSkillsDto>(
      `/api/threads/${encodeURIComponent(threadId)}/skills`,
      { cache: 'no-store' },
    );
  }

  fetchThreadMcpServers(threadId: string) {
    return this.requestJson<ThreadMcpServersDto>(
      `/api/threads/${encodeURIComponent(threadId)}/mcp-servers`,
      { cache: 'no-store' },
    );
  }

  fetchThreadHooks(threadId: string) {
    return this.requestJson<ThreadHooksDto>(
      `/api/threads/${encodeURIComponent(threadId)}/hooks`,
      { cache: 'no-store' },
    );
  }

  createThreadHook(threadId: string, input: CreateThreadHookInput) {
    return this.requestJson<ThreadHooksDto>(`/api/threads/${encodeURIComponent(threadId)}/hooks`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  updateThreadHook(threadId: string, input: UpdateThreadHookInput) {
    return this.requestJson<ThreadHooksDto>(`/api/threads/${encodeURIComponent(threadId)}/hooks`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  trustThreadHook(threadId: string, input: TrustThreadHookInput) {
    return this.requestJson<ThreadHooksDto>(
      `/api/threads/${encodeURIComponent(threadId)}/hooks/trust`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  untrustThreadHook(threadId: string, input: UntrustThreadHookInput) {
    return this.requestJson<ThreadHooksDto>(
      `/api/threads/${encodeURIComponent(threadId)}/hooks/untrust`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  fetchThreadShellState(threadId: string) {
    return this.requestJson<ThreadShellStateDto>(
      `/api/threads/${encodeURIComponent(threadId)}/shell`,
      { cache: 'no-store' },
    );
  }

  createThreadShell(
    threadId: string,
    input: { cols?: number; rows?: number; label?: string } = {},
  ) {
    return this.requestJson<ThreadShellStateDto>(
      `/api/threads/${encodeURIComponent(threadId)}/shell`,
      {
        method: 'POST',
        ...(Object.keys(input).length > 0 ? { body: JSON.stringify(input) } : {}),
      },
    );
  }

  terminateShell(shellId: string) {
    return this.requestJson<ShellSessionDto>(
      `/api/shells/${encodeURIComponent(shellId)}/terminate`,
      { method: 'POST' },
    );
  }

  updateShell(shellId: string, input: UpdateShellInput) {
    return this.requestJson<ShellSessionDto>(`/api/shells/${encodeURIComponent(shellId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  createThread(input: CreateThreadInput) {
    return this.requestJson<ThreadDto>('/api/threads/start', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  updateThreadSettings(
    threadId: string,
    input: UpdateThreadSettingsInput,
  ) {
    return this.requestJson<ThreadDto>(
      `/api/threads/${encodeURIComponent(threadId)}/settings`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    );
  }

  fetchThreadGoal(threadId: string) {
    return this.requestJson<{ goal: ThreadGoalDto | null }>(
      `/api/threads/${encodeURIComponent(threadId)}/goal`,
      { cache: 'no-store' },
    );
  }

  updateThreadGoal(threadId: string, input: UpdateThreadGoalInput) {
    return this.requestJson<{ goal: ThreadGoalDto | null }>(
      `/api/threads/${encodeURIComponent(threadId)}/goal`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
  }

  renameThread(threadId: string, title: string) {
    return this.requestJson<ThreadDto>(
      `/api/threads/${encodeURIComponent(threadId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      },
    );
  }

  deleteThread(threadId: string) {
    return this.requestJson<{ id: string }>(
      `/api/threads/${encodeURIComponent(threadId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  cancelPendingSteer(threadId: string, pendingSteerId: string) {
    return this.requestJson<ThreadDetailDto>(
      `/api/threads/${encodeURIComponent(threadId)}/pending-steers/${encodeURIComponent(pendingSteerId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  steerPendingPrompt(threadId: string, pendingSteerId: string) {
    return this.requestJson<ThreadDetailDto>(
      `/api/threads/${encodeURIComponent(threadId)}/pending-steers/${encodeURIComponent(pendingSteerId)}/steer`,
      { method: 'POST' },
    );
  }

  interruptThread(threadId: string, turnId?: string | null) {
    return this.requestJson<ThreadDto>(
      `/api/threads/${encodeURIComponent(threadId)}/interrupt`,
      {
        method: 'POST',
        body: JSON.stringify(turnId ? { turnId } : {}),
      },
    );
  }

  sendPrompt(threadId: string, prompt: string) {
    return this.requestJson<ThreadDto>(
      `/api/threads/${encodeURIComponent(threadId)}/prompt`,
      {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          clientRequestId:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `ios-web-${Date.now()}`,
        }),
      },
    );
  }

  respondToRequest(
    threadId: string,
    requestId: string,
    input: RespondThreadActionRequestInput,
  ) {
    return this.requestJson<ThreadDetailDto>(
      `/api/threads/${encodeURIComponent(threadId)}/requests/${encodeURIComponent(requestId)}/respond`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  fetchHistoryItemDetail(threadId: string, itemId: string) {
    return this.requestJson<ThreadHistoryItemDetailDto>(
      `/api/threads/${encodeURIComponent(threadId)}/items/${encodeURIComponent(itemId)}/detail`,
    );
  }

  fetchThreadExportTurns(threadId: string) {
    return this.requestJson<ThreadExportTurnOptionsDto>(
      `/api/threads/${encodeURIComponent(threadId)}/export-turns`,
      { cache: 'no-store' },
    );
  }

  fetchRelayPortal() {
    return this.requestJson<RelayPortalSummaryDto>('/relay/portal', {
      cache: 'no-store',
    });
  }

  fetchRelayAccess(input: {
    deviceId: string;
    threadId?: string | null;
    workspaceId?: string | null;
  }) {
    const params = new URLSearchParams({
      deviceId: input.deviceId,
    });
    if (input.threadId) {
      params.set('threadId', input.threadId);
    }
    if (input.workspaceId) {
      params.set('workspaceId', input.workspaceId);
    }
    return this.requestJson<RelayEffectiveAccessDto>(
      `/relay/access?${params.toString()}`,
      { cache: 'no-store' },
    );
  }

  createRelayShare(input: CreateRelaySessionShareInput) {
    return this.requestJson<RelaySessionShareDto>('/relay/shares', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  revokeRelayShare(shareId: string) {
    return this.requestJson<RelaySessionShareDto>(
      `/relay/shares/${encodeURIComponent(shareId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  fetchForkTurnOptions(threadId: string) {
    return this.requestJson<ThreadForkTurnOptionDto[]>(
      `/api/threads/${encodeURIComponent(threadId)}/fork-turns`,
      { cache: 'no-store' },
    );
  }

  forkThread(threadId: string, input: ForkThreadInput) {
    return this.requestJson<ThreadForkResultDto>(
      `/api/threads/${encodeURIComponent(threadId)}/fork`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  downloadThreadTranscriptExport(
    threadId: string,
    input: ExportThreadPdfInput & { format?: ThreadExportFormatDto },
  ) {
    const query = buildExportQuery(input);
    const extension = input.format === 'html' ? 'html' : 'pdf';
    return this.requestDownload(
      `/api/threads/${encodeURIComponent(threadId)}/exports/pdf?${query}`,
      { cache: 'no-store' },
      `remote-codex-transcript.${extension}`,
    );
  }

  fetchWorkspaceTree(workspaceId: string, path = '') {
    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.requestJson<ThreadWorkspaceTreeNodeDto>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files/tree${query}`,
      { cache: 'no-store' },
    );
  }

  fetchWorkspaceFilePreview(
    workspaceId: string,
    input: { path: string; offset?: number; limit?: number },
  ) {
    const query = buildWorkspacePreviewQuery(input);
    return this.requestJson<ThreadWorkspaceFilePreviewDto>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files/preview?${query}`,
      { cache: 'no-store' },
    );
  }

  buildWorkspaceRawFileUrl(workspaceId: string, input: { path: string }) {
    const query = buildWorkspaceFileQuery(input);
    return supervisorApiUrl(
      this.bootstrap,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files/raw?${query}`,
    );
  }

  buildThreadImageAssetUrl(threadId: string, input: { path: string }) {
    const query = buildBrowserAssetQuery(this.bootstrap, input);
    return supervisorApiUrl(
      this.bootstrap,
      `/api/threads/${encodeURIComponent(threadId)}/assets/image?${query}`,
    );
  }

  downloadWorkspaceNode(workspaceId: string, input: { path: string }) {
    const query = buildWorkspaceFileQuery(input);
    return this.requestDownload(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files/download?${query}`,
      { cache: 'no-store' },
      input.path.split('/').filter(Boolean).pop() || 'workspace-download',
    );
  }

  uploadWorkspaceFile(
    workspaceId: string,
    input: { path: string; file: File },
  ) {
    const formData = new FormData();
    formData.append('path', input.path);
    formData.append('file', input.file, input.file.name);
    return this.requestJson<ThreadWorkspaceUploadResultDto>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files/upload`,
      {
        method: 'POST',
        body: formData,
      },
    );
  }

  writeWorkspaceFile(
    workspaceId: string,
    input: { path: string; content: string },
  ) {
    return this.requestJson<WorkspaceFileDto>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
    );
  }
}
