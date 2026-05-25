import { createHmac } from 'node:crypto';

import type { RouteTokenPayload } from '../../../packages/shared/src/index';

export const WORKER_IDENTITY_HEADERS = {
  user: 'x-remote-codex-user',
  project: 'x-remote-codex-project',
  sandbox: 'x-remote-codex-sandbox',
  scopes: 'x-remote-codex-scopes',
  expiresAt: 'x-remote-codex-expires-at',
  signature: 'x-remote-codex-signature',
} as const;

export interface WorkerIdentityEnvelope {
  userId: string;
  projectId: string | null;
  sandboxId: string;
  scopes: string[];
  expiresAt: string;
}

function canonicalWorkerIdentityPayload(envelope: WorkerIdentityEnvelope) {
  return JSON.stringify({
    userId: envelope.userId,
    projectId: envelope.projectId,
    sandboxId: envelope.sandboxId,
    scopes: [...envelope.scopes].sort(),
    expiresAt: envelope.expiresAt,
  });
}

export function signWorkerIdentityEnvelope(
  envelope: WorkerIdentityEnvelope,
  secret: string,
) {
  return createHmac('sha256', secret)
    .update(canonicalWorkerIdentityPayload(envelope))
    .digest('base64url');
}

export function workerIdentityHeadersForRouteToken(
  payload: RouteTokenPayload,
  secret: string,
) {
  const envelope: WorkerIdentityEnvelope = {
    userId: payload.sub,
    projectId: null,
    sandboxId: payload.sandbox_id,
    scopes: [...payload.scopes].sort(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
  const signature = signWorkerIdentityEnvelope(envelope, secret);

  return {
    [WORKER_IDENTITY_HEADERS.user]: envelope.userId,
    [WORKER_IDENTITY_HEADERS.sandbox]: envelope.sandboxId,
    [WORKER_IDENTITY_HEADERS.scopes]: envelope.scopes.join(','),
    [WORKER_IDENTITY_HEADERS.expiresAt]: envelope.expiresAt,
    [WORKER_IDENTITY_HEADERS.signature]: signature,
  };
}
