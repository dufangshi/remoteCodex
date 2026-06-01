import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';

import {
  createDatabase,
  DatabaseContext,
  runMigrations,
} from '../../../packages/db/src/index';
import {
  createSignedToken,
  SignedTokenPayload,
  verifySignedTokenWithKeys,
} from '../../../packages/shared/src/tokens';
import {
  HttpLlmGatewayAdmin,
  LlmGatewayAdmin,
  NoopLlmGatewayAdmin,
  NoopSandboxManager,
  SandboxManagerError,
  SandboxManager,
  AwsEksFargateSandboxManager,
  KubectlAwsSandboxKubernetesClient,
  loadAwsSandboxAdapterConfig,
  type SandboxStartInput,
} from './adapters';
import {
  AuthVerifier,
  createAuthVerifier,
  identityFromRequest,
  requireAuthenticatedUser,
} from './auth';
import { ControlPlaneConfig, loadControlPlaneConfig } from './config';
import { checkRouteTokenQuota, QuotaDenial } from './quota';
import { ControlPlaneRepository, type UsageEventInput } from './repository';
import { SandboxReaper } from './sandbox-reaper';

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
  sandboxReaper: SandboxReaper;
}

export const CONTROL_PLANE_LOG_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-remote-codex-service-token"]',
  'res.headers["set-cookie"]',
  'SANDBOX_WORKER_AUTH_TOKEN',
  'sandboxWorkerAuthToken',
  'LLM_GATEWAY_ADMIN_TOKEN',
  'llmGatewayAdminToken',
  'gatewayKey.keyCiphertext',
  '*.gatewayKey.keyCiphertext',
  'body.gatewayKey.keyCiphertext',
  'payload.gatewayKey.keyCiphertext',
  '*.keyCiphertext',
  'keyCiphertext',
];

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

const emailPasswordAuthSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
  displayName: z.string().min(1).nullable().optional(),
});

const oauthProviderSchema = z.enum(['google', 'github']);

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
  model: z.string().min(1).optional(),
});

const updateSessionSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(['created', 'active', 'idle', 'archived', 'deleted']).optional(),
  workerSessionId: z.string().min(1).nullable().optional(),
});

const checkpointSessionSchema = z.object({
  userId: z.string().uuid(),
  sandboxId: z.string().uuid(),
  workerSessionId: z.string().min(1).nullable().optional(),
  status: z.enum(['created', 'active', 'idle', 'archived', 'deleted']).optional(),
});

const sendSessionPromptSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
});

const routeTokenSchema = z.object({
  projectId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  scopes: z.array(z.string().min(1)).default(['worker:read', 'worker:write']),
});

const workerThreadSchema = z.object({
  id: z.string().min(1),
  providerSessionId: z.string().min(1).nullable().optional(),
  provider: z.string().min(1).optional(),
});

const WORKER_IDENTITY_HEADERS = {
  user: 'x-remote-codex-user',
  project: 'x-remote-codex-project',
  sandbox: 'x-remote-codex-sandbox',
  scopes: 'x-remote-codex-scopes',
  expiresAt: 'x-remote-codex-expires-at',
  signature: 'x-remote-codex-signature',
} as const;

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const productListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.string().trim().min(1).max(50).optional(),
});

const usageImportEventSchema = z.object({
  userId: z.string().uuid().optional(),
  sandboxId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  gatewayKeyId: z.string().uuid().nullable().optional(),
  gatewayExternalKeyId: z.string().min(1).optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cachedTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  externalRequestId: z.string().min(1).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
});

const importUsageSchema = z.object({
  cursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().positive().max(500).optional(),
  events: z
    .array(
      usageImportEventSchema,
    )
    .optional(),
});

type UsageImportEvent = z.infer<typeof usageImportEventSchema>;

const adminSandboxReasonSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

function redactGatewayKey<T extends { keyCiphertext?: string | null } | null | undefined>(
  gatewayKey: T,
) {
  if (!gatewayKey) {
    return gatewayKey;
  }
  return {
    ...gatewayKey,
    keyCiphertext: null,
    hasEncryptedKey: Boolean(gatewayKey.keyCiphertext),
  };
}

function requireGatewayKeyContext(app: FastifyInstance, sandboxId: string) {
  const sandbox = app.services.repository.getSandboxById(sandboxId);
  if (!sandbox) {
    throw new HttpError(404, 'not_found', 'Sandbox not found.');
  }
  const gatewayKey = app.services.repository.getGatewayKeyForSandbox(sandbox.id);
  if (!gatewayKey) {
    throw new HttpError(404, 'not_found', 'Gateway key not found.');
  }
  const gatewayUser = app.services.repository.getGatewayUserForUser({
    userId: sandbox.userId,
    provider: gatewayKey.provider,
  });
  if (!gatewayUser) {
    throw new HttpError(409, 'gateway_user_missing', 'Gateway user is missing.');
  }
  return {
    sandbox,
    gatewayKey,
    gatewayUser,
  };
}

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
    if (error.code === 'provider') {
      return {
        statusCode: 503,
        payload: {
          code: 'gateway_unavailable',
          message: error.message,
        },
      };
    }
    return {
      statusCode: error.code === 'quota' ? 402 : error.code === 'config' ? 400 : 503,
      payload: {
        code: `sandbox_${error.code}`,
        message: error.message,
      },
    };
  }

  if (
    isSqliteUniqueConstraint(
      error,
      'control_workspaces.sandbox_id, control_workspaces.slug',
    )
  ) {
    return {
      statusCode: 409,
      payload: {
        code: 'workspace_slug_conflict',
        message: 'A workspace with this slug already exists for this sandbox.',
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

function isSqliteUniqueConstraint(error: unknown, constraint: string) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    typeof candidate.message === 'string' &&
    candidate.message.includes(`UNIQUE constraint failed: ${constraint}`)
  );
}

function requireUser(app: FastifyInstance, request: FastifyRequest) {
  const user = requireAuthenticatedUser(
    request,
    app.services.repository,
    app.services.authVerifier,
  );
  if (!user) {
    throw new HttpError(401, 'unauthorized', 'Authentication is required.');
  }
  if (user.status !== 'active') {
    throw new HttpError(403, 'account_inactive', 'Account is not active.');
  }
  return user;
}

function identityKey(authProvider: string, authSubject: string) {
  return `${authProvider}:${authSubject}`;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function passwordHash(password: string, salt = randomBytes(16).toString('base64url')) {
  const derived = scryptSync(password, salt, 64).toString('base64url');
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, hash] = storedHash.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) {
    return false;
  }
  const actual = Buffer.from(scryptSync(password, salt, 64).toString('base64url'));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createProductSessionToken(
  config: ControlPlaneConfig,
  user: { id: string },
) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: SignedTokenPayload = {
    sub: user.id,
    iss: 'remote-codex-control-plane',
    aud: 'remote-codex-control-plane',
    iat: nowSeconds,
    exp: nowSeconds + config.productSessionTtlSeconds,
    jti: randomUUID(),
  };
  return {
    token: createSignedToken(payload, config.productSessionSecret),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

function sessionResponse(
  app: FastifyInstance,
  user: NonNullable<ReturnType<ControlPlaneRepository['getUserById']>>,
) {
  const sandbox = app.services.repository.ensureSandboxForUser(user.id, {
    image: app.services.config.sandboxDefaultImage,
    region: app.services.config.sandboxDefaultRegion,
    resourceProfile: app.services.config.sandboxDefaultResourceProfile,
    s3PrefixBase: app.services.config.sandboxS3PrefixBase,
  });
  return {
    user,
    sandbox,
    session: createProductSessionToken(app.services.config, user),
  };
}

function controlPlaneCallbackUrl(config: ControlPlaneConfig, provider: 'google' | 'github') {
  return `${config.publicBaseUrl.replace(/\/+$/, '')}/api/auth/oauth/${provider}/callback`;
}

function frontendOAuthReturnUrl(config: ControlPlaneConfig) {
  return `${(config.frontendBaseUrl ?? config.publicBaseUrl).replace(/\/+$/, '')}/control-plane/login`;
}

function allowedOAuthReturnUrl(config: ControlPlaneConfig, returnTo?: string | null) {
  const fallback = frontendOAuthReturnUrl(config);
  if (!returnTo) {
    return fallback;
  }
  const fallbackUrl = new URL(fallback);
  const requestedUrl = new URL(returnTo);
  if (requestedUrl.origin !== fallbackUrl.origin) {
    throw new HttpError(400, 'bad_request', 'OAuth return URL is not allowed.');
  }
  return requestedUrl.toString();
}

function oauthState(config: ControlPlaneConfig, input: { provider: 'google' | 'github'; returnTo?: string | null }) {
  const payload: SignedTokenPayload = {
    sub: input.provider,
    provider: input.provider,
    returnTo: input.returnTo ?? null,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    jti: randomUUID(),
  };
  return createSignedToken(payload, config.productSessionSecret);
}

function verifyOAuthState(config: ControlPlaneConfig, token: string, provider: 'google' | 'github') {
  const payload = verifySignedTokenWithKeys<SignedTokenPayload & {
    provider?: unknown;
    returnTo?: unknown;
  }>(
    token,
    [{ id: 'product-session', secret: config.productSessionSecret }],
  );
  if (payload.provider !== provider) {
    throw new HttpError(400, 'bad_request', 'OAuth state is invalid.');
  }
  return allowedOAuthReturnUrl(
    config,
    typeof payload.returnTo === 'string' ? payload.returnTo : null,
  );
}

interface OAuthProfile {
  provider: 'google' | 'github';
  subject: string;
  email: string;
  displayName: string | null;
}

async function requestFormToken(url: string, input: Record<string, string>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(input).toString(),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new HttpError(401, 'unauthorized', 'OAuth provider token exchange failed.');
  }
  return payload.access_token;
}

async function fetchGoogleProfile(config: ControlPlaneConfig, code: string): Promise<OAuthProfile> {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new HttpError(503, 'service_unavailable', 'Google login is not configured.');
  }
  const accessToken = await requestFormToken('https://oauth2.googleapis.com/token', {
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: controlPlaneCallbackUrl(config, 'google'),
    grant_type: 'authorization_code',
  });
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  });
  const profile = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof profile.sub !== 'string' || typeof profile.email !== 'string') {
    throw new HttpError(401, 'unauthorized', 'Google account profile could not be resolved.');
  }
  return {
    provider: 'google',
    subject: profile.sub,
    email: profile.email,
    displayName: typeof profile.name === 'string' ? profile.name : null,
  };
}

