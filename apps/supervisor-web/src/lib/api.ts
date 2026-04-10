import type {
  ApiErrorShape,
  CodexStatusDto,
  CreateThreadInput,
  CreateWorkspaceInput,
  ImportThreadInput,
  InterruptTurnInput,
  ModelOptionDto,
  RespondThreadActionRequestInput,
  ResumeThreadInput,
  RuntimeConfigDto,
  SendThreadPromptInput,
  ThreadDetailDto,
  ThreadDto,
  ThreadEventEnvelope,
  UpdateThreadSettingsInput,
  UpdateThreadInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceFavoriteInput,
  WorkspaceDto,
  WorkspaceTreeDto
} from '../../../../packages/shared/src/index';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly payload: ApiErrorShape
  ) {
    super(payload.message);
  }
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

export function fetchRuntimeConfig() {
  return request<RuntimeConfigDto>('/api/config/runtime');
}

export function fetchCodexStatus() {
  return request<CodexStatusDto>('/api/codex/status');
}

export function fetchCodexModels() {
  return request<ModelOptionDto[]>('/api/codex/models');
}

export function fetchWorkspaces() {
  return request<WorkspaceDto[]>('/api/workspaces');
}

export function fetchWorkspace(id: string) {
  return request<WorkspaceDto>(`/api/workspaces/${id}`);
}

export function fetchThreads() {
  return request<ThreadDto[]>('/api/threads');
}

export function fetchThreadDetail(id: string) {
  return request<ThreadDetailDto>(`/api/threads/${id}`);
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

export function resumeThread(id: string, input: ResumeThreadInput = {}) {
  return request<ThreadDetailDto>(`/api/threads/${id}/resume`, {
    method: 'POST',
    ...(Object.keys(input).length > 0 ? { body: JSON.stringify(input) } : {})
  });
}

export function sendThreadPrompt(id: string, input: SendThreadPromptInput) {
  return request<ThreadDto>(`/api/threads/${id}/prompt`, {
    method: 'POST',
    body: JSON.stringify(input)
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

export function updateThreadSettings(id: string, input: UpdateThreadSettingsInput) {
  return request<ThreadDto>(`/api/threads/${id}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(input)
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

export function updateWorkspaceFavorite(id: string, input: UpdateWorkspaceFavoriteInput) {
  return request<WorkspaceDto>(`/api/workspaces/${id}/favorite`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function markWorkspaceOpened(id: string) {
  return request<WorkspaceDto>(`/api/workspaces/${id}/open`, {
    method: 'POST'
  });
}

export function fetchWorkspaceTree(path?: string, showHidden = false) {
  const params = new URLSearchParams();
  if (path) {
    params.set('path', path);
  }
  params.set('showHidden', String(showHidden));

  return request<WorkspaceTreeDto>(`/api/workspaces/tree?${params.toString()}`);
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
      const parsed = JSON.parse(message.data as string) as ThreadEventEnvelope | { type: string };
      if ('threadId' in parsed) {
        onEvent(parsed);
      }
    } catch {
      // Ignore malformed socket payloads.
    }
  });

  return socket;
}
