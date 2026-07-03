import type {
  ApplyProviderHostConfigArchiveResultDto,
  AgentBackendDto,
  AgentBackendIdDto,
  ApiErrorShape,
  AuthLoginResultDto,
  AuthSessionDto,
  RelayAdminSummaryDto,
  RelayCreateDeviceResultDto,
  RelayLoginResultDto,
  RelayPortalSummaryDto,
  RelayRegisterResultDto,
  RelaySessionDto,
  RelaySessionShareDto,
  RelayUserDto,
  ProviderHostConfigArchiveDto,
  ProviderHostFileDto,
  CreateProviderHostConfigArchiveInput,
  CreateThreadInput,
  CreateThreadHookInput,
  TrustThreadHookInput,
  ExportThreadPdfInput,
  ThreadExportFormatDto,
  ForkThreadInput,
  CreateWorkspaceInput,
  HealthDto,
  ImportThreadInput,
  ImportPluginInput,
  InterruptTurnInput,
  ModelOptionDto,
  PluginDto,
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
  ThreadWorkspaceFilePreviewDto,
  ThreadWorkspaceTreeNodeDto,
  ThreadWorkspaceUploadResultDto,
  ThreadGoalDto,
  ThreadHooksDto,
  UntrustThreadHookInput,
  UpdateThreadGoalInput,
  UpdateThreadHookInput,
  ThreadMcpServersDto,
  ThreadSkillsDto,
  ThreadDto,
  ThreadEventEnvelope,
  ThreadForkResultDto,
  ThreadForkTurnOptionDto,
  WorkspaceFileDto,
  ThreadShellStateDto,
  RenameProviderHostConfigArchiveInput,
  UpdateShellInput,
  UpdateThreadSettingsInput,
  UpdateThreadInput,
  UpdateProviderHostFileInput,
  UpdatePluginInput,
  UpdateWorkspaceSettingsInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceFavoriteInput,
  WorkspaceDto,
  WorkspaceSettingsDto,
} from '@remote-codex/shared';
export type { PromptAttachmentUpload } from '@remote-codex/thread-ui';
import type { PromptAttachmentUpload } from '@remote-codex/thread-ui';
import {
  currentRelayDeviceIdFromPath,
  currentThreadIdFromPath,
} from './relayRoutes';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly payload: ApiErrorShape
  ) {
    super(payload.message);
  }
}

const AUTH_TOKEN_STORAGE_KEY = 'remote-codex-auth-token';
const RELAY_TOKEN_STORAGE_KEY = 'remote-codex-relay-token';
const RELAY_MODE_STORAGE_KEY = 'remote-codex-relay-mode';
const RELAY_DEVICE_STORAGE_KEY = 'remote-codex-relay-device-id';
const RELAY_THREAD_STORAGE_KEY = 'remote-codex-relay-thread-id';

declare global {
  interface Window {
    __REMOTE_CODEX_BOOTSTRAP__?: {
      mode?: 'local' | 'server' | 'relay';
      relayApiBase?: string;
    };
  }
}

function readStoredAuthToken() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export function setStoredAuthToken(token: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

function readStoredRelayToken() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(RELAY_TOKEN_STORAGE_KEY);
}

export function setStoredRelayToken(token: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (token) {
    window.localStorage.setItem(RELAY_TOKEN_STORAGE_KEY, token);
    return;
  }

  window.localStorage.removeItem(RELAY_TOKEN_STORAGE_KEY);
}

function relayModeEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.__REMOTE_CODEX_BOOTSTRAP__?.mode === 'relay' ||
    window.location.pathname.startsWith('/relay-portal') ||
    window.location.pathname.startsWith('/relay-admin') ||
    window.location.search.includes('relay=1') ||
    window.localStorage.getItem(RELAY_MODE_STORAGE_KEY) === 'true';
}

export function enableRelayMode() {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(RELAY_MODE_STORAGE_KEY, 'true');
}

export function relayModeActive() {
  return relayModeEnabled();
}

export function readSelectedRelayDeviceId() {
  if (typeof window === 'undefined') {
    return null;
  }
  return (
    currentRelayDeviceIdFromPath() ??
    window.localStorage.getItem(RELAY_DEVICE_STORAGE_KEY)
  );
}