async function fetchGitHubEmail(accessToken: string) {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'remote-codex-control-plane',
    },
  });
  const emails = await response.json().catch(() => []) as Array<Record<string, unknown>>;
  if (!response.ok || !Array.isArray(emails)) {
    return null;
  }
  const primary = emails.find((email) => email.primary === true && email.verified === true);
  const verified = primary ?? emails.find((email) => email.verified === true);
  return typeof verified?.email === 'string' ? verified.email : null;
}

async function fetchGitHubProfile(config: ControlPlaneConfig, code: string): Promise<OAuthProfile> {
  if (!config.githubClientId || !config.githubClientSecret) {
    throw new HttpError(503, 'service_unavailable', 'GitHub login is not configured.');
  }
  const accessToken = await requestFormToken('https://github.com/login/oauth/access_token', {
    code,
    client_id: config.githubClientId,
    client_secret: config.githubClientSecret,
    redirect_uri: controlPlaneCallbackUrl(config, 'github'),
  });
  const response = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'remote-codex-control-plane',
    },
  });
  const profile = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof profile.id !== 'number') {
    throw new HttpError(401, 'unauthorized', 'GitHub account profile could not be resolved.');
  }
  const email = typeof profile.email === 'string' ? profile.email : await fetchGitHubEmail(accessToken);
  if (!email) {
    throw new HttpError(400, 'bad_request', 'GitHub account does not expose a verified email.');
  }
  return {
    provider: 'github',
    subject: String(profile.id),
    email,
    displayName:
      typeof profile.name === 'string' && profile.name.trim()
        ? profile.name
        : typeof profile.login === 'string'
          ? profile.login
          : null,
  };
}

