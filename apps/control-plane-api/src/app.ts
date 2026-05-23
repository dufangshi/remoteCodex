import { randomUUID } from 'node:crypto';

import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';

import {
  createDatabase,
  DatabaseContext,
  runMigrations,
} from '../../../packages/db/src/index';
import {
  LlmGatewayAdmin,
  NoopLlmGatewayAdmin,
  NoopSandboxManager,
  SandboxManager,
} from './adapters';
import { identityFromRequest, requireAuthenticatedUser } from './auth';
import { ControlPlaneConfig, loadControlPlaneConfig } from './config';
import { ControlPlaneRepository } from './repository';
import { createSignedToken, verifySignedToken } from './tokens';

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ControlPlaneServices {
  config: ControlPlaneConfig;
  database: DatabaseContext;
  repository: ControlPlaneRepository;
  sandboxManager: SandboxManager;
  llmGatewayAdmin: LlmGatewayAdmin;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: ControlPlaneServices;
  }
}

const selfRegisterSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).nullable().optional(),
});

const updateUserSchema = z.object({
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  plan: z.string().min(1).optional(),
  displayName: z.string().min(1).nullable().optional(),
});

const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  sourceType: z.enum(['empty', 'git', 'upload', 'snapshot']).default('empty'),
  gitUrl: z.string().url().nullable().optional(),
  defaultBranch: z.string().min(1).nullable().optional(),
});

const createSessionSchema = z.object({
  provider: z.enum(['codex', 'claude', 'opencode']),
  title: z.string().min(1).default('New session'),
});

const routeTokenSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  scopes: z.array(z.string().min(1)).default(['worker:read', 'worker:write']),
});

const importUsageSchema = z.object({
  events: z.array(
    z.object({
      userId: z.string().uuid(),
      sandboxId: z.string().uuid(),
      workspaceId: z.string().uuid().nullable().optional(),
      sessionId: z.string().uuid().nullable().optional(),
      gatewayKeyId: z.string().uuid().nullable().optional(),
      provider: z.string().min(1),
      model: z.string().min(1),
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      cachedTokens: z.number().int().nonnegative().optional(),
      costUsd: z.number().nonnegative().optional(),
      externalRequestId: z.string().min(1).nullable().optional(),
      occurredAt: z.string().datetime().optional(),
    }),
  ),
});

function toErrorPayload(error: unknown) {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      payload: {
        code: error.code,
        message: error.message,
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      payload: {
        code: 'bad_request',
        message: 'Request validation failed.',
        details: error.issues,
      },
    };
  }

  return {
    statusCode: 500,
    payload: {
      code: 'internal_error',
      message: 'Unexpected control plane error.',
    },
  };
}

function requireUser(app: FastifyInstance, request: FastifyRequest) {
  const user = requireAuthenticatedUser(request, app.services.repository);
  if (!user || user.status !== 'active') {
    throw new HttpError(401, 'unauthorized', 'Authentication is required.');
  }
  return user;
}

function identityKey(authProvider: string, authSubject: string) {
  return `${authProvider}:${authSubject}`;
}

function requireAdmin(app: FastifyInstance, request: FastifyRequest) {
  const user = requireUser(app, request);
  if (!app.services.config.adminIdentities.has(identityKey(user.authProvider, user.authSubject))) {
    throw new HttpError(403, 'forbidden', 'Administrator access is required.');
  }
  return user;
}

async function ensureGateway(app: FastifyInstance, user: { id: string; email: string; displayName: string | null }, sandbox: { id: string }) {
  const gatewayUser = await app.services.llmGatewayAdmin.ensureUser({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
  });
  app.services.repository.upsertGatewayUser({
    userId: user.id,
    provider: 'sub2api',
    externalUserId: gatewayUser.externalUserId,
  });

  const gatewayKey = await app.services.llmGatewayAdmin.ensureSandboxKey({
    userId: user.id,
    sandboxId: sandbox.id,
    externalUserId: gatewayUser.externalUserId,
  });
  return app.services.repository.upsertGatewayKey({
    userId: user.id,
    sandboxId: sandbox.id,
    provider: 'sub2api',
    externalKeyId: gatewayKey.externalKeyId,
    keyCiphertext: gatewayKey.keyCiphertext ?? null,
  });
}

