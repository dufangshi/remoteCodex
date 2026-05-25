import { randomUUID } from 'node:crypto';

import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';

import {
  createDatabase,
  DatabaseContext,
  runMigrations,
} from '../../../packages/db/src/index';
import {
  createSignedToken,
  verifySignedTokenWithKeys,
} from '../../../packages/shared/src/index';
import {
  LlmGatewayAdmin,
  NoopLlmGatewayAdmin,
  NoopSandboxManager,
  SandboxManagerError,
  SandboxManager,
} from './adapters';
import {
  AuthVerifier,
  createAuthVerifier,
  identityFromRequest,
  requireAuthenticatedUser,
} from './auth';
import { ControlPlaneConfig, loadControlPlaneConfig } from './config';
import { checkRouteTokenQuota, QuotaDenial } from './quota';
import { ControlPlaneRepository } from './repository';

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
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
  authVerifier: AuthVerifier;
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
  billingCustomerId: z.string().min(1).nullable().optional(),
  quotaProfile: z.string().min(1).optional(),
});

const createProjectSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

const createWorkspaceSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
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

const updateSessionSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(['created', 'active', 'idle', 'archived', 'deleted']).optional(),
  workerSessionId: z.string().min(1).nullable().optional(),
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

const adminSandboxReasonSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

