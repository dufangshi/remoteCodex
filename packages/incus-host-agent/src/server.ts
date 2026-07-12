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
import { readHostMetrics } from './host-metrics';
import {
  credentialReferencePattern,
  type CredentialSecretStore,
} from './secret-store';

const createSchema = z.object({
  id: hostedSandboxIdSchema,
  imageVersion: z.string().min(1).max(80),
  resources: z.object({
    cpuCount: z.number().int().positive(),
    memoryMiB: z.number().int().positive(),
    diskGiB: z.number().int().positive(),
  }),
});

const provisionSchema = z
  .object({
    relayServerUrl: z
      .url()
      .refine(
        (value) => value.startsWith('ws://') || value.startsWith('wss://'),
      ),
    relayAgentToken: z.string().regex(/^rcd_[A-Za-z0-9_-]+$/),
    credentialRef: z.string().regex(credentialReferencePattern),
    localAdminUsername: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .default('admin'),
    codexConfig: z
      .object({
        modelProvider: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/),
        model: z.string().trim().min(1).max(120),
        reviewModel: z.string().trim().min(1).max(120),
        reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']),
        baseUrl: z
          .url()
          .refine(
            (value) => value.startsWith('https://'),
            'HTTPS is required.',
          ),
        wireApi: z.literal('responses'),
        requiresOpenaiAuth: z.boolean(),
        disableResponseStorage: z.boolean(),
        networkAccess: z.enum(['enabled', 'disabled']),
        goals: z.boolean(),
      })
      .strict()
      .default({
        modelProvider: 'OpenAI',
        model: 'gpt-5.4',
        reviewModel: 'gpt-5.4',
        reasoningEffort: 'medium',
        baseUrl: 'https://api.openai.com/v1',
        wireApi: 'responses',
        requiresOpenaiAuth: true,
        disableResponseStorage: true,
        networkAccess: 'enabled',
        goals: true,
      }),
  })
  .strict();

const codexFilesSchema = z
  .object({
    configToml: z
      .string()
      .min(1)
      .max(128 * 1024),
    authJson: z
      .string()
      .min(2)
      .max(128 * 1024)
      .refine((value) => {
        try {
          const parsed = JSON.parse(value);
          return Boolean(
            parsed && typeof parsed === 'object' && !Array.isArray(parsed),
          );
        } catch {
          return false;
        }
      }, 'auth.json must contain a JSON object.'),
  })
  .strict();

export function buildIncusHostAgent(input: {
  config: IncusHostAgentConfig;
  client: IncusClient;
  operations: FileOperationStore;
  audit: AuditLogger;
  secrets: CredentialSecretStore | null;
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
      return {
        ...(await input.client.capability()),
        credentialStoreReady: input.secrets !== null,
        ...(await readHostMetrics(input.config)),
      };
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
      const capability = {
        ...(await input.client.capability()),
        credentialStoreReady: input.secrets !== null,
        ...(await readHostMetrics(input.config)),
      };
      return { status: 'ready', capability };
    } catch {
      return reply.code(503).send({
        status: 'not_ready',
        code: 'incus_unavailable',
      });
    }
  });

  app.get('/v1/inventory', async (_request, reply) => {
    try {
      return {
        ...(await input.client.inventory()),
        credentials: input.secrets ? await input.secrets.list() : [],
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return reply.code(503).send({
        code: 'inventory_unavailable',
        message: 'Hosted inventory is unavailable.',
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

  app.post('/v1/credentials', async (request, reply) => {
    const body = z
      .union([
        z.object({ openaiApiKey: z.string().min(20).max(512) }).strict(),
        z.object({ codexFiles: codexFilesSchema }).strict(),
      ])
      .parse(request.body ?? {});
    if (!input.secrets) {
      return reply.code(503).send({
        code: 'credential_store_unavailable',
        message: 'Credential storage is not configured.',
      });
    }
    return executeIdempotently(
      request,
      reply,
      { ...input, inFlight },
      'create_credential',
      'credential',
      async () => ({
        credentialRef: await input.secrets!.create(
          'codexFiles' in body
            ? JSON.stringify({ kind: 'codex_files', files: body.codexFiles })
            : body.openaiApiKey,
        ),
      }),
    );
  });

  app.delete('/v1/credentials/:credentialRef', async (request, reply) => {
    const { credentialRef } = z
      .object({ credentialRef: z.string().regex(credentialReferencePattern) })
      .parse(request.params);
    if (!input.secrets) {
      return reply.code(503).send({
        code: 'credential_store_unavailable',
        message: 'Credential storage is not configured.',
      });
    }
    return executeIdempotently(
      request,
      reply,
      { ...input, inFlight },
      'delete_credential',
      'credential',
      async () => ({
        credentialRef,
        deleted: await input.secrets!.delete(credentialRef),
      }),
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

  app.post('/v1/instances/:id/provision', async (request, reply) => {
    const { id } = z
      .object({ id: hostedSandboxIdSchema })
      .parse(request.params);
    const body = provisionSchema.parse(request.body ?? {});
    if (!input.secrets) {
      return reply.code(503).send({
        code: 'credential_store_unavailable',
        message: 'Credential storage is not configured.',
      });
    }
    return executeIdempotently(
      request,
      reply,
      { ...input, inFlight },
      'provision',
      id,
      async () => {
        const storedCredential = await input.secrets!.read(body.credentialRef);
        let codexFiles: { configToml: string; authJson: string } | undefined;
        try {
          const parsed = JSON.parse(storedCredential) as {
            kind?: string;
            files?: { configToml?: string; authJson?: string };
          };
          if (
            parsed.kind === 'codex_files' &&
            typeof parsed.files?.configToml === 'string' &&
            typeof parsed.files.authJson === 'string'
          ) {
            codexFiles = {
              configToml: parsed.files.configToml,
              authJson: parsed.files.authJson,
            };
          }
        } catch {
          // Legacy credentials contain the raw API key.
        }
        return input.client.provision(id, {
          relayServerUrl: body.relayServerUrl,
          relayAgentToken: body.relayAgentToken,
          ...(!codexFiles ? { openaiApiKey: storedCredential } : {}),
          ...(codexFiles ? { codexFiles } : {}),
          localAdminUsername: body.localAdminUsername,
          codexConfig: body.codexConfig,
        });
      },
    );
  });

  app.get('/v1/instances/:id/backends/codex/files', async (request) => {
    const { id } = z
      .object({ id: hostedSandboxIdSchema })
      .parse(request.params);
    return input.client.readCodexFiles(id);
  });

  app.put('/v1/instances/:id/backends/codex/files', async (request, reply) => {
    const { id } = z
      .object({ id: hostedSandboxIdSchema })
      .parse(request.params);
    const body = codexFilesSchema.parse(request.body ?? {});
    return executeIdempotently(
      request,
      reply,
      { ...input, inFlight },
      'update_codex_files',
      id,
      () => input.client.writeCodexFiles(id, body),
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

  app.post(
    '/v1/instances/:id/snapshots/:snapshotName/restore',
    async (request, reply) => {
      const { id, snapshotName } = z
        .object({
          id: hostedSandboxIdSchema,
          snapshotName: snapshotNameSchema,
        })
        .parse(request.params);
      return executeIdempotently(
        request,
        reply,
        { ...input, inFlight },
        'restore_snapshot',
        id,
        () => input.client.restoreSnapshot(id, snapshotName),
      );
    },
  );

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
    if (
      error instanceof Error &&
      error.message === 'The hosted running instance limit has been reached.'
    ) {
      return reply.code(409).send({
        code: 'running_instance_limit_reached',
        message: error.message,
      });
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
