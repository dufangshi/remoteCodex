import type {
  AgentBackendDto,
  AgentBackendIdDto,
  AgentSubscriptionUsageDto,
  ApiErrorShape,
  CreateRelaySessionShareInput,
  CreateThreadInput,
  ExportThreadPdfInput,
  ModelOptionDto,
  RelayEffectiveAccessDto,
  RelayPortalSummaryDto,
  RelaySessionShareDto,
  ThreadDetailDto,
  ThreadDto,
  ThreadExportFormatDto,
  ThreadExportTurnOptionsDto,
  ThreadHistoryItemDetailDto,
  ThreadGoalDto,
  ThreadWorkspaceUploadResultDto,
  ThreadWorkspaceFilePreviewDto,
  ThreadWorkspaceTreeNodeDto,
  UpdateThreadSettingsInput,
  UpdateThreadGoalInput,
  WorkspaceDto,
} from '@remote-codex/shared';

import type { AndroidThreadBootstrap } from './AndroidBootstrap';
import { supervisorApiUrl } from './AndroidConnection';
import {
  hasNativeHttpBridge,
  requestNativeDownload,
  requestNativeJson,
} from './AndroidNativeHttp';

export interface AndroidDownloadedFile {
  filename: string;
  contentType: string;
  base64: string;
}

export class AndroidApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly payload: ApiErrorShape,
  ) {
    super(payload.message);
  }
}

function authHeaders(bootstrap: AndroidThreadBootstrap) {
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

function buildBrowserAssetQuery(
  bootstrap: AndroidThreadBootstrap,
  input: { path: string },
) {
  const params = new URLSearchParams({ path: input.path });
  if (bootstrap.authToken) {
    params.set(
      bootstrap.mode === 'relay' ? 'relaySession' : 'token',
      bootstrap.authToken,
    );
  }
  return params.toString();
}

function filenameFromContentDisposition(
  contentDisposition: string | null | undefined,
  fallback: string,
) {
  if (!contentDisposition) {
    return fallback;
  }
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return utf8Match[1].trim().replace(/^"|"$/g, '') || fallback;
    }
  }
  const asciiMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return asciiMatch?.[1]?.trim() || fallback;
}

function fallbackFilename(path: string) {
  return path.split('/').filter(Boolean).pop() || 'workspace-download';
}

function escapeMultipartValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r|\n/g, '_');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function buildMultipartUpload(input: { path: string; file: File }) {
  const boundary = `----RemoteCodexAndroid${Date.now()}${Math.random().toString(16).slice(2)}`;
  const encoder = new TextEncoder();
  const pathPart = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="path"\r\n\r\n${input.path}\r\n`,
  );
  const fileHeader = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${escapeMultipartValue(input.file.name)}"\r\nContent-Type: ${input.file.type || 'application/octet-stream'}\r\n\r\n`,
  );
  const fileBytes = new Uint8Array(await input.file.arrayBuffer());
  const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(
    pathPart.byteLength + fileHeader.byteLength + fileBytes.byteLength + footer.byteLength,
  );
  let offset = 0;
  body.set(pathPart, offset);
  offset += pathPart.byteLength;
  body.set(fileHeader, offset);
  offset += fileHeader.byteLength;
  body.set(fileBytes, offset);
  offset += fileBytes.byteLength;
  body.set(footer, offset);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    bodyBase64: bytesToBase64(body),
  };
}

export class AndroidApiClient {
  constructor(private readonly bootstrap: AndroidThreadBootstrap) {}

  async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = authHeaders(this.bootstrap);
    const provided = new Headers(init.headers);
    provided.forEach((value, key) => headers.set(key, value));
    if (
      init.body !== undefined &&
      !(init.body instanceof FormData) &&
      !headers.has('content-type')
    ) {
      headers.set('content-type', 'application/json');
    }

    const url = supervisorApiUrl(this.bootstrap, path);
    if (hasNativeHttpBridge()) {
      const headerRecord: Record<string, string> = {};
      headers.forEach((value, key) => {
        headerRecord[key] = value;
      });
      return requestNativeJson<T>({
        url,
        method: init.method ?? 'GET',
        headers: headerRecord,
        body: typeof init.body === 'string' ? init.body : null,
      });
    }

    const response = await fetch(supervisorApiUrl(this.bootstrap, path), {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new AndroidApiError(response.status, await readError(response));
    }

    return (await response.json()) as T;
  }

  listThreads() {
    return this.requestJson<ThreadDto[]>('/api/threads', { cache: 'no-store' });
  }

  listWorkspaces() {
    return this.requestJson<WorkspaceDto[]>('/api/workspaces', {
      cache: 'no-store',
    });
  }

  listAgentRuntimes() {
    return this.requestJson<AgentBackendDto[]>('/api/agent-runtimes', {
      cache: 'no-store',
    });
  }

  fetchAgentSubscriptionUsage(provider: AgentBackendIdDto) {
    return this.requestJson<{ usage: AgentSubscriptionUsageDto | null }>(
      `/api/agent-runtimes/${encodeURIComponent(provider)}/subscription-usage`,
      { cache: 'no-store' },
    );
  }