function upsertOAuthUser(repository: ControlPlaneRepository, profile: OAuthProfile) {
  const existingByIdentity = repository.getUserByAuthIdentity(profile.provider, profile.subject);
  const existingByEmail = repository.getUserByEmail(profile.email);
  const user = existingByIdentity ?? existingByEmail ?? repository.upsertUser({
    authProvider: profile.provider,
    authSubject: profile.subject,
    email: normalizeEmail(profile.email),
    displayName: profile.displayName,
  });
  repository.upsertAuthIdentity({
    userId: user.id,
    authProvider: profile.provider,
    authSubject: profile.subject,
    email: normalizeEmail(profile.email),
    displayName: profile.displayName,
  });
  return repository.getUserById(user.id)!;
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

function workerIdentityHeaders(input: {
  userId: string;
  projectId?: string | null | undefined;
  sandboxId: string;
  scopes: string[];
  secret: string | null;
}) {
  if (!input.secret) {
    return {};
  }
  const envelope = {
    userId: input.userId,
    projectId: input.projectId ?? null,
    sandboxId: input.sandboxId,
    scopes: [...input.scopes].sort(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
  const signature = createHmac('sha256', input.secret)
    .update(JSON.stringify(envelope))
    .digest('base64url');
  return {
    [WORKER_IDENTITY_HEADERS.user]: envelope.userId,
    ...(envelope.projectId ? { [WORKER_IDENTITY_HEADERS.project]: envelope.projectId } : {}),
    [WORKER_IDENTITY_HEADERS.sandbox]: envelope.sandboxId,
    [WORKER_IDENTITY_HEADERS.scopes]: envelope.scopes.join(','),
    [WORKER_IDENTITY_HEADERS.expiresAt]: envelope.expiresAt,
    [WORKER_IDENTITY_HEADERS.signature]: signature,
  };
}

function canControlRunningWorker(app: FastifyInstance, sandbox: {
  state: string;
  k8sNamespace: string | null;
  workerServiceName: string | null;
}) {
  return (
    sandbox.state === 'running' &&
    Boolean(app.services.config.sandboxWorkerAuthToken) &&
    Boolean(app.services.config.routerBaseUrl || workerBaseUrlForSandbox(app, sandbox))
  );
}

function requireRunningWorkerEndpoint(
  app: FastifyInstance,
  input: {
    sandbox: {
      id?: string;
      state: string;
      k8sNamespace: string | null;
      workerServiceName: string | null;
    };
    unavailableCode: string;
    unavailableMessage: string;
  },
) {
  if (input.sandbox.state !== 'running') {
    throw new HttpError(
      409,
      'sandbox_not_running',
      'Sandbox must be running before worker operations can run.',
    );
  }
  if (!app.services.config.sandboxWorkerAuthToken) {
    throw new HttpError(
      503,
      input.unavailableCode,
      'Worker control is not configured.',
    );
  }
  const workerBaseUrl = workerBaseUrlForSandbox(app, input.sandbox);
  if (!workerBaseUrl) {
    throw new HttpError(
      409,
      input.unavailableCode,
      input.unavailableMessage,
    );
  }
  return workerBaseUrl.replace(/\/+$/, '');
}

function createBackendRouteToken(
  app: FastifyInstance,
  input: {
    userId: string;
    sandboxId: string;
    projectId?: string | null | undefined;
    workspaceId?: string | null | undefined;
    sessionId?: string | null | undefined;
    scopes: string[];
  },
) {
  const now = Math.floor(Date.now() / 1000);
  const signingKey = app.services.config.routeTokenSigningKeys[0]!;
  return createSignedToken(
    {
      sub: input.userId,
      sandbox_id: input.sandboxId,
      ...(input.projectId ? { project_id: input.projectId } : {}),
      ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      scopes: input.scopes,
      iat: now,
      exp: now + app.services.config.routeTokenTtlSeconds,
      jti: randomUUID(),
    },
    signingKey.secret,
    { kid: signingKey.id },
  );
}

function workerProxyBaseUrl(
  app: FastifyInstance,
  input: {
    sandbox: {
      id: string;
      state: string;
      k8sNamespace: string | null;
      workerServiceName: string | null;
    };
    userId: string;
    projectId?: string | null | undefined;
    workspaceId?: string | null | undefined;
    sessionId?: string | null | undefined;
    scopes: string[];
  },
) {
  if (app.services.config.routerBaseUrl) {
    const base = app.services.config.routerBaseUrl.endsWith('/')
      ? app.services.config.routerBaseUrl.slice(0, -1)
      : app.services.config.routerBaseUrl;
    const routeToken = createBackendRouteToken(app, {
      userId: input.userId,
      sandboxId: input.sandbox.id,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      scopes: input.scopes,
    });
    return {
      workerBaseUrl: `${base}/api/sandboxes/${encodeURIComponent(input.sandbox.id)}`,
      routeToken,
    };
  }
  const workerBaseUrl = requireRunningWorkerEndpoint(app, {
    sandbox: input.sandbox,
    unavailableCode: 'worker_session_unavailable',
    unavailableMessage: 'Sandbox worker endpoint is unavailable.',
  });
  return {
    workerBaseUrl,
    routeToken: null,
  };
}

async function sendWorkerJsonRequest(
  app: FastifyInstance,
  input: {
    workerBaseUrl: string;
    routeToken?: string | null | undefined;
    path: string;
    method?: string;
    body?: unknown;
    workerIdentity?: {
      userId: string;
      projectId?: string | null | undefined;
      sandboxId: string;
      scopes: string[];
    };
    failureCode: string;
    fallbackMessage: string;
  },
) {
  const init: RequestInit = {
    method: input.method ?? 'POST',
    headers: {
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(input.routeToken
        ? { authorization: `Bearer ${input.routeToken}` }
        : { 'x-remote-codex-worker-token': app.services.config.sandboxWorkerAuthToken! }),
      ...(input.workerIdentity
        ? workerIdentityHeaders({
            ...input.workerIdentity,
            secret: app.services.config.sandboxWorkerIdentitySecret,
          })
        : {}),
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  };
  const response = await fetch(`${input.workerBaseUrl}${input.path}`, init).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(503, input.failureCode, `${input.fallbackMessage}: ${message}`);
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : text || input.fallbackMessage;
    throw new HttpError(
      response.status === 404 || response.status === 409 ? 409 : 502,
      input.failureCode,
      message,
    );
  }

  return payload;
}

async function materializeWorkerWorkspace(
  app: FastifyInstance,
  input: {
    sandbox: {
      id: string;
      state: string;
      k8sNamespace: string | null;
      workerServiceName: string | null;
    };
    workspace: {
      id: string;
      userId: string;
      projectId: string | null;
      path: string;
      name: string;
      sourceType: string;
      gitUrl: string | null;
    };
  },
) {
  const { workerBaseUrl, routeToken } = workerProxyBaseUrl(app, {
    sandbox: input.sandbox,
    userId: input.workspace.userId,
    projectId: input.workspace.projectId,
    workspaceId: input.workspace.id,
    scopes: ['worker:read', 'worker:write', 'file:write'],
  });
  const body =
    input.workspace.sourceType === 'git' && input.workspace.gitUrl
      ? {
          gitUrl: input.workspace.gitUrl,
          label: input.workspace.name,
        }
      : {
          absPath: input.workspace.path,
          label: input.workspace.name,
        };

  try {
    return await sendWorkerJsonRequest(app, {
      workerBaseUrl,
      routeToken,
      path: '/api/workspaces',
      body,
      failureCode: 'worker_workspace_unavailable',
      fallbackMessage: 'Worker workspace materialization failed',
    });
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 409) {
      const encodedPath = encodeURIComponent(input.workspace.path);
      const payload = await sendWorkerJsonRequest(app, {
        workerBaseUrl,
        routeToken,
        path: `/api/workspaces?path=${encodedPath}`,
        method: 'GET',
        failureCode: 'worker_workspace_unavailable',
        fallbackMessage: 'Worker workspace lookup failed',
      });
      if (Array.isArray(payload)) {
        const existing = payload.find(
          (workspace) =>
            workspace &&
            typeof workspace === 'object' &&
            'absPath' in workspace &&
            workspace.absPath === input.workspace.path,
        );
        if (existing) {
          return existing;
        }
      }
    }
    throw error;
  }
}

async function materializeSandboxWorkspaces(
  app: FastifyInstance,
  input: {
    userId: string;
    sandbox: {
      id: string;
      state: string;
      k8sNamespace: string | null;
      workerServiceName: string | null;
    };
  },
) {
  const result = app.services.repository.listWorkspaces(input.userId, {
    status: 'active',
  });
  const workspaces = result.items.filter((workspace) => workspace.sandboxId === input.sandbox.id);
  for (const workspace of workspaces) {
    await materializeWorkerWorkspace(app, {
      sandbox: input.sandbox,
      workspace,
    });
  }
}

async function createWorkerThreadSession(
  app: FastifyInstance,
  input: {
    sandbox: {
      id: string;
      state: string;
      k8sNamespace: string | null;
      workerServiceName: string | null;
    };
    workspace: {
      id: string;
      userId: string;
      projectId: string | null;
      path: string;
      name: string;
      sourceType: string;
      gitUrl: string | null;
    };
    provider: 'codex' | 'claude' | 'opencode';
    title: string;
    model?: string | undefined;
  },
) {
  const { workerBaseUrl, routeToken } = workerProxyBaseUrl(app, {
    sandbox: input.sandbox,
    userId: input.workspace.userId,
    projectId: input.workspace.projectId,
    workspaceId: input.workspace.id,
    scopes: ['worker:read', 'worker:write', 'file:write'],
  });
  const workerWorkspace = await materializeWorkerWorkspace(app, {
    sandbox: input.sandbox,
    workspace: input.workspace,
  });
  const workspaceId =
    workerWorkspace &&
    typeof workerWorkspace === 'object' &&
    'id' in workerWorkspace &&
    typeof workerWorkspace.id === 'string'
      ? workerWorkspace.id
      : null;
  if (!workspaceId) {
    throw new HttpError(
      502,
      'worker_workspace_unavailable',
      'Worker workspace materialization did not return a workspace id.',
    );
  }

  const workerThread = await sendWorkerJsonRequest(app, {
    workerBaseUrl,
    routeToken,
    path: '/api/threads/start',
    body: {
      workspaceId,
      provider: input.provider,
      title: input.title,
      model: input.model ?? app.services.config.sandboxWorkerDefaultCodexModel,
      approvalMode: 'yolo',
    },
    failureCode: 'worker_session_unavailable',
    fallbackMessage: 'Worker session creation failed',
  });

  return workerThreadSchema.parse(workerThread);
}

async function sendWorkerThreadPrompt(
  app: FastifyInstance,
  input: {
    sandbox: {
      id: string;
      state: string;
      k8sNamespace: string | null;
      workerServiceName: string | null;
    };
    userId: string;
    projectId?: string | null | undefined;
    sessionId?: string | null | undefined;
    workerSessionId: string;
    prompt: string;
    model?: string | undefined;
  },
) {
  const { workerBaseUrl, routeToken } = workerProxyBaseUrl(app, {
    sandbox: input.sandbox,
    userId: input.userId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    scopes: ['worker:read', 'worker:write', 'provider:turn:create'],
  });
  return sendWorkerJsonRequest(app, {
    workerBaseUrl,
    routeToken,
    path: `/api/threads/${encodeURIComponent(input.workerSessionId)}/prompt`,
    body: {
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
    },
    workerIdentity: {
      userId: input.userId,
      projectId: input.projectId,
      sandboxId: input.sandbox.id,
      scopes: ['provider:turn:create'],
    },
    failureCode: 'worker_turn_unavailable',
    fallbackMessage: 'Worker prompt failed',
  });
}

async function sendWorkerSessionLifecycleRequest(
  app: FastifyInstance,
  input: {
    sandbox: {
      id: string;
      state: string;
      k8sNamespace: string | null;
      workerServiceName: string | null;
    };
    userId: string;
    projectId?: string | null | undefined;
    workspaceId?: string | null | undefined;
    sessionId?: string | null | undefined;
    workerSessionId: string | null;
    action: 'disconnect' | 'resume';
  },
) {
  if (!input.workerSessionId) {
    throw new HttpError(
      409,
      'worker_session_unavailable',
      'Session does not have a worker session id yet.',
    );
  }
  const { workerBaseUrl, routeToken } = workerProxyBaseUrl(app, {
    sandbox: input.sandbox,
    userId: input.userId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    scopes: ['worker:read', 'worker:write'],
  });

  await sendWorkerJsonRequest(app, {
    workerBaseUrl,
    routeToken,
    path: `/api/threads/${encodeURIComponent(input.workerSessionId)}/${input.action}`,
    body: {},
    failureCode: 'worker_session_unavailable',
    fallbackMessage: `Worker session ${input.action} failed`,
  });
}

function quotaExceededError(denial: QuotaDenial) {
  return new HttpError(402, 'quota_exceeded', 'Quota exceeded.', {
    reason: denial.reason,
    quotaProfile: denial.quotaProfile,
    limit: denial.limit,
    used: denial.used,
  });
}

function normalizeUsageImportEvent(
  repository: ControlPlaneRepository,
  event: UsageImportEvent,
): UsageEventInput {
  const gatewayKey = event.gatewayExternalKeyId
    ? repository.getGatewayKeyByExternalId({
        provider: event.provider,
        externalKeyId: event.gatewayExternalKeyId,
      })
    : null;
  const userId = event.userId ?? gatewayKey?.userId;
  const sandboxId = event.sandboxId ?? gatewayKey?.sandboxId;
  if (!userId || !sandboxId) {
    throw new HttpError(
      400,
      'usage_identity_unresolved',
      'Usage import event must include user/sandbox ids or a known gateway key id.',
    );
  }
  const user = repository.getUserById(userId);
  if (!user) {
    throw new HttpError(400, 'usage_identity_unresolved', 'Usage import user could not be resolved.');
  }
  if (user.status !== 'active') {
    throw new HttpError(403, 'account_inactive', 'Usage import user account is not active.');
  }
  return {
    ...event,
    userId,
    sandboxId,
    gatewayKeyId: event.gatewayKeyId ?? gatewayKey?.id ?? null,
  };
}

function gatewayUsageExportEventToImportEvent(
  provider: string,
  event: {
    eventId: string;
    externalKeyId: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    costUsd?: number;
    occurredAt?: string;
  },
): UsageImportEvent {
  return {
    gatewayExternalKeyId: event.externalKeyId,
    provider,
    model: event.model,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cachedTokens: event.cachedTokens,
    costUsd: event.costUsd,
    externalRequestId: event.eventId,
    occurredAt: event.occurredAt,
  };
}

async function importGatewayUsageBatch(app: FastifyInstance, input: {
  cursor?: string | null;
  limit?: number;
  useStoredCursor?: boolean;
}) {
  const repository = app.services.repository;
  const provider = app.services.config.llmGatewayProvider;
  const source = 'gateway';
  const state = input.useStoredCursor
    ? repository.getUsageImportState({ provider, source })
    : null;
  repository.markUsageImportStarted({ provider, source });
  try {
    const gatewayExport = await app.services.llmGatewayAdmin.exportUsage({
      cursor: input.cursor ?? state?.cursor ?? null,
      limit: input.limit ?? 100,
    });
    const inputEvents = gatewayExport.events.map((event) =>
      gatewayUsageExportEventToImportEvent(provider, event),
    );
    const events = inputEvents.map((event) =>
      repository.recordUsageEvent(normalizeUsageImportEvent(repository, event)),
    );
    const metrics = {
      source,
      sourceCount: inputEvents.length,
      importedCount: events.length,
      duplicateCount: Math.max(0, inputEvents.length - new Set(events.map((event) => event.id)).size),
      failureCount: 0,
      nextCursor: gatewayExport.nextCursor ?? null,
    };
    const importState = repository.recordUsageImportMetrics({
      provider,
      source,
      cursor: metrics.nextCursor,
      sourceCount: metrics.sourceCount,
      importedCount: metrics.importedCount,
      duplicateCount: metrics.duplicateCount,
      failureCount: metrics.failureCount,
    });
    repository.audit(null, 'usage.import_completed', 'usage_import', importState.id, {
      provider,
      source,
      sourceCount: metrics.sourceCount,
      importedCount: metrics.importedCount,
      duplicateCount: metrics.duplicateCount,
      failureCount: metrics.failureCount,
      nextCursor: metrics.nextCursor,
    });
    return {
      events,
      import: metrics,
      state: importState,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Usage import failed.';
    const importState = repository.recordUsageImportMetrics({
      provider,
      source,
      sourceCount: 0,
      importedCount: 0,
      duplicateCount: 0,
      failureCount: 1,
      failureMessage: message,
    });
    repository.audit(null, 'usage.import_failed', 'usage_import', importState.id, {
      provider,
      source,
      failureCount: 1,
      message,
    });
    throw error;
  }
}

async function ensureGateway(app: FastifyInstance, user: { id: string; email: string; displayName: string | null }, sandbox: { id: string }) {
  const gatewayUser = await app.services.llmGatewayAdmin.ensureUser({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
  });
  app.services.repository.upsertGatewayUser({
    userId: user.id,
    provider: app.services.config.llmGatewayProvider,
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
    provider: app.services.config.llmGatewayProvider,
    externalKeyId: gatewayKey.externalKeyId,
    keyCiphertext: gatewayKey.keyCiphertext ?? null,
  });
}

function gatewayStartInput(
  app: FastifyInstance,
  sandbox: { id: string },
): SandboxStartInput['gateway'] {
  const gatewayKey = app.services.repository.getGatewayKeyForSandbox(sandbox.id);
  if (!gatewayKey || gatewayKey.status !== 'active' || !app.services.config.llmGatewayBaseUrl) {
    return undefined;
  }
  return {
    baseUrl: app.services.config.llmGatewayBaseUrl,
    keyId: app.services.config.llmGatewayStaticTokenSecretKey ?? gatewayKey.externalKeyId,
    tokenSecretName: app.services.config.llmGatewayTokenSecretName,
  };
}

function harnessStartInput(app: FastifyInstance): SandboxStartInput['harness'] {
  if (!app.services.config.harnessBaseUrl) {
    return undefined;
  }
  return {
    baseUrl: app.services.config.harnessBaseUrl,
    appKeySecretName: app.services.config.harnessAppKeySecretName,
    chemistryToolsEnabled: app.services.config.chemistryToolsEnabled,
  };
}

function hasAwsSandboxConfig(env: NodeJS.ProcessEnv) {
  return Boolean(
    env.SANDBOX_EKS_CLUSTER_NAME &&
      env.SANDBOX_K8S_SERVICE_ACCOUNT &&
      env.SANDBOX_WORKER_IMAGE_REPOSITORY &&
      env.SANDBOX_WORKER_IMAGE_TAG &&
      env.SANDBOX_ROUTER_BASE_URL &&
      env.SANDBOX_WORKER_AUTH_TOKEN_SECRET_NAME &&
      env.SANDBOX_SUBNET_IDS &&
      env.SANDBOX_SECURITY_GROUP_IDS,
  );
}

function defaultSandboxManager(env: NodeJS.ProcessEnv, routerBaseUrl: string): SandboxManager {
  if (!hasAwsSandboxConfig(env)) {
    return new NoopSandboxManager(routerBaseUrl);
  }
  return new AwsEksFargateSandboxManager(
    loadAwsSandboxAdapterConfig(env),
    new KubectlAwsSandboxKubernetesClient(),
  );
}

function originAllowed(config: ControlPlaneConfig, origin: string) {
  return config.corsAllowedOrigins.has(origin) || config.corsAllowedOrigins.has('*');
}

function registerCorsHooks(app: FastifyInstance, config: ControlPlaneConfig) {
  app.addHook('onRequest', (request, reply, done) => {
    const origin = request.headers.origin;
    if (typeof origin === 'string' && originAllowed(config, origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      reply.header(
        'Access-Control-Allow-Headers',
        'authorization,content-type,x-remote-codex-service-token',
      );
      reply.header('Access-Control-Max-Age', '600');
    }

    if (request.method === 'OPTIONS') {
      reply.status(204).send();
      return;
    }

    done();
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
    productSessionSecret: config.productSessionSecret,
  });

  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: CONTROL_PLANE_LOG_REDACTION_PATHS,
              censor: '[redacted]',
            },
          },
    disableRequestLogging: config.disableRequestLogging,
  });

  registerCorsHooks(app, config);

  const runtimeEnv = options.env ?? process.env;
  const sandboxManager = options.sandboxManager ?? defaultSandboxManager(runtimeEnv, config.routerBaseUrl);
  const services: ControlPlaneServices = {
    config,
    database,
    repository,
    sandboxManager,
    llmGatewayAdmin:
      options.llmGatewayAdmin ??
      (config.llmGatewayAdminBaseUrl && config.llmGatewayAdminToken
        ? new HttpLlmGatewayAdmin({
            baseUrl: config.llmGatewayAdminBaseUrl,
            adminToken: config.llmGatewayAdminToken,
          })
        : new NoopLlmGatewayAdmin()),
    authVerifier,
    sandboxReaper: new SandboxReaper({
      repository,
      sandboxManager,
    }),
  };

  app.decorate('services', services);

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

  app.post('/api/auth/password/register', async (request) => {
    const input = emailPasswordAuthSchema.parse(request.body);
    const email = normalizeEmail(input.email);
    if (repository.getPasswordCredentialByEmail(email)) {
      throw new HttpError(409, 'conflict', 'An account already exists for this email.');
    }
    const user =
      repository.getUserByEmail(email) ??
      repository.upsertUser({
        authProvider: 'password',
        authSubject: email,
        email,
        displayName: input.displayName ?? email.split('@')[0],
      });
    repository.upsertAuthIdentity({
      userId: user.id,
      authProvider: 'password',
      authSubject: email,
      email,
      displayName: input.displayName ?? user.displayName,
    });
    repository.upsertPasswordCredential({
      userId: user.id,
      email,
      passwordHash: passwordHash(input.password),
    });
    return sessionResponse(app, repository.getUserById(user.id)!);
  });

  app.post('/api/auth/password/login', async (request) => {
    const input = emailPasswordAuthSchema.omit({ displayName: true }).parse(request.body);
    const credential = repository.getPasswordCredentialByEmail(input.email);
    if (!credential || !verifyPassword(input.password, credential.passwordHash)) {
      throw new HttpError(401, 'unauthorized', 'Email or password is incorrect.');
    }
    repository.markPasswordCredentialUsed(credential.id);
    const user = repository.getUserById(credential.userId);
    if (!user || user.status !== 'active') {
      throw new HttpError(403, 'account_inactive', 'Account is not active.');
    }
    repository.upsertUser({
      authProvider: user.authProvider,
      authSubject: user.authSubject,
      email: user.email,
      displayName: user.displayName,
    });
    return sessionResponse(app, repository.getUserById(user.id)!);
  });

  app.get('/api/auth/oauth/:provider/start', async (request, reply) => {
    const params = z.object({ provider: oauthProviderSchema }).parse(request.params);
    const query = z.object({ returnTo: z.string().url().optional() }).parse(request.query);
    const state = oauthState(config, {
      provider: params.provider,
      returnTo: allowedOAuthReturnUrl(config, query.returnTo),
    });
    if (params.provider === 'google') {
      if (!config.googleClientId || !config.googleClientSecret) {
        throw new HttpError(503, 'service_unavailable', 'Google login is not configured.');
      }
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', config.googleClientId);
      url.searchParams.set('redirect_uri', controlPlaneCallbackUrl(config, 'google'));
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('access_type', 'online');
      reply.redirect(url.toString());
      return;
    }
    if (!config.githubClientId || !config.githubClientSecret) {
      throw new HttpError(503, 'service_unavailable', 'GitHub login is not configured.');
    }
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', config.githubClientId);
    url.searchParams.set('redirect_uri', controlPlaneCallbackUrl(config, 'github'));
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('state', state);
    reply.redirect(url.toString());
  });

  app.get('/api/auth/oauth/:provider/callback', async (request, reply) => {
    const params = z.object({ provider: oauthProviderSchema }).parse(request.params);
    const query = z
      .object({
        code: z.string().min(1).optional(),
        state: z.string().min(1).optional(),
        error: z.string().min(1).optional(),
      })
      .parse(request.query);
    const returnTo = query.state
      ? verifyOAuthState(config, query.state, params.provider)
      : frontendOAuthReturnUrl(config);
    const redirectUrl = new URL(returnTo ?? frontendOAuthReturnUrl(config));
    if (query.error || !query.code) {
      redirectUrl.searchParams.set('auth_error', query.error ?? 'oauth_cancelled');
      reply.redirect(redirectUrl.toString());
      return;
    }
    const profile =
      params.provider === 'google'
        ? await fetchGoogleProfile(config, query.code)
        : await fetchGitHubProfile(config, query.code);
    const user = upsertOAuthUser(repository, profile);
    const session = createProductSessionToken(config, user);
    redirectUrl.searchParams.set('control_plane_token', session.token);
    redirectUrl.searchParams.set('control_plane_expires_at', session.expiresAt);
    redirectUrl.searchParams.set('control_plane_base_url', config.publicBaseUrl);
    reply.redirect(redirectUrl.toString());
  });

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
      resourceProfile: config.sandboxDefaultResourceProfile,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const gatewayKey = await ensureGateway(app, user, sandbox);
    return { user, sandbox, gatewayKey: redactGatewayKey(gatewayKey) };
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
      resourceProfile: config.sandboxDefaultResourceProfile,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const gatewayKey = await ensureGateway(app, user, sandbox);
    return { user, sandbox, gatewayKey: redactGatewayKey(gatewayKey) };
  });

  app.get('/api/me', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      resourceProfile: config.sandboxDefaultResourceProfile,
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
    if (!input.events) {
      return importGatewayUsageBatch(app, {
        cursor: input.cursor ?? null,
        limit: input.limit ?? 100,
      });
    }
    const inputEvents = input.events;
    const events = inputEvents.map((event) =>
      repository.recordUsageEvent(normalizeUsageImportEvent(repository, event)),
    );
    return {
      events,
      import: {
        source: input.events ? 'manual' : 'gateway',
        sourceCount: inputEvents.length,
        importedCount: events.length,
        duplicateCount: Math.max(0, inputEvents.length - new Set(events.map((event) => event.id)).size),
        failureCount: 0,
        nextCursor: null,
      },
    };
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

  app.post('/api/internal/sessions/:sessionId/checkpoint', async (request) => {
    requireInternalService(app, request);
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const input = checkpointSessionSchema.parse(request.body);
    const session = repository.getSessionById(params.sessionId);
    if (!session) {
      repository.audit(input.userId, 'session.checkpoint_failed', 'session', params.sessionId, {
        reason: 'session_not_found',
        sandboxId: input.sandboxId,
      });
      throw new HttpError(404, 'not_found', 'Session not found.');
    }
    if (session.userId !== input.userId) {
      repository.audit(session.userId, 'session.checkpoint_failed', 'session', session.id, {
        reason: 'wrong_user',
        expectedUserId: session.userId,
        receivedUserId: input.userId,
        sandboxId: input.sandboxId,
      });
      throw new HttpError(403, 'wrong_user', 'Checkpoint user does not match session owner.');
    }
    if (session.sandboxId !== input.sandboxId) {
      repository.audit(session.userId, 'session.checkpoint_failed', 'session', session.id, {
        reason: 'wrong_sandbox',
        expectedSandboxId: session.sandboxId,
        receivedSandboxId: input.sandboxId,
      });
      throw new HttpError(403, 'wrong_sandbox', 'Checkpoint sandbox does not match session sandbox.');
    }
    return {
      session: repository.checkpointSession(session.id, {
        workerSessionId: input.workerSessionId,
        status: input.status,
      }),
    };
  });

  app.post('/api/internal/sandboxes/reap', async (request) => {
    requireInternalService(app, request);
    return {
      reaper: await app.services.sandboxReaper.runOnce(),
    };
  });

  app.post('/api/internal/jobs/usage-import', async (request) => {
    requireInternalService(app, request);
    const input = z
      .object({
        limit: z.number().int().positive().max(500).optional(),
      })
      .parse(request.body ?? {});
    return importGatewayUsageBatch(app, {
      limit: input.limit ?? 100,
      useStoredCursor: true,
    });
  });

  app.get('/api/admin/sandboxes', async (request) => {
    requireAdmin(app, request);
    return {
      sandboxes: repository.listSandboxes(),
    };
  });

  app.get('/api/admin/sandboxes/:sandboxId', async (request) => {
    requireAdmin(app, request);
    const params = z.object({ sandboxId: z.string().uuid() }).parse(request.params);
    const sandbox = repository.getSandboxById(params.sandboxId);
    if (!sandbox) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    const [runtimeStatus, endpoint] = await Promise.all([
      app.services.sandboxManager.getSandboxStatus({
        sandboxId: sandbox.id,
        userId: sandbox.userId,
      }),
      app.services.sandboxManager.getSandboxEndpoint({
        sandboxId: sandbox.id,
        userId: sandbox.userId,
      }),
    ]);
    return {
      sandbox,
      runtimeStatus,
      endpoint,
      workerBaseUrl: workerBaseUrlForSandbox(app, sandbox),
      recentLifecycleErrors: repository.listRecentAuditLogs({
        resourceId: sandbox.id,
        actionPrefix: 'sandbox.',
        limit: 20,
      }),
    };
  });

  app.post('/api/admin/sandboxes/:sandboxId/force-stop', async (request) => {
    const admin = requireAdmin(app, request);
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
        auditMetadata: {
          operatorUserId: admin.id,
          operatorIdentity: identityKey(admin.authProvider, admin.authSubject),
          reason: input.reason ?? null,
          adminAction: 'force-stop',
        },
      }),
    };
  });

  app.post('/api/admin/sandboxes/:sandboxId/restart', async (request) => {
    const admin = requireAdmin(app, request);
    const params = z.object({ sandboxId: z.string().uuid() }).parse(request.params);
    const input = adminSandboxReasonSchema.parse(request.body ?? {});
    const sandbox = repository.getSandboxById(params.sandboxId);
    if (!sandbox) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    const runtimeSandbox = repository.patchSandbox(sandbox.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      resourceProfile: config.sandboxDefaultResourceProfile,
    }) ?? sandbox;
    const result = await app.services.sandboxManager.restartSandbox({
      sandboxId: runtimeSandbox.id,
      userId: runtimeSandbox.userId,
      image: runtimeSandbox.image,
      region: runtimeSandbox.region,
      s3Prefix: runtimeSandbox.s3Prefix,
      enabledAgentProviders: config.sandboxWorkerEnabledAgentProviders,
      gateway: gatewayStartInput(app, runtimeSandbox),
      harness: harnessStartInput(app),
    });
    const updatedSandbox = repository.updateSandboxState(runtimeSandbox.id, {
      ...result,
      statusReason: input.reason ?? result.statusReason ?? 'restarted by administrator',
      auditMetadata: {
        operatorUserId: admin.id,
        operatorIdentity: identityKey(admin.authProvider, admin.authSubject),
        reason: input.reason ?? null,
        adminAction: 'restart',
      },
    });
    if (updatedSandbox && canControlRunningWorker(app, updatedSandbox)) {
      await materializeSandboxWorkspaces(app, {
        userId: updatedSandbox.userId,
        sandbox: updatedSandbox,
      });
    }
    return {
      sandbox: updatedSandbox,
    };
  });

  app.post('/api/admin/sandboxes/:sandboxId/gateway-key/rotate', async (request) => {
    requireAdmin(app, request);
    const params = z.object({ sandboxId: z.string().uuid() }).parse(request.params);
    const { sandbox, gatewayKey, gatewayUser } = requireGatewayKeyContext(app, params.sandboxId);
    const rotated = await app.services.llmGatewayAdmin.rotateSandboxKey({
      userId: sandbox.userId,
      sandboxId: sandbox.id,
      externalUserId: gatewayUser.externalUserId,
      externalKeyId: gatewayKey.externalKeyId,
    });
    return {
      gatewayKey: redactGatewayKey(
        repository.updateGatewayKeyRotation({
          sandboxId: sandbox.id,
          provider: gatewayKey.provider,
          externalKeyId: rotated.externalKeyId,
          keyCiphertext: rotated.keyCiphertext ?? null,
        }),
      ),
    };
  });

  app.post('/api/admin/sandboxes/:sandboxId/gateway-key/revoke', async (request) => {
    requireAdmin(app, request);
    const params = z.object({ sandboxId: z.string().uuid() }).parse(request.params);
    const { sandbox, gatewayKey, gatewayUser } = requireGatewayKeyContext(app, params.sandboxId);
    await app.services.llmGatewayAdmin.revokeSandboxKey({
      userId: sandbox.userId,
      sandboxId: sandbox.id,
      externalUserId: gatewayUser.externalUserId,
      externalKeyId: gatewayKey.externalKeyId,
    });
    return {
      gatewayKey: redactGatewayKey(
        repository.revokeGatewayKey({
          sandboxId: sandbox.id,
          provider: gatewayKey.provider,
        }),
      ),
    };
  });

  app.post('/api/admin/sandboxes/:sandboxId/gateway-key/reconcile', async (request) => {
    requireAdmin(app, request);
    const params = z.object({ sandboxId: z.string().uuid() }).parse(request.params);
    const sandbox = repository.getSandboxById(params.sandboxId);
    if (!sandbox) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    const user = repository.getUserById(sandbox.userId);
    if (!user) {
      throw new HttpError(409, 'user_missing', 'Sandbox user is missing.');
    }
    const gatewayUser = await app.services.llmGatewayAdmin.ensureUser({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
    });
    repository.upsertGatewayUser({
      userId: user.id,
      provider: config.llmGatewayProvider,
      externalUserId: gatewayUser.externalUserId,
    });
    const existingGatewayKey = repository.getGatewayKeyForSandbox(sandbox.id);
    const reconciled = await app.services.llmGatewayAdmin.reconcileSandboxKey({
      userId: user.id,
      sandboxId: sandbox.id,
      externalUserId: gatewayUser.externalUserId,
      externalKeyId: existingGatewayKey?.externalKeyId ?? null,
    });
    const gatewayKey = existingGatewayKey
      ? repository.updateGatewayKeyRotation({
          sandboxId: sandbox.id,
          provider: existingGatewayKey.provider,
          externalKeyId: reconciled.externalKeyId,
          keyCiphertext: reconciled.keyCiphertext ?? null,
        })
      : repository.upsertGatewayKey({
          userId: user.id,
          sandboxId: sandbox.id,
          provider: config.llmGatewayProvider,
          externalKeyId: reconciled.externalKeyId,
          keyCiphertext: reconciled.keyCiphertext ?? null,
        });
    return { gatewayKey: redactGatewayKey(gatewayKey) };
  });

  app.get('/api/sandbox', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      resourceProfile: config.sandboxDefaultResourceProfile,
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
    const updatedSandbox = repository.updateSandboxState(sandbox.id, status);
    return {
      sandbox: updatedSandbox,
      status,
      endpoint,
    };
  });

  app.post('/api/sandbox/start', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      resourceProfile: config.sandboxDefaultResourceProfile,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const runtimeSandbox = repository.patchSandbox(sandbox.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      resourceProfile: config.sandboxDefaultResourceProfile,
    }) ?? sandbox;
    const result = await app.services.sandboxManager.startSandbox({
      sandboxId: runtimeSandbox.id,
      userId: user.id,
      image: runtimeSandbox.image,
      region: runtimeSandbox.region,
      s3Prefix: runtimeSandbox.s3Prefix,
      enabledAgentProviders: config.sandboxWorkerEnabledAgentProviders,
      gateway: gatewayStartInput(app, runtimeSandbox),
      harness: harnessStartInput(app),
    });
    const updatedSandbox = repository.updateSandboxState(runtimeSandbox.id, result);
    if (updatedSandbox && canControlRunningWorker(app, updatedSandbox)) {
      await materializeSandboxWorkspaces(app, {
        userId: user.id,
        sandbox: updatedSandbox,
      });
    }
    return {
      sandbox: updatedSandbox,
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
    const runtimeSandbox = repository.patchSandbox(sandbox.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      resourceProfile: config.sandboxDefaultResourceProfile,
    }) ?? sandbox;
    const result = await app.services.sandboxManager.restartSandbox({
      sandboxId: runtimeSandbox.id,
      userId: user.id,
      image: runtimeSandbox.image,
      region: runtimeSandbox.region,
      s3Prefix: runtimeSandbox.s3Prefix,
      enabledAgentProviders: config.sandboxWorkerEnabledAgentProviders,
      gateway: gatewayStartInput(app, runtimeSandbox),
      harness: harnessStartInput(app),
    });
    const updatedSandbox = repository.updateSandboxState(runtimeSandbox.id, result);
    if (updatedSandbox && canControlRunningWorker(app, updatedSandbox)) {
      await materializeSandboxWorkspaces(app, {
        userId: user.id,
        sandbox: updatedSandbox,
      });
    }
    return {
      sandbox: updatedSandbox,
    };
  });

  app.get('/api/projects', async (request) => {
    const user = requireUser(app, request);
    const query = productListQuerySchema
      .extend({
        status: z.enum(['active', 'archived']).optional(),
      })
      .parse(request.query);
    const result = repository.listProjects(user.id, {
      pagination: {
        limit: query.limit,
        offset: query.offset,
      },
      search: query.search,
      status: query.status,
    });
    return { projects: result.items, page: result.page };
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
    const query = productListQuerySchema
      .extend({
        status: z.enum(['active', 'archived', 'deleted']).optional(),
      })
      .parse(request.query);
    const project = repository.getProjectById(params.projectId);
    if (!project || project.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Project not found.');
    }
    const result = repository.listWorkspaces(user.id, {
      projectId: project.id,
      pagination: {
        limit: query.limit,
        offset: query.offset,
      },
      search: query.search,
      status: query.status,
    });
    return { workspaces: result.items, page: result.page };
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
      resourceProfile: config.sandboxDefaultResourceProfile,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const input = createWorkspaceSchema.omit({ projectId: true }).parse(request.body);
    const workspace = repository.createWorkspace({
      userId: user.id,
      sandboxId: sandbox.id,
      projectId: project.id,
      ...input,
    });
    const runningSandbox = repository.getSandboxById(sandbox.id);
    if (runningSandbox && canControlRunningWorker(app, runningSandbox)) {
      await materializeWorkerWorkspace(app, {
        sandbox: runningSandbox,
        workspace,
      });
    }
    return {
      workspace,
    };
  });

  app.get('/api/workspaces', async (request) => {
    const user = requireUser(app, request);
    const query = z
      .object({
        projectId: z.string().uuid().optional(),
      })
      .merge(
        productListQuerySchema.extend({
          status: z.enum(['active', 'archived', 'deleted']).optional(),
        }),
      )
      .parse(request.query);
    if (query.projectId) {
      const project = repository.getProjectById(query.projectId);
      if (!project || project.userId !== user.id) {
        throw new HttpError(404, 'not_found', 'Project not found.');
      }
    }
    const result = repository.listWorkspaces(user.id, {
      projectId: query.projectId,
      pagination: {
        limit: query.limit,
        offset: query.offset,
      },
      search: query.search,
      status: query.status,
    });
    return { workspaces: result.items, page: result.page };
  });

  app.post('/api/workspaces', async (request) => {
    const user = requireUser(app, request);
    const sandbox = repository.ensureSandboxForUser(user.id, {
      image: config.sandboxDefaultImage,
      region: config.sandboxDefaultRegion,
      resourceProfile: config.sandboxDefaultResourceProfile,
      s3PrefixBase: config.sandboxS3PrefixBase,
    });
    const input = createWorkspaceSchema.parse(request.body);
    if (input.projectId) {
      const project = repository.getProjectById(input.projectId);
      if (!project || project.userId !== user.id) {
        throw new HttpError(404, 'not_found', 'Project not found.');
      }
    }
    const workspace = repository.createWorkspace({
      userId: user.id,
      sandboxId: sandbox.id,
      ...input,
    });
    const runningSandbox = repository.getSandboxById(sandbox.id);
    if (runningSandbox && canControlRunningWorker(app, runningSandbox)) {
      await materializeWorkerWorkspace(app, {
        sandbox: runningSandbox,
        workspace,
      });
    }
    return {
      workspace,
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
    const query = productListQuerySchema
      .extend({
        status: z.enum(['created', 'active', 'idle', 'archived', 'deleted']).optional(),
        provider: z.string().trim().min(1).max(50).optional(),
      })
      .parse(request.query);
    const workspace = repository.getWorkspaceById(params.workspaceId);
    if (!workspace || workspace.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Workspace not found.');
    }
    const result = repository.listSessionsForWorkspace(workspace.id, {
      pagination: {
        limit: query.limit,
        offset: query.offset,
      },
      search: query.search,
      status: query.status,
      provider: query.provider,
    });
    return { sessions: result.items, page: result.page };
  });

  app.post('/api/workspaces/:workspaceId/sessions', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const workspace = repository.getWorkspaceById(params.workspaceId);
    if (!workspace || workspace.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Workspace not found.');
    }
    const input = createSessionSchema.parse(request.body);
    const sandbox = repository.getSandboxById(workspace.sandboxId);
    if (!sandbox || sandbox.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    const workerThread =
      canControlRunningWorker(app, sandbox)
        ? await createWorkerThreadSession(app, {
            sandbox,
            workspace,
            provider: input.provider,
            title: input.title,
            ...(input.model ? { model: input.model } : {}),
          })
        : null;
    const session = repository.createSession({
      userId: user.id,
      sandboxId: workspace.sandboxId,
      workspaceId: workspace.id,
      provider: input.provider,
      title: input.title,
    });
    const updatedSession = workerThread
      ? repository.updateSession(session.id, {
          status: 'active',
          workerSessionId: workerThread.id,
        })
      : session;
    return {
      session: updatedSession,
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

  app.post('/api/sessions/:sessionId/close', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const session = repository.getSessionById(params.sessionId);
    if (!session || session.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Session not found.');
    }
    const sandbox = repository.getSandboxById(session.sandboxId);
    if (!sandbox || sandbox.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    await sendWorkerSessionLifecycleRequest(app, {
      sandbox,
      userId: user.id,
      projectId: repository.getWorkspaceById(session.workspaceId)?.projectId,
      workspaceId: session.workspaceId,
      sessionId: session.id,
      workerSessionId: session.workerSessionId,
      action: 'disconnect',
    });
    return {
      session: repository.updateSession(session.id, { status: 'idle' }),
    };
  });

  app.post('/api/sessions/:sessionId/resume', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const session = repository.getSessionById(params.sessionId);
    if (!session || session.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Session not found.');
    }
    const sandbox = repository.getSandboxById(session.sandboxId);
    if (!sandbox || sandbox.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    const workspace = repository.getWorkspaceById(session.workspaceId);
    if (!workspace || workspace.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Workspace not found.');
    }

    if (!session.workerSessionId) {
      if (!canControlRunningWorker(app, sandbox)) {
        throw new HttpError(
          409,
          'worker_session_unavailable',
          'Sandbox must be running before this session can be started in the worker.',
        );
      }
      const provider = createSessionSchema.shape.provider.parse(session.provider);
      const workerThread = await createWorkerThreadSession(app, {
        sandbox,
        workspace,
        provider,
        title: session.title,
      });
      return {
        session: repository.updateSession(session.id, {
          status: 'active',
          workerSessionId: workerThread.id,
        }),
      };
    }

    await sendWorkerSessionLifecycleRequest(app, {
      sandbox,
      userId: user.id,
      projectId: workspace.projectId,
      workspaceId: session.workspaceId,
      sessionId: session.id,
      workerSessionId: session.workerSessionId,
      action: 'resume',
    });
    return {
      session: repository.updateSession(session.id, { status: 'active' }),
    };
  });

  app.post('/api/sessions/:sessionId/prompt', async (request) => {
    const user = requireUser(app, request);
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const input = sendSessionPromptSchema.parse(request.body);
    const session = repository.getSessionById(params.sessionId);
    if (!session || session.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Session not found.');
    }
    const sandbox = repository.getSandboxById(session.sandboxId);
    if (!sandbox || sandbox.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Sandbox not found.');
    }
    if (!session.workerSessionId) {
      throw new HttpError(
        409,
        'worker_session_unavailable',
        'Session does not have a worker session id yet.',
      );
    }
    const workspace = repository.getWorkspaceById(session.workspaceId);
    if (!workspace || workspace.userId !== user.id) {
      throw new HttpError(404, 'not_found', 'Workspace not found.');
    }
    const turn = await sendWorkerThreadPrompt(app, {
      sandbox,
      userId: user.id,
      projectId: workspace.projectId,
      sessionId: session.id,
      workerSessionId: session.workerSessionId,
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
    });
    return {
      session: repository.updateSession(session.id, { status: 'active' }),
      turn,
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
    if (input.projectId) {
      const project = repository.getProjectById(input.projectId);
      if (!project || project.userId !== user.id) {
        throw new HttpError(404, 'not_found', 'Project not found.');
      }
    }
    let workspaceProjectId: string | null = null;
    if (input.workspaceId) {
      const workspace = repository.getWorkspaceById(input.workspaceId);
      if (!workspace || workspace.userId !== user.id || workspace.sandboxId !== sandbox.id) {
        throw new HttpError(404, 'not_found', 'Workspace not found.');
      }
      workspaceProjectId = workspace.projectId;
      if (input.projectId && workspace.projectId !== input.projectId) {
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
      if (input.workspaceId && session.workspaceId !== input.workspaceId) {
        throw new HttpError(404, 'not_found', 'Session not found.');
      }
      if (input.projectId && !input.workspaceId) {
        const sessionWorkspace = repository.getWorkspaceById(session.workspaceId);
        if (!sessionWorkspace || sessionWorkspace.projectId !== input.projectId) {
          throw new HttpError(404, 'not_found', 'Session not found.');
        }
        workspaceProjectId = sessionWorkspace.projectId;
      }
    }
    const projectId = input.projectId ?? workspaceProjectId ?? undefined;

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
        ...(projectId ? { project_id: projectId } : {}),
        ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
      },
      signingKey.secret,
      { kid: signingKey.id },
    );

    repository.audit(user.id, 'route_token.issued', 'sandbox', sandbox.id, {
      projectId: projectId ?? null,
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      scopes: input.scopes,
    });

    const routerBaseUrl = config.routerBaseUrl || sandbox.routerBaseUrl;
    if (!routerBaseUrl) {
      throw new HttpError(409, 'sandbox_route_unavailable', 'Sandbox router endpoint is unavailable.');
    }
    return {
      sandboxId: sandbox.id,
      routerBaseUrl,
      wsBaseUrl: routerBaseUrl.replace(/^http/, 'ws'),
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
