import type {
  ApiErrorShape,
  CreateWorkspaceInput,
  RuntimeConfigDto,
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
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
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

export function fetchWorkspaces() {
  return request<WorkspaceDto[]>('/api/workspaces');
}

export function fetchWorkspace(id: string) {
  return request<WorkspaceDto>(`/api/workspaces/${id}`);
}

export function createWorkspace(input: CreateWorkspaceInput) {
  return request<WorkspaceDto>('/api/workspaces', {
    method: 'POST',
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