  fetchThreadDetail(
    threadId: string,
    input: number | { limit?: number; beforeTurnId?: string | null } = 3,
  ) {
    const params = new URLSearchParams();
    if (typeof input === 'number') {
      params.set('limit', String(input));
    } else {
      params.set('limit', String(input.limit ?? 3));
      if (input.beforeTurnId) {
        params.set('beforeTurnId', input.beforeTurnId);
      }
    }
    return this.requestJson<ThreadDetailDto>(
      `/api/threads/${encodeURIComponent(threadId)}?${params}`,
      { cache: 'no-store' },
    );
  }

  listModels(provider: ThreadDto['provider']) {
    return this.requestJson<ModelOptionDto[]>(
      `/api/agent-runtimes/${encodeURIComponent(provider)}/models`,
      { cache: 'no-store' },
    );
  }

  createThread(input: CreateThreadInput) {
    return this.requestJson<ThreadDto>('/api/threads/start', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  updateThreadSettings(threadId: string, input: UpdateThreadSettingsInput) {
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
              : `android-web-${Date.now()}`,
        }),
      },
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

  async downloadThreadTranscriptExport(
    threadId: string,
    input: ExportThreadPdfInput & { format?: ThreadExportFormatDto },
  ): Promise<AndroidDownloadedFile> {
    const path = `/api/threads/${encodeURIComponent(threadId)}/exports/pdf?${buildExportQuery(input)}`;
    const headers = authHeaders(this.bootstrap);
    headers.set('accept', '*/*');
    const headerRecord: Record<string, string> = {};
    headers.forEach((value, key) => {
      headerRecord[key] = value;
    });
    const downloaded = await requestNativeDownload({
      url: supervisorApiUrl(this.bootstrap, path),
      method: 'GET',
      headers: headerRecord,
      body: null,
    });
    const responseHeaders = downloaded.headers ?? {};
    const fallback =
      input.format === 'html'
        ? 'remote-codex-transcript.html'
        : 'remote-codex-transcript.pdf';
    return {
      filename: filenameFromContentDisposition(
        responseHeaders['content-disposition'],
        fallback,
      ),
      contentType:
        responseHeaders['content-type'] ||
        (input.format === 'html' ? 'text/html' : 'application/pdf'),
      base64: downloaded.bodyBase64 ?? '',
    };
  }

  fetchHistoryItemDetail(threadId: string, itemId: string) {
    return this.requestJson<ThreadHistoryItemDetailDto>(
      `/api/threads/${encodeURIComponent(threadId)}/items/${encodeURIComponent(itemId)}/detail`,
      { cache: 'no-store' },
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
    return this.requestJson<ThreadWorkspaceFilePreviewDto>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files/preview?${buildWorkspacePreviewQuery(input)}`,
      { cache: 'no-store' },
    );
  }

  buildWorkspaceRawFileUrl(workspaceId: string, input: { path: string }) {
    return supervisorApiUrl(
      this.bootstrap,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files/raw?${buildWorkspaceFileQuery(input)}`,
    );
  }

  async downloadWorkspaceNode(
    workspaceId: string,
    input: { path: string },
  ): Promise<AndroidDownloadedFile> {
    const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/files/download?${buildWorkspaceFileQuery(input)}`;
    const headers = authHeaders(this.bootstrap);
    headers.set('accept', '*/*');
    const headerRecord: Record<string, string> = {};
    headers.forEach((value, key) => {
      headerRecord[key] = value;
    });
    const downloaded = await requestNativeDownload({
      url: supervisorApiUrl(this.bootstrap, path),
      method: 'GET',
      headers: headerRecord,
      body: null,
    });
    const responseHeaders = downloaded.headers ?? {};
    const fallback = fallbackFilename(input.path);
    return {
      filename: filenameFromContentDisposition(
        responseHeaders['content-disposition'],
        fallback,
      ),
      contentType:
        responseHeaders['content-type'] ||
        'application/octet-stream',
      base64: downloaded.bodyBase64 ?? '',
    };
  }

  async uploadWorkspaceFile(
    workspaceId: string,
    input: { path: string; file: File },
  ): Promise<ThreadWorkspaceUploadResultDto> {
    const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/files/upload`;
    const headers = authHeaders(this.bootstrap);
    const { contentType, bodyBase64 } = await buildMultipartUpload(input);
    headers.set('content-type', contentType);

    if (hasNativeHttpBridge()) {
      const headerRecord: Record<string, string> = {};
      headers.forEach((value, key) => {
        headerRecord[key] = value;
      });
      return requestNativeJson<ThreadWorkspaceUploadResultDto>({
        url: supervisorApiUrl(this.bootstrap, path),
        method: 'POST',
        headers: headerRecord,
        bodyBase64,
      });
    }

    const formData = new FormData();
    formData.append('path', input.path);
    formData.append('file', input.file, input.file.name);
    const response = await fetch(supervisorApiUrl(this.bootstrap, path), {
      method: 'POST',
      headers: authHeaders(this.bootstrap),
      body: formData,
    });
    if (!response.ok) {
      throw new AndroidApiError(response.status, await readError(response));
    }
    return (await response.json()) as ThreadWorkspaceUploadResultDto;
  }

  buildThreadImageAssetUrl(threadId: string, input: { path: string }) {
    return supervisorApiUrl(
      this.bootstrap,
      `/api/threads/${encodeURIComponent(threadId)}/assets/image?${buildBrowserAssetQuery(this.bootstrap, input)}`,
    );
  }
}
