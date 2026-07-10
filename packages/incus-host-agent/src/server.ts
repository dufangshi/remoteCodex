import crypto from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { z } from 'zod';

import type { AuditLogger } from './audit-log';
import type { IncusHostAgentConfig } from './config';
import { IncusClient } from './incus-client';
import { hostedSandboxIdSchema, snapshotNameSchema } from './instance-policy';
import { FileOperationStore, type StoredOperation } from './operation-store';

const createSchema = z.object({
  id: hostedSandboxIdSchema,
  imageVersion: z.string().min(1).max(80),
  resources: z.object({
    cpuCount: z.number().int().positive(),
    memoryMiB: z.number().int().positive(),
    diskGiB: z.number().int().positive(),
  }),
});

export function buildIncusHostAgent(input: {
  config: IncusHostAgentConfig;
  client: IncusClient;
  operations: FileOperationStore;
  audit: AuditLogger;
}): FastifyInstance {
  const app = Fastify({ logger: false });
  const inFlight = new Map<
    string,
    { action: string; sandboxId: string; promise: Promise<unknown> }
  >();

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/healthz') {
      return;
    }
    const supplied = bearerToken(request);
    if (!supplied || !safeEqual(supplied, input.config.token)) {
      return reply
        .code(401)
        .send({ code: 'unauthorized', message: 'Authentication required.' });
    }
  });

  app.get('/v1/capability', async (_request, reply) => {
    try {
      return await input.client.capability();
    } catch {
      return reply.code(503).send({
        available: false,
        code: 'incus_unavailable',
        message: 'Incus is unavailable.',
      });
    }
  });

  app.get('/readyz', async (_request, reply) => {
    try {
      const capability = await input.client.capability();
      return { status: 'ready', capability };
    } catch {
      return reply.code(503).send({
        status: 'not_ready',
        code: 'incus_unavailable',
      });
    }
  });

  app.post('/v1/instances', async (request, reply) => {
    const body = createSchema.parse(request.body ?? {});
    return executeIdempotently(
      request,
      reply,
      { ...input, inFlight },
      'create',
      body.id,
      () => input.client.create(body.id, body.imageVersion, body.resources),
    );
  });

  app.get('/v1/instances/:id', async (request) => {
    const { id } = z
      .object({ id: hostedSandboxIdSchema })
      .parse(request.params);
    return input.client.status(id);
  });

  app.post('/v1/instances/:id/start', async (request, reply) => {
    const { id } = z
      .object({ id: hostedSandboxIdSchema })
      .parse(request.params);
    return executeIdempotently(
      request,
      reply,
      { ...input, inFlight },
      'start',
      id,
      () => input.client.start(id),
    );
  });

  app.post('/v1/instances/:id/stop', async (request, reply) => {
    const { id } = z
      .object({ id: hostedSandboxIdSchema })
      .parse(request.params);
    return executeIdempotently(
      request,
      reply,
      { ...input, inFlight },
      'stop',
      id,
      () => input.client.stop(id),
    );
  });

  app.post('/v1/instances/:id/snapshots', async (request, reply) => {
    const { id } = z
      .object({ id: hostedSandboxIdSchema })
      .parse(request.params);
    const body = z
      .object({ name: snapshotNameSchema })
      .parse(request.body ?? {});
    return executeIdempotently(
      request,
      reply,
      { ...input, inFlight },
      'snapshot',
      id,
      () => input.client.snapshot(id, body.name),
    );
  });

  app.delete('/v1/instances/:id', async (request, reply) => {
    const { id } = z
      .object({ id: hostedSandboxIdSchema })
      .parse(request.params);
    return executeIdempotently(
      request,
      reply,
      { ...input, inFlight },
      'delete',
      id,
      () => input.client.delete(id),
    );
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply
        .code(400)
        .send({ code: 'bad_request', message: 'Request validation failed.' });
    }
    return reply.code(502).send({
      code: 'incus_operation_failed',
      message: 'Incus operation failed.',
    });
  });

  return app;
}

async function executeIdempotently<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    operations: FileOperationStore;
    audit: AuditLogger;
    inFlight: Map<
      string,
      { action: string; sandboxId: string; promise: Promise<unknown> }
    >;
  },
  action: string,
  sandboxId: string,
  operation: () => Promise<T>,
) {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 16 || key.length > 200) {
    return reply.code(400).send({
      code: 'idempotency_key_required',
      message: 'A 16-200 character Idempotency-Key header is required.',
    });
  }
  const active = input.inFlight.get(key);
  if (active) {
    if (active.action !== action || active.sandboxId !== sandboxId) {
      return idempotencyConflict(reply);
    }
    return active.promise;
  }
  const existing = await input.operations.read<T>(key);
  if (
    existing &&
    (existing.action !== action || existing.sandboxId !== sandboxId)
  ) {
    return idempotencyConflict(reply);
  }
  if (existing?.status === 'succeeded') {
    return existing.result;
  }
  const execution = runOperation(
    input,
    key,
    request.id,
    action,
    sandboxId,
    operation,
  );
  input.inFlight.set(key, { action, sandboxId, promise: execution });
  try {
    return await execution;
  } finally {
    input.inFlight.delete(key);
  }
}

async function runOperation<T>(
  input: { operations: FileOperationStore; audit: AuditLogger },
  key: string,
  requestId: string,
  action: string,
  sandboxId: string,
  operation: () => Promise<T>,
) {
  await input.audit.write({ requestId, action, sandboxId, outcome: 'started' });
  const running: StoredOperation<T> = {
    idempotencyKeyHash: input.operations.hash(key),
    action,
    sandboxId,
    status: 'running',
    updatedAt: new Date().toISOString(),
  };
  await input.operations.write(key, running);
  try {
    const result = await operation();
    await input.operations.write(key, {
      ...running,
      status: 'succeeded',
      result,
      updatedAt: new Date().toISOString(),
    });
    await input.audit.write({
      requestId,
      action,
      sandboxId,
      outcome: 'succeeded',
    });
    return result;
  } catch (error) {
    await input.operations.write(key, {
      ...running,
      status: 'failed',
      errorCode: 'incus_operation_failed',
      updatedAt: new Date().toISOString(),
    });
    await input.audit.write({
      requestId,
      action,
      sandboxId,
      outcome: 'failed',
      errorCode: 'incus_operation_failed',
    });
    throw error;
  }
}

function idempotencyConflict(reply: FastifyReply) {
  return reply.code(409).send({
    code: 'idempotency_key_conflict',
    message: 'The Idempotency-Key is already bound to another operation.',
  });
}

function bearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    crypto.timingSafeEqual(leftBytes, rightBytes)
  );
}