function toErrorPayload(error: unknown) {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      payload: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
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

  if (error instanceof SandboxManagerError) {
    return {
      statusCode: error.code === 'quota' ? 402 : error.code === 'config' ? 400 : 503,
      payload: {
        code: `sandbox_${error.code}`,
        message: error.message,
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
  const user = requireAuthenticatedUser(
    request,
    app.services.repository,
    app.services.authVerifier,
  );
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

function requireInternalService(app: FastifyInstance, request: FastifyRequest) {
  if (!app.services.config.internalServiceToken) {
    throw new HttpError(404, 'not_found', 'Internal API is not configured.');
  }
  const token = request.headers['x-remote-codex-service-token'];
  if (token !== app.services.config.internalServiceToken) {
    throw new HttpError(403, 'forbidden', 'Internal service access is required.');
  }
}

function workerBaseUrlForSandbox(app: FastifyInstance, sandbox: {
  k8sNamespace: string | null;
  workerServiceName: string | null;
}) {
  if (!sandbox.workerServiceName) {
    return null;
  }
  if (sandbox.k8sNamespace) {
    return `http://${sandbox.workerServiceName}.${sandbox.k8sNamespace}.svc.cluster.local:${app.services.config.sandboxWorkerInternalPort}`;
  }
  return `http://${sandbox.workerServiceName}:${app.services.config.sandboxWorkerInternalPort}`;
}

function quotaExceededError(denial: QuotaDenial) {
  return new HttpError(402, 'quota_exceeded', 'Quota exceeded.', {
    reason: denial.reason,
    quotaProfile: denial.quotaProfile,
    limit: denial.limit,
    used: denial.used,
  });
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
  const authVerifier = createAuthVerifier({
    mode: config.authMode,
    jwtSecret: config.authJwtSecret,
    jwtProvider: config.authJwtProvider,
    jwtIssuer: config.authJwtIssuer,
    jwtAudience: config.authJwtAudience,
    jwtClockSkewSeconds: config.authJwtClockSkewSeconds,
  });

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
    authVerifier,
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
    const identity = app.services.authVerifier.identityFromRequest(request);
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
    const identity = app.services.authVerifier.identityFromRequest(request);
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
    const query = z
      .object({
        status: z.enum(['active', 'suspended', 'deleted']).optional(),
        plan: z.string().min(1).optional(),
      })
      .parse(request.query);
    return {
      users: repository.listUsers(query),
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

  app.get('/api/internal/sandboxes/:sandboxId/endpoint', async (request) => {
    requireInternalService(app, request);
    const params = z.object({ sandboxId: z.string().uuid() }).parse(request.params);
    const query = z.object({ userId: z.string().uuid() }).parse(request.query);
    const sandbox = repository.getSandboxById(params.sandboxId);
    if (!sandbox || sandbox.userId !== query.userId) {
      throw new HttpError(404, 'not_found', 'Sandbox endpoint not found.');
    }
    if (sandbox.state !== 'running') {
      throw new HttpError(409, 'sandbox_not_running', 'Sandbox is not running.');
    }
    const workerBaseUrl = workerBaseUrlForSandbox(app, sandbox);
    if (!workerBaseUrl) {
      throw new HttpError(409, 'worker_endpoint_unavailable', 'Sandbox worker endpoint is unavailable.');
    }
    return {
      sandboxId: sandbox.id,
      userId: sandbox.userId,
      workerBaseUrl,
    };
  });

  app.get('/api/admin/sandboxes', async (request) => {
    requireAdmin(app, request);
    return {
      sandboxes: repository.listSandboxes(),
    };
  });

  app.post('/api/admin/sandboxes/:sandboxId/force-stop', async (request) => {
    requireAdmin(app, request);
    const params = z.object({ sandboxId: z.string().uuid() }).parse(request.params);
    const input = adminSandboxReasonSchema.parse(request.body ?? {});
    const sandbox = repository.getSandboxById(params.sandboxId);
    if (!sandbox) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    const result = await app.services.sandboxManager.stopSandbox({
      sandboxId: sandbox.id,
      userId: sandbox.userId,
    });
    return {
      sandbox: repository.updateSandboxState(sandbox.id, {
        ...result,
        statusReason: input.reason ?? result.statusReason ?? 'force-stopped by administrator',
      }),
    };
  });

  app.post('/api/admin/sandboxes/:sandboxId/restart', async (request) => {
    requireAdmin(app, request);
    const params = z.object({ sandboxId: z.string().uuid() }).parse(request.params);
    const input = adminSandboxReasonSchema.parse(request.body ?? {});
    const sandbox = repository.getSandboxById(params.sandboxId);
    if (!sandbox) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    const result = await app.services.sandboxManager.restartSandbox({
      sandboxId: sandbox.id,
      userId: sandbox.userId,
      image: sandbox.image,
      region: sandbox.region,
      s3Prefix: sandbox.s3Prefix,
    });
    return {
      sandbox: repository.updateSandboxState(sandbox.id, {
        ...result,
        statusReason: input.reason ?? result.statusReason ?? 'restarted by administrator',
      }),
    };
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

  app.get('/api/sandbox/health', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.getSandboxByUserId(user.id);
    if (!sandbox) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    const status = await app.services.sandboxManager.getSandboxStatus({
      sandboxId: sandbox.id,
      userId: user.id,
    });
    const endpoint = await app.services.sandboxManager.getSandboxEndpoint({
      sandboxId: sandbox.id,
      userId: user.id,
    });
    return {
      sandbox,
      status,
      endpoint,
    };
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

  app.post('/api/sandbox/restart', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.getSandboxByUserId(user.id);
    if (!sandbox) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    const result = await app.services.sandboxManager.restartSandbox({
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

  app.get('/api/projects', async (request) => {
    const user = requireUser(app, request);
    return { projects: repository.listProjects(user.id) };
  });

  app.post('/api/projects', async (request) => {
    const user = requireUser(app, request);
    const input = createProjectSchema.parse(request.body);
    return {
      project: repository.createProject({
        userId: user.id,
        ...input,
      }),
    };
  });

  app.get('/api/projects/:projectId', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const project = repository.getProjectById(params.projectId);
    if (!project || project.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Project not found.');
    }
    return { project };
  });

  app.patch('/api/projects/:projectId', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const project = repository.getProjectById(params.projectId);
    if (!project || project.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Project not found.');
    }
    return {
      project: repository.updateProject(project.id, updateProjectSchema.parse(request.body)),
    };
  });

  app.delete('/api/projects/:projectId', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const project = repository.getProjectById(params.projectId);
    if (!project || project.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Project not found.');
    }
    return {
      project: repository.updateProject(project.id, { status: 'archived' }),
    };
  });

  app.get('/api/projects/:projectId/workspaces', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const project = repository.getProjectById(params.projectId);
    if (!project || project.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Project not found.');
    }
    return { workspaces: repository.listWorkspaces(user.id, { projectId: project.id }) };
  });

  app.post('/api/projects/:projectId/workspaces', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const project = repository.getProjectById(params.projectId);
    if (!project || project.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Project not found.');
    }
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const input = createWorkspaceSchema.omit({ projectId: true }).parse(request.body);
    return {
      workspace: repository.createWorkspace({
        userId: user.id,
        sandboxId: sandbox.id,
        projectId: project.id,
        ...input,
      }),
    };
  });

  app.get('/api/workspaces', async (request) => {
    const user = requireUser(app, request);
    const query = z
      .object({
        projectId: z.string().uuid().optional(),
      })
      .parse(request.query);
    if (query.projectId) {
      const project = repository.getProjectById(query.projectId);
      if (!project || project.userId !== user.id) {
        throw new HttpError(404, 'not_found', 'Project not found.');
      }
    }
    return { workspaces: repository.listWorkspaces(user.id, query) };
  });

  app.post('/api/workspaces', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const input = createWorkspaceSchema.parse(request.body);
    if (input.projectId) {
      const project = repository.getProjectById(input.projectId);
      if (!project || project.userId !== user.id) {
        throw new HttpError(404, 'not_found', 'Project not found.');
      }
    }
    return {
      workspace: repository.createWorkspace({
        userId: user.id,
        sandboxId: sandbox.id,
        ...input,
      }),
    };
  });

  app.patch('/api/workspaces/:workspaceId', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const workspace = repository.getWorkspaceById(params.workspaceId);
    if (!workspace || workspace.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Workspace not found.');
    }
    const input = z
      .object({
        name: z.string().min(1).optional(),
        status: z.enum(['active', 'archived', 'deleted']).optional(),
      })
      .parse(request.body);
    return {
      workspace: repository.updateWorkspace(workspace.id, input),
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

  app.patch('/api/sessions/:sessionId', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const session = repository.getSessionById(params.sessionId);
    if (!session || session.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Session not found.');
    }
    return {
      session: repository.updateSession(session.id, updateSessionSchema.parse(request.body)),
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
    const quota = checkRouteTokenQuota(user, repository.usageSummaryForUser(user.id));
    if (!quota.allowed) {
      throw quotaExceededError(quota.denial!);
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
      if (session.status === 'archived' || session.status === 'deleted') {
        throw new HttpError(409, 'session_not_active', 'Session must be active before issuing a route token.');
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
    const signingKey = config.routeTokenSigningKeys[0];
    if (!signingKey) {
      throw new HttpError(500, 'route_token_config_error', 'Route token signing key is not configured.');
    }
    const token = createSignedToken(
      {
        ...payload,
        ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
      },
      signingKey.secret,
      { kid: signingKey.id },
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
    try {
      return { payload: verifySignedTokenWithKeys(token, config.routeTokenSigningKeys) };
    } catch {
      throw new HttpError(401, 'invalid_route_token', 'Route token is invalid or expired.');
    }
  });

  return app;
}