export function setSelectedRelayDeviceId(deviceId: string | null) {
  if (typeof window === 'undefined') {
    return;
  }
  if (deviceId) {
    window.localStorage.setItem(RELAY_DEVICE_STORAGE_KEY, deviceId);
    return;
  }
  window.localStorage.removeItem(RELAY_DEVICE_STORAGE_KEY);
}

export function readSelectedRelayThreadId() {
  if (typeof window === 'undefined') {
    return null;
  }
  return (
    currentThreadIdFromPath() ??
    window.localStorage.getItem(RELAY_THREAD_STORAGE_KEY)
  );
}

export function setSelectedRelayThreadId(threadId: string | null) {
  if (typeof window === 'undefined') {
    return;
  }
  if (threadId) {
    window.localStorage.setItem(RELAY_THREAD_STORAGE_KEY, threadId);
    return;
  }
  window.localStorage.removeItem(RELAY_THREAD_STORAGE_KEY);
}

function apiPath(path: string) {
  if (!relayModeEnabled()) {
    return path;
  }
  if (path.startsWith('/api/')) {
    const deviceId = readSelectedRelayDeviceId();
    if (deviceId) {
      return `/relay/devices/${encodeURIComponent(deviceId)}${path}`;
    }
    return `/relay${path}`;
  }
  return path;
}

export function buildApiUrl(path: string) {
  return apiPath(path);
}

export interface FileDownloadResult {
  blob: Blob;
  filename: string;
}

function apiErrorCodeForStatus(status: number): ApiErrorShape['code'] {
  if (status === 400) {
    return 'bad_request';
  }

  if (status === 401) {
    return 'unauthorized';
  }

  if (status === 403) {
    return 'forbidden';
  }

  if (status === 404) {
    return 'not_found';
  }

  if (status === 409) {
    return 'conflict';
  }

  if (status === 429 || status === 503) {
    return 'service_unavailable';
  }

  return 'internal_error';
}

function fallbackErrorMessage(status: number, statusText?: string) {
  const label = statusText?.trim();
  const suffix = label ? `${status} ${label}` : `${status}`;

  if (status === 429) {
    return `Too many requests (${suffix}).`;
  }

  if (status === 503) {
    return `Upstream service unavailable (${suffix}).`;
  }

  return `Request failed (${suffix}).`;
}

function normalizedApiErrorPayload(
  response: Response,
  payload: Partial<ApiErrorShape> | null | undefined,
  fallbackMessage: string,
): ApiErrorShape {
  const message =
    typeof payload?.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : fallbackMessage;
  const details =
    payload?.details && typeof payload.details === 'object'
      ? payload.details
      : undefined;

  return {
    code: payload?.code ?? apiErrorCodeForStatus(response.status),
    message,
    ...(details ? { details } : {}),
  };
}

async function readApiErrorPayload(response: Response): Promise<ApiErrorShape> {
  const fallbackMessage = fallbackErrorMessage(response.status, response.statusText);
  const contentType = response.headers?.get?.('content-type') ?? '';
  const readJsonPayload = async () =>
    normalizedApiErrorPayload(
      response,
      (await response.json()) as Partial<ApiErrorShape>,
      fallbackMessage,
    );

  if (contentType.includes('application/json')) {
    try {
      return await readJsonPayload();
    } catch {
      return normalizedApiErrorPayload(response, null, fallbackMessage);
    }
  }

  try {
    if (typeof response.text !== 'function') {
      try {
        return await readJsonPayload();
      } catch {
        return normalizedApiErrorPayload(response, null, fallbackMessage);
      }
    }

    const text = (await response.text()).trim();
    if (text.startsWith('{')) {
      try {
        return normalizedApiErrorPayload(
          response,
          JSON.parse(text) as Partial<ApiErrorShape>,
          fallbackMessage,
        );
      } catch {
        // Keep the raw response text visible below when it is not valid JSON.
      }
    }

    return normalizedApiErrorPayload(
      response,
      text ? { message: `${fallbackMessage}\n${text}` } : null,
      fallbackMessage,
    );
  } catch {
    try {
      return await readJsonPayload();
    } catch {
      return normalizedApiErrorPayload(response, null, fallbackMessage);
    }
  }
}

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(apiPath(String(input)), withAuthInit({
    ...init,
    headers,
  }));

  if (!response.ok) {
    const payload = await readApiErrorPayload(response);
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
  const response = await fetch(apiPath(String(input)), withAuthInit(init));

  if (!response.ok) {
    const payload = await readApiErrorPayload(response);
    throw new ApiError(response.status, payload);
  }

  const filename =
    parseContentDispositionFilename(response.headers.get('content-disposition')) ??
    fallbackDownloadFilename(input);

  return {
    blob: await response.blob(),
    filename,
  };
}

function withAuthInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  const relayToken = readStoredRelayToken();
  const token = readStoredAuthToken();
  if (relayModeEnabled() && relayToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${relayToken}`);
  } else if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return {
    ...init,
    credentials: init.credentials ?? 'same-origin',
    headers,
  };
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

export function fetchAuthSession() {
  return request<AuthSessionDto>('/api/auth/session', {
    cache: 'no-store',
  });
}

export async function login(input: { username: string; password: string }) {
  const result = await request<AuthLoginResultDto>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setStoredAuthToken(result.token ?? null);
  return result;
}

export async function logout() {
  const result = await request<AuthSessionDto>('/api/auth/logout', {
    method: 'POST',
  });
  setStoredAuthToken(null);
  return result;
}

export function fetchRelaySession() {
  return request<RelaySessionDto>('/relay/auth/session', {
    credentials: 'same-origin',
  });
}

export async function relayLogin(input: { identifier: string; password: string }) {
  enableRelayMode();
  const result = await request<RelayLoginResultDto>('/relay/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setStoredRelayToken(result.token);
  return result;
}

export async function relayRegister(input: {
  email: string;
  username: string;
  password: string;
  registrationPassword?: string;
}) {
  enableRelayMode();
  const result = await request<RelayRegisterResultDto>('/relay/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setStoredRelayToken(result.token);
  return result;
}

export async function relayLogout() {
  const result = await request<RelaySessionDto>('/relay/auth/logout', {
    method: 'POST',
  });
  setStoredRelayToken(null);
  setSelectedRelayDeviceId(null);
  setSelectedRelayThreadId(null);
  return result;
}

export function fetchRelayPortal() {
  return request<RelayPortalSummaryDto>('/relay/portal');
}

export function createRelayDevice(input: { name: string }) {
  return request<RelayCreateDeviceResultDto>('/relay/devices', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteRelayDevice(deviceId: string) {
  return request<{ id: string }>(`/relay/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
  });
}