export function buildControlPlaneApp(
  options: {
    env?: NodeJS.ProcessEnv;
    sandboxManager?: SandboxManager;
    llmGatewayAdmin?: LlmGatewayAdmin;
  } = {},
): FastifyInstance {
  const config = loadControlPlaneConfig(options.env);
  runMigrations(config.databaseUrl);
  const database = createDatabase(config.databaseUrl);
  const repository = new ControlPlaneRepository(database.db);

  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: config.logLevel,
          },
    disableRequestLogging: config.disableRequestLogging,
  });

  app.decorate('services', {
    config,
    database,
    repository,
    sandboxManager: options.sandboxManager ?? new NoopSandboxManager(config.routerBaseUrl),
    llmGatewayAdmin: options.llmGatewayAdmin ?? new NoopLlmGatewayAdmin(),
  });

  app.setErrorHandler((error, _request, reply) => {
    const { statusCode, payload } = toErrorPayload(error);
    if (statusCode >= 500) {
      app.log.error(error);
    }
    reply.status(statusCode).send(payload);
  });

  app.get('/healthz', async () => ({
    ok: true,
    service: 'control-plane-api',
  }));

  app.post('/api/auth/register', async (request) => {
    const identity = identityFromRequest(request);
    if (!identity) {
      throw new HttpError(401, 'unauthorized', 'Authentication is required.');
    }
    const input = selfRegisterSchema.parse(request.body);
    const user = repository.upsertUser({
      authProvider: identity.authProvider,
      authSubject: identity.authSubject,
      email: input.email,
      displayName: input.displayName,
    });
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const gatewayKey = await ensureGateway(app, user, sandbox);
    return { user, sandbox, gatewayKey };
  });

  app.post('/api/me/bootstrap', async (request) => {
    const identity = identityFromRequest(request);
    if (!identity) {
      throw new HttpError(401, 'unauthorized', 'Authentication is required.');
    }

    const body = z
      .object({
        email: z.string().email(),
        displayName: z.string().min(1).nullable().optional(),
      })
      .parse(request.body);

    const user = repository.upsertUser({
      authProvider: identity.authProvider,
      authSubject: identity.authSubject,
      email: body.email,
      displayName: body.displayName,
    });
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const gatewayKey = await ensureGateway(app, user, sandbox);
    return { user, sandbox, gatewayKey };
  });

  app.get('/api/me', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    return {
      user,
      sandbox,
      usage: repository.usageSummaryForUser(user.id),
    };
  });

  app.patch('/api/me', async (request) => {
    const user = requireUser(app, request);
    const input = z
      .object({
        displayName: z.string().min(1).nullable().optional(),
      })
      .parse(request.body);
    return {
      user: repository.updateUser(user.id, input),
    };
  });

  app.get('/api/usage/summary', async (request) => {
    const user = requireUser(app, request);
    return { usage: repository.usageSummaryForUser(user.id) };
  });

  app.get('/api/usage/events', async (request) => {
    const user = requireUser(app, request);
    const query = z
      .object({
        limit: z.coerce.number().int().positive().max(500).default(100),
      })
      .parse(request.query);
    return { events: repository.listUsageEventsForUser(user.id, query.limit) };
  });

  app.get('/api/admin/users', async (request) => {
    requireAdmin(app, request);
    return {
      users: repository.listUsers(),
    };
  });

  app.patch('/api/admin/users/:userId', async (request) => {
    requireAdmin(app, request);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const input = updateUserSchema.parse(request.body);
    const user = repository.updateUser(params.userId, input);
    if (!user) {
      throw new HttpError(404, 'not_found', 'User not found.');
    }
    return { user };
  });

  app.post('/api/admin/usage/import', async (request) => {
    requireAdmin(app, request);
    const input = importUsageSchema.parse(request.body);
    const events = input.events.map((event) => repository.recordUsageEvent(event));
    return { events };
  });

  app.get('/api/sandbox', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    return { sandbox };
  });

  app.post('/api/sandbox/start', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const result = await app.services.sandboxManager.startSandbox({
      sandboxId: sandbox.id,
      userId: user.id,
      image: sandbox.image,
      region: sandbox.region,
      s3Prefix: sandbox.s3Prefix,
    });
    return {
      sandbox: repository.updateSandboxState(sandbox.id, result),
    };
  });

  app.post('/api/sandbox/stop', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.getSandboxByUserId(user.id);
    if (!sandbox) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    const result = await app.services.sandboxManager.stopSandbox({
      sandboxId: sandbox.id,
      userId: user.id,
    });
    return {
      sandbox: repository.updateSandboxState(sandbox.id, result),
    };
  });

  app.get('/api/workspaces', async (request) => {
    const user = requireUser(app, request);
    return { workspaces: repository.listWorkspaces(user.id) };
  });

  app.post('/api/workspaces', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const input = createWorkspaceSchema.parse(request.body);
    return {
      workspace: repository.createWorkspace({
        userId: user.id,
        sandboxId: sandbox.id,
        ...input,
      }),
    };
  });

  app.get('/api/workspaces/:workspaceId/sessions', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const workspace = repository.getWorkspaceById(params.workspaceId);
    if (!workspace || workspace.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Workspace not found.');
    }
    return { sessions: repository.listSessionsForWorkspace(workspace.id) };
  });

  app.post('/api/workspaces/:workspaceId/sessions', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const workspace = repository.getWorkspaceById(params.workspaceId);
    if (!workspace || workspace.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Workspace not found.');
    }
    const input = createSessionSchema.parse(request.body);
    return {
      session: repository.createSession({
        userId: user.id,
        sandboxId: workspace.sandboxId,
        workspaceId: workspace.id,
        provider: input.provider,
        title: input.title,
      }),
    };
  });

  app.post('/api/sandboxes/:sandboxId/route-token', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ sandboxId: z.string().uuid() }).parse(request.params);
    const sandbox = repository.getSandboxById(params.sandboxId);
    if (!sandbox || sandbox.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    if (sandbox.state !== 'running') {
      throw new HttpError(409, 'sandbox_not_running', 'Sandbox must be running before issuing a route token.');
    }

    const input = routeTokenSchema.parse(request.body ?? {});
    if (input.workspaceId) {
      const workspace = repository.getWorkspaceById(input.workspaceId);
      if (!workspace || workspace.userId !== user.id || workspace.sandboxId !== sandbox.id) {
        throw new HttpError(404, 'not_found', 'Workspace not found.');
      }
    }
    if (input.sessionId) {
      const session = repository.getSessionById(input.sessionId);
      if (!session || session.userId !== user.id || session.sandboxId !== sandbox.id) {
        throw new HttpError(404, 'not_found', 'Session not found.');
      }
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = nowSeconds + config.routeTokenTtlSeconds;
    const payload = {
        sub: user.id,
        sandbox_id: sandbox.id,
        scopes: input.scopes,
        iat: nowSeconds,
        exp: expiresAtSeconds,
        jti: randomUUID(),
      };
    const token = createSignedToken(
      {
        ...payload,
        ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
      },
      config.jwtSecret,
    );

    repository.audit(user.id, 'route_token.issued', 'sandbox', sandbox.id, {
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      scopes: input.scopes,
    });

    return {
      sandboxId: sandbox.id,
      routerBaseUrl: sandbox.routerBaseUrl ?? config.routerBaseUrl,
      wsBaseUrl: (sandbox.routerBaseUrl ?? config.routerBaseUrl).replace(/^http/, 'ws'),
      token,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  });

  app.get('/api/route-token/verify', async (request) => {
    const token = z.object({ token: z.string().min(1) }).parse(request.query).token;
    return { payload: verifySignedToken(token, config.jwtSecret) };
  });

  return app;
}
