import type {
  ApiErrorShape,
  AgentBackendDto,
  ExportThreadPdfInput,
  ForkThreadInput,
  ModelOptionDto,
  RespondThreadActionRequestInput,
  ThreadDetailDto,
  ThreadDto,
  ThreadExportFormatDto,
  ThreadForkResultDto,
  ThreadForkTurnOptionDto,
  ThreadExportTurnOptionsDto,
  ThreadHistoryItemDetailDto,
  ThreadWorkspaceFilePreviewDto,
  ThreadWorkspaceTreeNodeDto,
  ThreadWorkspaceUploadResultDto,
  UpdateThreadSettingsInput,
  WorkspaceFileDto,
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

  listModels(provider: ThreadDto['provider']) {
    return this.requestJson<ModelOptionDto[]>(
      `/api/agent-runtimes/${encodeURIComponent(provider)}/models`,
      { cache: 'no-store' },
    );
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
