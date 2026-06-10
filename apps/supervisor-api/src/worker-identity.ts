import crypto from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import type { RuntimeConfig } from '../../../packages/config/src/index';
import type { ApiErrorShape } from '../../../packages/shared/src/index';

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

export type WorkerScope =
  | 'shell:write'
  | 'file:write'
  | 'provider:turn:create'
  | 'provider:turn:interrupt'
  | 'artifact:read'
  | 'artifact:write';

export class WorkerIdentityError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly payload: ApiErrorShape,
  ) {
    super(payload.message);
  }
}

function forbidden(message: string, details?: Record<string, unknown>) {
  return new WorkerIdentityError(403, {
    code: 'forbidden',
    message,
    ...(details ? { details } : {}),
  } satisfies ApiErrorShape);
}

function readSingleHeader(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeScopes(value: string) {
  return value
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
    .sort();
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
  return crypto
    .createHmac('sha256', secret)
    .update(canonicalWorkerIdentityPayload(envelope))
    .digest('base64url');
}

function timingSafeEqualString(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifyWorkerIdentityEnvelope(
  request: FastifyRequest,
  config: RuntimeConfig,
) {
  if (config.runtimeRole !== 'worker' || !config.workerIdentitySecret) {
    return null;
  }

  const envelope: WorkerIdentityEnvelope = {
    userId: readSingleHeader(request, WORKER_IDENTITY_HEADERS.user),
    projectId:
      readSingleHeader(request, WORKER_IDENTITY_HEADERS.project) || null,
    sandboxId: readSingleHeader(request, WORKER_IDENTITY_HEADERS.sandbox),
    scopes: normalizeScopes(
      readSingleHeader(request, WORKER_IDENTITY_HEADERS.scopes),
    ),
    expiresAt: readSingleHeader(request, WORKER_IDENTITY_HEADERS.expiresAt),
  };
  const signature = readSingleHeader(
    request,
    WORKER_IDENTITY_HEADERS.signature,
  );

  if (!envelope.userId || !envelope.sandboxId || !envelope.expiresAt || !signature) {
    throw forbidden('Worker identity envelope is required.');
  }

  const expectedSignature = signWorkerIdentityEnvelope(
    envelope,
    config.workerIdentitySecret,
  );
  if (!timingSafeEqualString(signature, expectedSignature)) {
    throw forbidden('Worker identity envelope signature is invalid.');
  }

  const expiresAtMs = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw forbidden('Worker identity envelope is expired.');
  }

  if (config.sandboxId && envelope.sandboxId !== config.sandboxId) {
    throw forbidden('Worker identity envelope sandbox does not match.', {
      sandboxId: envelope.sandboxId,
    });
  }

  return envelope;
}

export function requireWorkerScope(
  request: FastifyRequest,
  scope: WorkerScope,
) {
  const envelope = verifyWorkerIdentityEnvelope(
    request,
    request.server.services.config,
  );

  if (!envelope) {
    return null;
  }

  if (!envelope.scopes.includes(scope)) {
    throw forbidden('Worker identity envelope is missing a required scope.', {
      requiredScope: scope,
    });
  }

  return envelope;
}