export function updateRelayAccount(input: { username?: string }) {
  return request<RelayUserDto>('/relay/account', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function updateRelayPassword(input: {
  currentPassword: string;
  newPassword: string;
}) {
  return request<RelayUserDto>('/relay/account/password', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function createRelayShare(input: {
  targetUsername: string;
  deviceId: string;
  threadId: string;
  label?: string;
}) {
  return request<RelaySessionShareDto>('/relay/shares', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function revokeRelayShare(shareId: string) {
  return request<RelaySessionShareDto>(`/relay/shares/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
  });
}

export function fetchRelayAdmin() {
  return request<RelayAdminSummaryDto>('/relay/admin');
}

export function setRelayRegistrationEnabled(enabled: boolean) {
  return request<{ registrationEnabled: boolean }>('/relay/admin/settings/registration', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export function setRelayUserEnabled(userId: string, enabled: boolean) {
  return request<RelayUserDto>(`/relay/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
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

export function fetchAgentBackends() {
  return request<AgentBackendDto[]>('/api/agent-runtimes', {
    cache: 'no-store',
  });
}

export function fetchAgentBackendStatus(provider: AgentBackendIdDto) {
  return request<AgentBackendDto>(
    `/api/agent-runtimes/${encodeURIComponent(provider)}/status`,
    {
      cache: 'no-store',
    },
  );
}

export function restartAgentBackend(provider: AgentBackendIdDto) {
  return request<AgentBackendDto>(
    `/api/agent-runtimes/${encodeURIComponent(provider)}/restart`,
    {
      method: 'POST',
    },
  );
}

export function installOrUpdateAgentBackend(
  provider: AgentBackendIdDto,
  action: 'install' | 'update',
) {
  return request<AgentBackendDto>(
    `/api/agent-runtimes/${encodeURIComponent(provider)}/install`,
    {
      method: 'POST',
      body: JSON.stringify({ action }),
    },
  );
}

export function fetchAgentBackendModels(provider: AgentBackendIdDto) {
  return request<ModelOptionDto[]>(
    `/api/agent-runtimes/${encodeURIComponent(provider)}/models`,
    {
      cache: 'no-store',
    },
  );
}

export function fetchProviderHostFile(provider: AgentBackendIdDto, name: string) {
  return request<ProviderHostFileDto>(
    `/api/config/providers/${encodeURIComponent(provider)}/files/${encodeURIComponent(name)}`,
    {
      cache: 'no-store',
    },
  );
}

export function updateProviderHostFile(
  provider: AgentBackendIdDto,
  name: string,
  input: UpdateProviderHostFileInput,
) {
  return request<ProviderHostFileDto>(
    `/api/config/providers/${encodeURIComponent(provider)}/files/${encodeURIComponent(name)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export function fetchProviderHostConfigArchives(provider: AgentBackendIdDto) {
  return request<ProviderHostConfigArchiveDto[]>(
    `/api/config/providers/${encodeURIComponent(provider)}/archives`,
    {
      cache: 'no-store',
    },
  );
}

export function createProviderHostConfigArchive(
  provider: AgentBackendIdDto,
  input: CreateProviderHostConfigArchiveInput = {},
) {
  return request<ProviderHostConfigArchiveDto>(
    `/api/config/providers/${encodeURIComponent(provider)}/archives`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function renameProviderHostConfigArchive(
  provider: AgentBackendIdDto,
  id: string,
  input: RenameProviderHostConfigArchiveInput,
) {
  return request<ProviderHostConfigArchiveDto>(
    `/api/config/providers/${encodeURIComponent(provider)}/archives/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export function applyProviderHostConfigArchive(provider: AgentBackendIdDto, id: string) {
  return request<ApplyProviderHostConfigArchiveResultDto>(
    `/api/config/providers/${encodeURIComponent(provider)}/archives/${encodeURIComponent(id)}/apply`,
    {
      method: 'POST',
    },
  );
}

export function buildAndRestartService() {
  return request<{ status: 'launched'; pid: number | null; message: string }>(
    '/api/service/build-restart',
    {
      method: 'POST',
    },
  );
}

export function fetchSupervisorHealth() {
  return request<HealthDto>('/healthz', {
    cache: 'no-store'
  });
}

export function fetchWorkspaces() {
  return request<WorkspaceDto[]>('/api/workspaces');
}

export function fetchWorkspaceFileTree(
  workspaceId: string,
  input: { path?: string | null } = {},
) {
  const params = new URLSearchParams();
  if (input.path) {
    params.set('path', input.path);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return request<ThreadWorkspaceTreeNodeDto>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/files/tree${suffix}`,
    {
      cache: 'no-store',
    },
  );
}

export function fetchWorkspaceFilePreview(
  workspaceId: string,
  input: { path: string; offset?: number; limit?: number },
) {
  const params = new URLSearchParams({ path: input.path });
  if (input.offset !== undefined) {
    params.set('offset', String(input.offset));
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }

  return request<ThreadWorkspaceFilePreviewDto>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/files/preview?${params.toString()}`,
    {
      cache: 'no-store',
    },
  );
}

export function buildWorkspaceRawFileUrl(
  workspaceId: string,
  input: { path: string },
) {
  const params = new URLSearchParams({ path: input.path });
  return buildApiUrl(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/files/raw?${params.toString()}`,
  );
}

export function buildThreadImageAssetUrl(
  threadId: string,
  input: { path: string },
) {
  const params = new URLSearchParams({ path: input.path });
  return buildApiUrl(
    `/api/threads/${encodeURIComponent(threadId)}/assets/image?${params.toString()}`,
  );
}

export function downloadWorkspaceFile(workspaceId: string, input: { path: string }) {
  const params = new URLSearchParams({ path: input.path });
  return downloadFile(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/files/download?${params.toString()}`,
    {
      cache: 'no-store',
    },
  );
}

export function uploadWorkspaceFile(workspaceId: string, input: { file: File }) {
  const formData = new FormData();
  formData.append('file', input.file, input.file.name);
  return request<ThreadWorkspaceUploadResultDto>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/files/upload`,
    {
      method: 'POST',
      body: formData,
    },
  );
}

export function writeWorkspaceFile(
  workspaceId: string,
  input: { path: string; content: string },
) {
  return request<WorkspaceFileDto>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/files`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  );
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

export function fetchPlugins() {
  return request<PluginDto[]>('/api/plugins', {
    cache: 'no-store',
  });
}

export function importPlugin(input: ImportPluginInput) {
  return request<PluginDto>('/api/plugins/import', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updatePlugin(pluginId: string, input: UpdatePluginInput) {
  return request<PluginDto>(`/api/plugins/${encodeURIComponent(pluginId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deletePlugin(pluginId: string) {
  return request<PluginDto>(`/api/plugins/${encodeURIComponent(pluginId)}`, {
    method: 'DELETE',
  });
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

export function importThread(input: ImportThreadInput | ImportThreadInput['sessionId']) {
  const body = typeof input === 'string'
    ? { sessionId: input }
    : input;
  return request<ThreadDetailDto>('/api/threads/import', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function createThreadShell(id: string, input: { cols?: number; rows?: number; label?: string } = {}) {
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

export function updateShell(id: string, input: UpdateShellInput) {
  return request<ShellSessionDto>(`/api/shells/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
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

  const manifest: Array<
    Pick<
      PromptAttachmentUpload,
      'clientId' | 'kind' | 'originalName' | 'placeholder'
    >
  > = attachments.map(
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

export function cancelPendingSteer(id: string, pendingSteerId: string) {
  return request<ThreadDetailDto>(
    `/api/threads/${id}/pending-steers/${encodeURIComponent(pendingSteerId)}`,
    {
      method: 'DELETE',
    },
  );
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

export function fetchThreadHooks(id: string) {
  return request<ThreadHooksDto>(`/api/threads/${id}/hooks`, {
    cache: 'no-store',
  });
}

export function createThreadHook(id: string, input: CreateThreadHookInput) {
  return request<ThreadHooksDto>(`/api/threads/${id}/hooks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateThreadHook(
  id: string,
  input: UpdateThreadHookInput,
) {
  return request<ThreadHooksDto>(`/api/threads/${id}/hooks`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function trustThreadHook(id: string, input: TrustThreadHookInput) {
  return request<ThreadHooksDto>(`/api/threads/${id}/hooks/trust`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function untrustThreadHook(id: string, input: UntrustThreadHookInput) {
  return request<ThreadHooksDto>(`/api/threads/${id}/hooks/untrust`, {
    method: 'POST',
    body: JSON.stringify(input),
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

export type DeleteWorkspaceConfirmationInput = {
  confirmWorkspaceId: string;
  confirmLabel: string;
};

export function deleteWorkspace(id: string, input: DeleteWorkspaceConfirmationInput) {
  return request<{ id: string }>(`/api/workspaces/${id}`, {
    method: 'DELETE',
    body: JSON.stringify(input)
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
  const socket = new WebSocket(buildSocketUrl(protocol));

  socket.addEventListener('message', (message) => {
    try {
      const parsed = JSON.parse(message.data as string) as SupervisorSocketServerEnvelope;
      if (isThreadEventEnvelope(parsed)) {
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
  const socket = new WebSocket(buildSocketUrl(protocol));

  socket.addEventListener('message', (message) => {
    try {
      const parsed = JSON.parse(message.data as string) as SupervisorSocketServerEnvelope;
      if (parsed.type === 'supervisor.connected') {
        handlers.onConnected?.(parsed);
        return;
      }
      if (isShellEventEnvelope(parsed)) {
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

function buildSocketUrl(protocol: 'ws:' | 'wss:') {
  const url = new URL(`${protocol}//${window.location.host}/ws`);
  if (relayModeEnabled()) {
    const deviceId = readSelectedRelayDeviceId();
    url.pathname = deviceId
      ? `/relay/devices/${encodeURIComponent(deviceId)}/ws`
      : '/relay/ws';
  }
  const token = readStoredAuthToken();
  const relayToken = readStoredRelayToken();
  const relayThreadId = readSelectedRelayThreadId();
  if (relayModeEnabled() && relayToken) {
    url.searchParams.set('relaySession', relayToken);
  }
  if (relayModeEnabled() && relayThreadId) {
    url.searchParams.set('threadId', relayThreadId);
  }
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

function isThreadEventEnvelope(
  event: SupervisorSocketServerEnvelope,
): event is ThreadEventEnvelope {
  return (
    'threadId' in event &&
    event.type.startsWith('thread.') &&
    typeof event.payload === 'object' &&
    event.payload !== null
  );
}

function isShellEventEnvelope(
  event: SupervisorSocketServerEnvelope,
): event is ShellEventEnvelope {
  return (
    'shellId' in event &&
    event.type.startsWith('shell.') &&
    typeof event.payload === 'object' &&
    event.payload !== null
  );
}
