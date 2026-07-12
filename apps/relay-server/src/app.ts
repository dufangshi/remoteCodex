import websocket from '@fastify/websocket';
import Fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import { z } from 'zod';

import type {
  ApiErrorShape,
  RelayAccessEventKindDto,
  RelayAdminSummaryDto,
  RelayAdminThreadDto,
  RelayAdminWorkspaceDto,
  RelayEffectiveAccessDto,
  RelayHealthDto,
  RelayHostedSandboxCapabilityDto,
  RelayHttpResponsePayload,
  RelayPortalSummaryDto,
  RelaySessionShareDto,
  RelaySupervisorEnvelope,
  RelayUserDto,
  SupervisorSocketServerEnvelope,
} from '../../../packages/shared/src/index';
import type { RelayServerConfig } from './config';
import { RelayRequestBroker } from './request-broker';
import {
  createHostedSandboxProvider,
  HostedSandboxCapabilityService,
  type HostedSandboxProvider,
} from './hosted-sandbox-provider';
import { HostedSandboxReconciler } from './hosted-sandbox-reconciler';
import { HostedSandboxService } from './hosted-sandbox-service';
import {
  DeviceConnectionStatus,
  RelayStore,
  RelayStoreError,
} from './relay-store';
import type { EffectiveRelayAccess } from './relay-store';

interface SupervisorConnection extends DeviceConnectionStatus {
  deviceId: string;
  socket: { send: (message: string) => void; readyState: number };
  requestBroker: RelayRequestBroker;
  clientSockets: Map<
    string,
    {
      socket: {
        send: (message: string) => void;
        readyState: number;
        close: (code?: number, reason?: string) => void;
      };
      threadId: string | null;
      deviceId: string;
      user: RelayUserDto;
      access: EffectiveRelayAccess;
    }
  >;
}

interface RelayState {
  supervisors: Map<string, SupervisorConnection>;
}

interface AuthenticatedRelayRequest extends FastifyRequest {
  relayUser: RelayUserDto;
}

const RELAY_REQUEST_TIMEOUT_MS = 30_000;
const RELAY_PORTAL_METADATA_TIMEOUT_MS = 900;
const WEBSOCKET_OPEN = 1;
const hostedBootstrapPromises = new Map<string, Promise<void>>();
const RELAY_COOKIE_NAME = 'remote_codex_relay_session';
const threadAccessSchema = z.enum(['read', 'control']);
const workspaceAccessSchema = z.enum(['none', 'read', 'write']);
const grantScopeSchema = z.enum(['thread', 'workspace', 'device']);
const workspaceScopeSchema = z.enum(['all', 'selected']);

const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});
const registerSchema = z.object({
  email: z.string().trim().email(),
  username: z.string().trim().min(3),
  password: z.string().min(8),
  registrationPassword: z.string().optional(),
});
const createDeviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
const hostedCodexConfigSchema = z
  .object({
    modelProvider: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/),
    model: z.string().trim().min(1).max(120),
    reviewModel: z.string().trim().min(1).max(120),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']),
    baseUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://'), 'HTTPS is required.'),
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
  });
const createHostedSandboxSchema = z
  .object({
    assignedUserIds: z.array(z.string().uuid()).min(1).max(20),
    deviceName: z.string().trim().min(1).max(120),
    imageVersion: z.enum([
      'ubuntu-24.04-v1',
      'ubuntu-24.04-v2',
      'ubuntu-24.04-v3',
      'ubuntu-24.04-v4',
      'ubuntu-24.04-v5',
    ]),
    resources: z.object({
      cpuCount: z.number().int().min(1).max(2),
      memoryMiB: z.number().int().min(1024).max(2048),
      diskGiB: z.number().int().min(10).max(12),
    }),
    backends: z.array(z.literal('codex')).length(1),
    codexFiles: z.object({
      configToml: z.string().min(1).max(128 * 1024),
      authJson: z.string().min(2).max(128 * 1024),
    }),
  })
  .strict();
const updateHostedSandboxMembersSchema = z
  .object({
    assignedUserIds: z.array(z.string().uuid()).min(1).max(20),
  })
  .strict();
const updateHostedSandboxSettingsSchema = z
  .object({ workspaceIsolationEnabled: z.boolean() })
  .strict();
const hostedSnapshotSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/),
});
const rotateHostedCredentialSchema = z
  .object({ openaiApiKey: z.string().min(20).max(512) })
  .strict();
const hostedCodexFilesSchema = z
  .object({
    configToml: z
      .string()
      .min(1)
      .max(128 * 1024),
    authJson: z
      .string()
      .min(2)
      .max(128 * 1024),
  })
  .strict();
const createShareSchema = z
  .object({
    targetIdentifier: z.string().trim().min(1).optional(),
    targetUsername: z.string().trim().min(3).optional(),
    deviceId: z.string().uuid(),
    threadId: z.string().trim().min(1),
    workspaceId: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1).max(160).nullable().optional(),
    threadAccess: threadAccessSchema.default('control'),
    workspaceAccess: workspaceAccessSchema.default('none'),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((input) => input.targetIdentifier || input.targetUsername, {
    message: 'targetIdentifier is required.',
    path: ['targetIdentifier'],
  });
const updateShareSchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(160).nullable().optional(),
  threadAccess: threadAccessSchema.optional(),
  workspaceAccess: workspaceAccessSchema.optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
const createGrantSchema = z
  .object({
    targetIdentifier: z.string().trim().min(1).optional(),
    targetUsername: z.string().trim().min(3).optional(),
    deviceId: z.string().uuid(),
    scope: grantScopeSchema,
    threadId: z.string().trim().min(1).nullable().optional(),
    workspaceId: z.string().uuid().nullable().optional(),
    workspaceScope: workspaceScopeSchema.default('all'),
    workspaceIds: z.array(z.string().uuid()).default([]),
    label: z.string().trim().min(1).max(160).nullable().optional(),
    threadAccess: threadAccessSchema.default('control'),
    workspaceAccess: workspaceAccessSchema.default('none'),
    canCreateThreads: z.boolean().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((input) => input.targetIdentifier || input.targetUsername, {
    message: 'targetIdentifier is required.',
    path: ['targetIdentifier'],
  })
  .refine((input) => input.scope !== 'thread' || Boolean(input.threadId), {
    message: 'threadId is required for thread grants.',
    path: ['threadId'],
  })
  .refine(
    (input) => input.scope !== 'workspace' || Boolean(input.workspaceId),
    {
      message: 'workspaceId is required for workspace grants.',
      path: ['workspaceId'],
    },
  );
const updateGrantSchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  workspaceScope: workspaceScopeSchema.optional(),
  workspaceIds: z.array(z.string().uuid()).optional(),
  label: z.string().trim().min(1).max(160).nullable().optional(),
  threadAccess: threadAccessSchema.optional(),
  workspaceAccess: workspaceAccessSchema.optional(),
  canCreateThreads: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
const setEnabledSchema = z.object({
  enabled: z.boolean(),
});
const adminResetPasswordSchema = z.object({
  password: z.string().min(8),
});
const adminQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).optional(),
});
const updateRegistrationSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  registrationPassword: z.string().nullable().optional(),
  approvalRequired: z.boolean().optional(),
  googleAuthEnabled: z.boolean().optional(),
  githubAuthEnabled: z.boolean().optional(),
  emailVerificationEnabled: z.boolean().optional(),
});
const updateAccountSchema = z.object({
  username: z.string().trim().min(3).optional(),
});
const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
const relayAccessQuerySchema = z.object({
  deviceId: z.string().uuid(),
  threadId: z.string().trim().min(1).optional(),
  workspaceId: z.string().uuid().optional(),
});

export interface RelayServerBuildOptions {
  env?: NodeJS.ProcessEnv;
  hostedSandboxProvider?: HostedSandboxProvider;
}

const DEFAULT_WEBVIEW_CORS_ORIGINS = new Set([
  'null',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
]);
const WEBVIEW_CORS_ALLOW_HEADERS = ['authorization', 'content-type'].join(', ');
const WEBVIEW_CORS_ALLOW_METHODS = [
  'GET',
  'POST',
  'PATCH',
  'PUT',
  'DELETE',
  'OPTIONS',
].join(', ');
const RELAY_REQUEST_HEADER_BLOCKLIST = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'expect',
  'forwarded',
  'host',
  'keep-alive',
  'origin',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'referer',
  'referrer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'x-client-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-forwarded-protocol',
  'x-forwarded-scheme',
  'x-real-ip',
  'x-remote-codex-relay-forwarded',
]);
const RELAY_RESPONSE_HEADER_BLOCKLIST = new Set([
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-allow-origin',
  'access-control-expose-headers',
  'access-control-max-age',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'keep-alive',
  'location',
  'proxy-authenticate',
  'refresh',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function buildRelayServer(
  config: RelayServerConfig,
  options: RelayServerBuildOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    },
  );
  const store = RelayStore.fromDataDir(
    config.dataDir,
    config.sessionSecret,
    config.registrationEnabled,
  );
  if (config.registrationEnabledConfigured) {
    store.setRegistrationEnabled(config.registrationEnabled);
  }
  store.ensureRegistrationPassword(config.registrationPassword);
  const googleAvailable = Boolean(config.googleOAuthClientId && config.googleOAuthClientSecret);
  const githubAvailable = Boolean(config.githubOAuthClientId && config.githubOAuthClientSecret);
  store.ensureAuthSettings({
    google: googleAvailable && config.googleOAuthEnabled !== false,
    github: githubAvailable && config.githubOAuthEnabled !== false,
  });
  store.seedAdmin({
    username: config.adminUsername,
    email: config.adminEmail,
    password: config.adminPassword,
  });

  const state: RelayState = {
    supervisors: new Map(),
  };
  const hostedSandboxProvider =
    options.hostedSandboxProvider ??
    createHostedSandboxProvider(config.hostedSandbox);
  const hostedSandboxCapability = new HostedSandboxCapabilityService(
    hostedSandboxProvider,
    { timeoutMs: config.hostedSandbox.requestTimeoutMs },
  );
  const hostedSandboxService = new HostedSandboxService(
    store,
    hostedSandboxProvider,
    config.hostedSandbox,
  );
  const hostedSandboxReconciler = new HostedSandboxReconciler(
    store,
    hostedSandboxProvider,
    config.hostedSandbox,
  );
  const allowedWebViewCorsOrigins = webViewCorsOrigins(
    options.env ?? process.env,
  );

  app.addHook('onReady', () => {
    queueMicrotask(() => hostedSandboxService.reconcilePending());
    queueMicrotask(() => hostedSandboxReconciler.start());
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!allowedWebViewCorsOrigins) {
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowedWebViewCorsOrigins.has(origin)) {
      return;
    }
    applyWebViewCorsHeaders(reply, origin);
    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  app.get('/healthz', async () => {
    const primary = [...state.supervisors.values()][0] ?? null;
    return {
      status: 'ok',
      supervisorConnected: state.supervisors.size > 0,
      supervisorConnectedAt: primary?.connectedAt ?? null,
      lastSupervisorHeartbeatAt: primary?.lastHeartbeatAt ?? null,
      supervisorCount: state.supervisors.size,
    } satisfies RelayHealthDto;
  });

  const authSettings = () => ({
    ...store.registrationSettings(),
    googleAuthAvailable: googleAvailable,
    githubAuthAvailable: githubAvailable,
    emailVerificationAvailable: config.emailVerificationConfigured,
  });

  app.get('/relay/auth/session', async (request) => {
    return { ...verifyRelayRequestSession(request, store), registrationSettings: authSettings() };
  });

  app.get('/relay/auth/oauth/:provider/start', async (request, reply) => {
    const { provider } = z.object({ provider: z.enum(['google', 'github']) }).parse(request.params);
    const settings = authSettings();
    if (provider === 'google' ? !settings.googleAuthEnabled || !googleAvailable : !settings.githubAuthEnabled || !githubAvailable) {
      reply.status(403).send({ code: 'forbidden', message: `${provider === 'google' ? 'Google' : 'GitHub'} authentication is disabled.` } satisfies ApiErrorShape);
      return;
    }
    const state = signOAuthState(provider, config.sessionSecret);
    const callback = oauthCallbackUrl(request, config, provider);
    const url = provider === 'google'
      ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
      : new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', provider === 'google' ? config.googleOAuthClientId! : config.githubOAuthClientId!);
    url.searchParams.set('redirect_uri', callback);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('scope', provider === 'google' ? 'openid email profile' : 'read:user user:email');
    if (provider === 'google') url.searchParams.set('prompt', 'select_account');
    reply.redirect(url.toString());
  });

  app.get('/relay/auth/oauth/:provider/callback', async (request, reply) => {
    const { provider } = z.object({ provider: z.enum(['google', 'github']) }).parse(request.params);
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query);
    if (!verifyOAuthState(query.state, provider, config.sessionSecret)) {
      reply.redirect('/relay-portal?oauthError=OAuth%20request%20expired%20or%20was%20invalid.');
      return;
    }
    try {
      const identity = provider === 'google'
        ? await fetchGoogleIdentity(query.code, oauthCallbackUrl(request, config, provider), config)
        : await fetchGitHubIdentity(query.code, oauthCallbackUrl(request, config, provider), config);
      const outcome = store.authenticateExternalIdentity(identity, store.registrationSettings().approvalRequired);
      if (outcome.kind === 'pending') {
        reply.redirect('/relay-portal?oauthPending=1');
        return;
      }
      store.recordUserSeen(outcome.result.session.user!.id);
      attachRelayCookie(reply, outcome.result.token);
      reply.redirect('/relay-portal');
    } catch (error) {
      request.log.error(error);
      const message = error instanceof RelayStoreError ? error.message : 'OAuth authentication failed.';
      reply.redirect(`/relay-portal?oauthError=${encodeURIComponent(message)}`);
    }
  });

  app.post('/relay/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body ?? {});
    const settings = store.registrationSettings();
    if (
      settings.registrationPassword &&
      body.registrationPassword !== settings.registrationPassword
    ) {
      reply.status(403).send({
        code: 'forbidden',
        message: 'Invalid registration password.',
      } satisfies ApiErrorShape);
      return;
    }
    const registerInput = {
      email: body.email,
      username: body.username,
      password: body.password,
    };
    if (settings.approvalRequired) {
      reply.status(202);
      return {
        pendingApproval: true,
        request: store.requestRegistrationApproval(registerInput),
      };
    }
    const result = store.register(registerInput);
    store.recordUserSeen(result.session.user!.id);
    attachRelayCookie(reply, result.token);
    return result;
  });

  app.post('/relay/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body ?? {});
    const result = store.login(body);
    store.recordUserSeen(result.session.user!.id);
    attachRelayCookie(reply, result.token);
    return result;
  });

  app.post('/relay/auth/logout', async (_request, reply) => {
    clearRelayCookie(reply);
    return store.emptySession();
  });

  app.patch('/relay/account', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const body = updateAccountSchema.parse(request.body ?? {});
    return store.updateAccount(user.id, {
      ...(body.username !== undefined ? { username: body.username } : {}),
    });
  });

  app.patch('/relay/account/password', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const body = updatePasswordSchema.parse(request.body ?? {});
    return store.updatePassword(user.id, body);
  });

  app.get('/relay/portal', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    return enrichPortalSummary(
      store.portalSummary(user.id, connectionStatus(state)),
      state,
      store,
    );
  });

  app.get('/relay/access', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const query = relayAccessQuerySchema.parse(request.query ?? {});
    const access = store.effectiveAccess(user.id, query.deviceId, {
      threadId: query.threadId ?? null,
      workspaceId: query.workspaceId ?? null,
    });
    if (!access) {
      reply.status(403).send({
        code: 'forbidden',
        message: 'Device access is not allowed.',
      } satisfies ApiErrorShape);
      return;
    }
    return relayAccessDto(access);
  });

  app.post('/relay/devices', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const body = createDeviceSchema.parse(request.body ?? {});
    return store.createDevice(user.id, body);
  });

  app.delete('/relay/devices/:deviceId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { deviceId } = z
      .object({ deviceId: z.string().uuid() })
      .parse(request.params);
    store.deleteDevice(user.id, deviceId);
    return { id: deviceId };
  });

  app.post('/relay/shares', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const body = createShareSchema.parse(request.body ?? {});
    return store.createShare(user.id, {
      targetIdentifier: body.targetIdentifier ?? body.targetUsername!,
      deviceId: body.deviceId,
      threadId: body.threadId,
      workspaceId: body.workspaceId ?? null,
      label: body.label ?? null,
      threadAccess: body.threadAccess,
      workspaceAccess: body.workspaceAccess,
      expiresAt: body.expiresAt ?? null,
    });
  });

  app.patch('/relay/shares/:shareId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { shareId } = z
      .object({ shareId: z.string().uuid() })
      .parse(request.params);
    const body = updateShareSchema.parse(request.body ?? {});
    return store.updateShare(user.id, shareId, body);
  });

  app.delete('/relay/shares/:shareId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { shareId } = z
      .object({ shareId: z.string().uuid() })
      .parse(request.params);
    return store.revokeShare(user.id, shareId);
  });

  app.post('/relay/grants', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const body = createGrantSchema.parse(request.body ?? {});
    return store.createGrant(user.id, {
      targetIdentifier: body.targetIdentifier ?? body.targetUsername!,
      deviceId: body.deviceId,
      scope: body.scope,
      threadId: body.threadId ?? null,
      workspaceId: body.workspaceId ?? null,
      workspaceScope: body.workspaceScope,
      workspaceIds: body.workspaceIds,
      label: body.label ?? null,
      threadAccess: body.threadAccess,
      workspaceAccess: body.workspaceAccess,
      canCreateThreads: body.canCreateThreads ?? false,
      expiresAt: body.expiresAt ?? null,
    });
  });

  app.patch('/relay/grants/:grantId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { grantId } = z
      .object({ grantId: z.string().uuid() })
      .parse(request.params);
    const body = updateGrantSchema.parse(request.body ?? {});
    return store.updateGrant(user.id, grantId, body);
  });

  app.delete('/relay/grants/:grantId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { grantId } = z
      .object({ grantId: z.string().uuid() })
      .parse(request.params);
    return store.revokeGrant(user.id, grantId);
  });

  app.get('/relay/admin', async (request, reply) => {
    const user = requireRelayUser(request, reply, store, { admin: true });
    if (!user) {
      return;
    }
    const query = adminQuerySchema.parse(request.query ?? {});
    const baseSummary = store.adminSummary(connectionStatus(state), {
      ...(query.days !== undefined
        ? { conversationWindowDays: query.days }
        : {}),
    });
    const summary = await enrichAdminSummary(baseSummary, state, store, query.days);
    return { ...summary, settings: authSettings() };
  });

  app.get(
    '/relay/admin/hosted-sandboxes/capability',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) {
        return;
      }
      return hostedSandboxCapability.read() satisfies Promise<RelayHostedSandboxCapabilityDto>;
    },
  );

  app.get('/relay/admin/hosted-sandboxes', async (request, reply) => {
    const user = requireRelayUser(request, reply, store, { admin: true });
    if (!user) {
      return;
    }
    return { sandboxes: hostedSandboxService.list() };
  });

  app.get(
    '/relay/admin/hosted-sandboxes/reconciliation',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      return hostedSandboxReconciler.read();
    },
  );

  app.post(
    '/relay/admin/hosted-sandboxes/reconciliation/run',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      return hostedSandboxReconciler.run();
    },
  );

  app.delete(
    '/relay/admin/hosted-sandboxes/reconciliation/orphan-instances/:sandboxId',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      return hostedSandboxReconciler.deleteOrphanInstance(sandboxId);
    },
  );

  app.delete(
    '/relay/admin/hosted-sandboxes/reconciliation/orphan-credentials/:credentialRef',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      const { credentialRef } = z
        .object({
          credentialRef: z.string().regex(/^rcc_[A-Za-z0-9_-]{32}$/),
        })
        .parse(request.params);
      return hostedSandboxReconciler.deleteOrphanCredential(credentialRef);
    },
  );

  app.get(
    '/relay/admin/hosted-sandboxes/:sandboxId',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) {
        return;
      }
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      return hostedSandboxService.detail(sandboxId);
    },
  );

  app.post('/relay/admin/hosted-sandboxes', async (request, reply) => {
    const user = requireRelayUser(request, reply, store, { admin: true });
    if (!user) {
      return;
    }
    const body = createHostedSandboxSchema.parse(request.body ?? {});
    const result = await hostedSandboxService.create({
      createdByAdminUserId: user.id,
      ...body,
    });
    return reply.code(202).send(result);
  });

  app.put(
    '/relay/admin/hosted-sandboxes/:sandboxId/members',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) {
        return;
      }
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      const body = updateHostedSandboxMembersSchema.parse(request.body ?? {});
      return hostedSandboxService.updateMembers(
        sandboxId,
        body.assignedUserIds,
      );
    },
  );

  app.patch(
    '/relay/admin/hosted-sandboxes/:sandboxId/settings',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      const body = updateHostedSandboxSettingsSchema.parse(request.body ?? {});
      return store.setHostedWorkspaceIsolation(
        sandboxId,
        body.workspaceIsolationEnabled,
      );
    },
  );

  app.post(
    '/relay/admin/hosted-sandboxes/:sandboxId/retry',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) {
        return;
      }
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      return reply.code(202).send({
        sandbox: hostedSandboxService.detail(sandboxId),
        operation: hostedSandboxService.retry(sandboxId),
      });
    },
  );

  app.post(
    '/relay/admin/hosted-sandboxes/:sandboxId/start',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      return reply.code(202).send({
        operation: hostedSandboxService.start(sandboxId),
      });
    },
  );

  app.post(
    '/relay/admin/hosted-sandboxes/:sandboxId/stop',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      return reply.code(202).send({
        operation: hostedSandboxService.stop(sandboxId),
      });
    },
  );

  app.post(
    '/relay/admin/hosted-sandboxes/:sandboxId/snapshots',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      const { name } = hostedSnapshotSchema.parse(request.body ?? {});
      return reply.code(202).send({
        operation: hostedSandboxService.snapshot(sandboxId, name),
      });
    },
  );

  app.delete(
    '/relay/admin/hosted-sandboxes/:sandboxId',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      return reply.code(202).send({
        operation: hostedSandboxService.delete(sandboxId),
      });
    },
  );

  app.post(
    '/relay/admin/hosted-sandboxes/:sandboxId/rotate-credential',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      const { openaiApiKey } = rotateHostedCredentialSchema.parse(
        request.body ?? {},
      );
      return reply.code(202).send({
        operation: await hostedSandboxService.rotateCredential(
          sandboxId,
          openaiApiKey,
        ),
      });
    },
  );

  app.get(
    '/relay/admin/hosted-sandboxes/:sandboxId/backends/codex/files',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      return hostedSandboxService.readCodexFiles(sandboxId);
    },
  );

  app.put(
    '/relay/admin/hosted-sandboxes/:sandboxId/backends/codex/files',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) return;
      const { sandboxId } = z
        .object({ sandboxId: z.string().uuid() })
        .parse(request.params);
      const body = hostedCodexFilesSchema.parse(request.body ?? {});
      return hostedSandboxService.writeCodexFiles(sandboxId, body);
    },
  );

  app.patch('/relay/admin/settings/registration', async (request, reply) => {
    const user = requireRelayUser(request, reply, store, { admin: true });
    if (!user) {
      return;
    }
    const body = updateRegistrationSettingsSchema.parse(request.body ?? {});
    if (body.googleAuthEnabled && !googleAvailable) throw new RelayStoreError(400, 'bad_request', 'Google OAuth credentials are not configured.');
    if (body.githubAuthEnabled && !githubAvailable) throw new RelayStoreError(400, 'bad_request', 'GitHub OAuth credentials are not configured.');
    if (body.emailVerificationEnabled && !config.emailVerificationConfigured) throw new RelayStoreError(400, 'bad_request', 'Email verification is not configured.');
    const settings = store.updateRegistrationSettings({
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.registrationPassword !== undefined
        ? { registrationPassword: body.registrationPassword }
        : {}),
      ...(body.approvalRequired !== undefined
        ? { approvalRequired: body.approvalRequired }
        : {}),
      ...(body.googleAuthEnabled !== undefined ? { googleAuthEnabled: body.googleAuthEnabled } : {}),
      ...(body.githubAuthEnabled !== undefined ? { githubAuthEnabled: body.githubAuthEnabled } : {}),
      ...(body.emailVerificationEnabled !== undefined ? { emailVerificationEnabled: body.emailVerificationEnabled } : {}),
    });
    return {
      registrationEnabled: settings.enabled,
      settings: { ...settings, googleAuthAvailable: googleAvailable, githubAuthAvailable: githubAvailable, emailVerificationAvailable: config.emailVerificationConfigured },
    };
  });

  app.patch('/relay/admin/users/:userId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store, { admin: true });
    if (!user) {
      return;
    }
    const { userId } = z
      .object({ userId: z.string().uuid() })
      .parse(request.params);
    const body = setEnabledSchema.parse(request.body ?? {});
    return store.setUserEnabled(userId, body.enabled);
  });

  app.delete('/relay/admin/users/:userId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store, { admin: true });
    if (!user) {
      return;
    }
    const { userId } = z
      .object({ userId: z.string().uuid() })
      .parse(request.params);
    store.deleteUser(userId);
    return { id: userId };
  });

  app.post(
    '/relay/admin/users/:userId/reset-password',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) {
        return;
      }
      const { userId } = z
        .object({ userId: z.string().uuid() })
        .parse(request.params);
      const body = adminResetPasswordSchema.parse(request.body ?? {});
      return store.adminResetUserPassword(userId, body.password);
    },
  );

  app.post(
    '/relay/admin/registrations/:requestId/approve',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) {
        return;
      }
      const { requestId } = z
        .object({ requestId: z.string().uuid() })
        .parse(request.params);
      return store.approvePendingRegistration(user.id, requestId);
    },
  );

  app.post(
    '/relay/admin/registrations/:requestId/reject',
    async (request, reply) => {
      const user = requireRelayUser(request, reply, store, { admin: true });
      if (!user) {
        return;
      }
      const { requestId } = z
        .object({ requestId: z.string().uuid() })
        .parse(request.params);
      return store.rejectPendingRegistration(user.id, requestId);
    },
  );

  app.all('/relay/devices/:deviceId/api/*', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { deviceId } = z
      .object({ deviceId: z.string().uuid() })
      .parse(request.params);
    const targetPath =
      request.url.replace(/^\/relay\/devices\/[^/]+/, '') || '/';
    await forwardRelayHttp({
      request,
      reply,
      state,
      store,
      hostedSandboxService,
      user,
      deviceId,
      targetPath,
    });
  });

  app.get('/relay/devices/:deviceId/healthz', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { deviceId } = z
      .object({ deviceId: z.string().uuid() })
      .parse(request.params);
    await forwardRelayHttp({
      request,
      reply,
      state,
      store,
      hostedSandboxService,
      user,
      deviceId,
      targetPath: '/healthz',
    });
  });

  app.all('/relay/api/*', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const deviceId = firstAccessibleConnectedDevice(state, store, user.id);
    if (!deviceId) {
      reply.status(503).send({
        code: 'service_unavailable',
        message: 'No accessible supervisor is connected to this relay.',
      } satisfies ApiErrorShape);
      return;
    }
    const targetPath = request.url.slice('/relay'.length) || '/';
    await forwardRelayHttp({
      request,
      reply,
      state,
      store,
      hostedSandboxService,
      user,
      deviceId,
      targetPath,
    });
  });

  app.register(async (realtimeApp) => {
    await realtimeApp.register(websocket);

    realtimeApp.route({
      method: 'GET',
      url: '/supervisor/tunnel',
      handler: (_request, reply) => {
        reply.status(426).send({
          code: 'bad_request',
          message: 'Upgrade to websocket is required.',
        } satisfies ApiErrorShape);
      },
      wsHandler: (socket, request) => {
        const legacyToken =
          bearerToken(request.headers.authorization) ??
          queryToken(request.query);
        const deviceToken =
          queryToken(request.query, 'deviceToken') ?? legacyToken;
        const device = store.verifyDeviceToken(deviceToken);
        const deviceId =
          device?.id ??
          (config.supervisorToken && legacyToken === config.supervisorToken
            ? 'legacy-default'
            : null);
        if (!deviceId) {
          socket.close(1008, 'Supervisor relay token is invalid.');
          return;
        }

        const connectedAt = new Date().toISOString();
        const existing = state.supervisors.get(deviceId);
        existing?.socket.send(
          JSON.stringify({
            type: 'relay.connected',
            timestamp: connectedAt,
            deviceId,
          } satisfies RelaySupervisorEnvelope),
        );
        existing?.clientSockets.forEach((clientConnection) =>
          clientConnection.socket.close(),
        );

        const connection: SupervisorConnection = {
          deviceId,
          socket,
          requestBroker: new RelayRequestBroker(RELAY_REQUEST_TIMEOUT_MS),
          clientSockets: new Map(),
          connected: true,
          connectedAt,
          lastHeartbeatAt: connectedAt,
          ipAddress: relayClientIp(request),
        };
        state.supervisors.set(deviceId, connection);
        hostedSandboxService.markOnline(deviceId);

        socket.send(
          JSON.stringify({
            type: 'relay.connected',
            timestamp: connectedAt,
            deviceId,
          } satisfies RelaySupervisorEnvelope),
        );

        socket.on('message', (rawMessage: Buffer) => {
          let parsed: RelaySupervisorEnvelope;
          try {
            parsed = JSON.parse(
              rawMessage.toString(),
            ) as RelaySupervisorEnvelope;
          } catch {
            return;
          }

          if (parsed.type === 'relay.heartbeat') {
            connection.lastHeartbeatAt = parsed.timestamp;
            return;
          }

          if (parsed.type === 'relay.activity') {
            hostedSandboxService.recordTurnActivity({
              deviceId,
              threadId: parsed.payload.threadId,
              turnId: parsed.payload.turnId,
              kind: parsed.payload.kind,
            });
            return;
          }

          if (parsed.type === 'relay.server.message') {
            const clientConnection = connection.clientSockets.get(
              parsed.clientId,
            );
            const eventThreadId = threadIdFromSocketPayload(parsed.payload);
            if (clientConnection) {
              const freshAccess = store.effectiveAccess(
                clientConnection.user.id,
                clientConnection.deviceId,
                {
                  threadId: clientConnection.threadId ?? eventThreadId,
                },
              );
              if (!freshAccess) {
                connection.clientSockets.delete(parsed.clientId);
                clientConnection.socket.close(
                  1008,
                  'Shared access is no longer allowed.',
                );
                return;
              }
              clientConnection.access = freshAccess;
              const isolation = store.hostedWorkspaceIsolationForUser(
                clientConnection.deviceId,
                clientConnection.user.id,
              );
              if (
                isolation?.enabled &&
                (!eventThreadId ||
                  !store.ownsHostedThread(
                    isolation.sandboxId,
                    clientConnection.user.id,
                    eventThreadId,
                  ))
              ) {
                return;
              }
            }
            if (
              clientConnection &&
              clientConnection.socket.readyState === WEBSOCKET_OPEN &&
              shouldForwardSocketEvent(
                parsed.payload,
                clientConnection.threadId,
              )
            ) {
              clientConnection.socket.send(JSON.stringify(parsed.payload));
            }
            return;
          }

          connection.requestBroker.accept(parsed);
        });

        socket.on('close', () => {
          if (state.supervisors.get(deviceId)?.socket === socket) {
            state.supervisors.delete(deviceId);
          }
          connection.requestBroker.rejectAll(
            new Error('Supervisor tunnel closed.'),
          );
          for (const [clientId, clientConnection] of connection.clientSockets) {
            connection.clientSockets.delete(clientId);
            clientConnection.socket.close();
          }
        });
      },
    });

    realtimeApp.route({
      method: 'GET',
      url: '/relay/devices/:deviceId/ws',
      handler: (_request, reply) => {
        reply.status(426).send({
          code: 'bad_request',
          message: 'Upgrade to websocket is required.',
        } satisfies ApiErrorShape);
      },
      wsHandler: (socket, request) => {
        const session = verifyRelayRequestSession(request, store);
        const deviceId = pathParam(request.params, 'deviceId');
        const threadId = queryString(request.query, 'threadId');
        if (!session.authenticated || !session.user || !deviceId) {
          socket.close(1008, 'Relay login is required.');
          return;
        }
        const access = store.effectiveAccess(session.user.id, deviceId, {
          threadId,
        });
        if (!access) {
          socket.close(1008, 'Device access is not allowed.');
          return;
        }
        const isolation = store.hostedWorkspaceIsolationForUser(
          deviceId,
          session.user.id,
        );
        if (
          isolation?.enabled &&
          threadId &&
          !store.ownsHostedThread(isolation.sandboxId, session.user.id, threadId)
        ) {
          socket.close(1008, 'This thread belongs to another VM user.');
          return;
        }

        const lifecycle = hostedSandboxService.wakeIfStopped(deviceId);
        if (lifecycle.waking) {
          socket.close(1013, 'Hosted supervisor VM is starting.');
          return;
        }

        const supervisor = state.supervisors.get(deviceId);
        if (!supervisor || supervisor.socket.readyState !== WEBSOCKET_OPEN) {
          socket.close(1013, 'No supervisor is connected for this device.');
          return;
        }

        if (access.kind === 'shared') {
          recordRelayAccess(
            store,
            access,
            session.user,
            threadId ? 'open_thread' : 'open_device',
          );
        }
        connectRelayWebsocket(
          supervisor,
          socket,
          store,
          session.user,
          deviceId,
          threadId,
          access,
        );
      },
    });

    realtimeApp.route({
      method: 'GET',
      url: '/relay/ws',
      handler: (_request, reply) => {
        reply.status(426).send({
          code: 'bad_request',
          message: 'Upgrade to websocket is required.',
        } satisfies ApiErrorShape);
      },
      wsHandler: (socket, request) => {
        const session = verifyRelayRequestSession(request, store);
        if (!session.authenticated || !session.user) {
          socket.close(1008, 'Relay login is required.');
          return;
        }
        const threadId = queryString(request.query, 'threadId');
        const deviceId = firstAccessibleConnectedDevice(
          state,
          store,
          session.user.id,
          threadId,
        );
        const supervisor = deviceId ? state.supervisors.get(deviceId) : null;
        const access = deviceId
          ? store.effectiveAccess(session.user.id, deviceId, { threadId })
          : null;
        if (
          !deviceId ||
          !supervisor ||
          supervisor.socket.readyState !== WEBSOCKET_OPEN
        ) {
          socket.close(
            1013,
            'No accessible supervisor is connected to this relay.',
          );
          return;
        }
        if (!access) {
          socket.close(1008, 'Device access is not allowed.');
          return;
        }
        if (access.kind === 'shared') {
          recordRelayAccess(
            store,
            access,
            session.user,
            threadId ? 'open_thread' : 'open_device',
          );
        }
        connectRelayWebsocket(
          supervisor,
          socket,
          store,
          session.user,
          deviceId,
          threadId,
          access,
        );
      },
    });
  });

  if (config.webDistDir) {
    registerRelayWebApp(app, config.webDistDir);
  }

  app.addHook('onClose', () => {
    hostedSandboxService.close();
    hostedSandboxReconciler.close();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RelayStoreError) {
      reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
      } satisfies ApiErrorShape);
      return;
    }
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0];
      const field = firstIssue?.path[0];
      const message =
        field === 'password'
          ? 'Password must be at least 8 characters.'
          : field === 'username'
            ? 'Username must be at least 3 characters.'
            : field === 'email'
              ? 'Enter a valid email address.'
              : 'The request payload is invalid.';
      reply.status(400).send({
        code: 'bad_request',
        message,
        details: {
          issues: error.issues,
        },
      } satisfies ApiErrorShape);
      return;
    }
    reply.status(500).send({
      code: 'internal_error',
      message: 'An unexpected relay server error occurred.',
    } satisfies ApiErrorShape);
  });

  return app;
}

function webViewCorsOrigins(env: NodeJS.ProcessEnv) {
  if (env.REMOTE_CODEX_ENABLE_WEBVIEW_CORS !== 'true') {
    return null;
  }
  const configured = env.REMOTE_CODEX_WEBVIEW_CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(
    configured?.length ? configured : DEFAULT_WEBVIEW_CORS_ORIGINS,
  );
}

function applyWebViewCorsHeaders(reply: FastifyReply, origin: string) {
  reply.header('access-control-allow-origin', origin);
  reply.header('access-control-allow-methods', WEBVIEW_CORS_ALLOW_METHODS);
  reply.header('access-control-allow-headers', WEBVIEW_CORS_ALLOW_HEADERS);
  reply.header('access-control-max-age', '600');
  reply.header('vary', 'Origin');
}

async function forwardRelayHttp(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  state: RelayState;
  store: RelayStore;
  hostedSandboxService: HostedSandboxService;
  user: RelayUserDto;
  deviceId: string;
  targetPath: string;
}) {
  const threadId = threadIdFromPath(input.targetPath);
  const workspaceId = workspaceIdFromPath(input.targetPath);
  const targetUrl = new URL(input.targetPath, 'http://relay.local');
  const sharedThreadListRequest =
    input.request.method.toUpperCase() === 'GET' &&
    targetUrl.pathname === '/api/threads';
  const sharedRuntimeMetadataRequest = isAllowedSharedRuntimeMetadataRequest(
    input.request.method,
    targetUrl.pathname,
  );
  const access = input.store.effectiveAccess(input.user.id, input.deviceId, {
    threadId,
    workspaceId,
  });
  let allowSharedRuntimeMetadata = false;
  if (!access) {
    const shares =
      sharedThreadListRequest || sharedRuntimeMetadataRequest
        ? input.store.sharedThreadsForDevice(input.user.id, input.deviceId)
        : [];
    if (sharedThreadListRequest) {
      if (shares.length > 0) {
        await forwardSharedThreadList({
          reply: input.reply,
          state: input.state,
          store: input.store,
          user: input.user,
          deviceId: input.deviceId,
          shares,
        });
        return;
      }
    }
    allowSharedRuntimeMetadata =
      sharedRuntimeMetadataRequest && shares.length > 0;
    if (!allowSharedRuntimeMetadata) {
      input.reply.status(403).send({
        code: 'forbidden',
        message: 'Device access is not allowed.',
      } satisfies ApiErrorShape);
      return;
    }
  }

  if (!isAllowedRelayTarget(input.targetPath)) {
    input.reply.status(403).send({
      code: 'forbidden',
      message: 'This relay path is not allowed.',
    } satisfies ApiErrorShape);
    return;
  }

  if (
    access &&
    !isAllowedForRelayAccess(access, input.request.method, input.targetPath)
  ) {
    input.reply.status(403).send({
      code: 'forbidden',
      message: 'This shared session does not allow that operation.',
    } satisfies ApiErrorShape);
    return;
  }

  if (access?.kind === 'shared') {
    const accessEventKind = relayAccessEventKindFromRequest(
      input.request.method,
      input.targetPath,
    );
    if (accessEventKind) {
      recordRelayAccess(input.store, access, input.user, accessEventKind);
    }
  }
  const conversationEvent = conversationEventFromRequest(
    input.request.method,
    input.targetPath,
    input.request.body,
  );
  if (conversationEvent) {
    input.store.recordConversationEvent({
      userId: input.user.id,
      deviceId: input.deviceId,
      threadId: conversationEvent.threadId,
      workspaceId: conversationEvent.workspaceId,
    });
  }
  const lifecycle = isHostedUserActivityRequest(
    input.request.method,
    input.targetPath,
  )
    ? input.hostedSandboxService.recordUserActivity(input.deviceId)
    : input.hostedSandboxService.wakeIfStopped(input.deviceId);
  if (lifecycle.waking) {
    input.reply.status(503).send({
      code: 'service_unavailable',
      message: 'Hosted supervisor VM is starting. Retry shortly.',
      details: { reason: 'hosted_sandbox_starting' },
    } satisfies ApiErrorShape);
    return;
  }

  const supervisor = input.state.supervisors.get(input.deviceId);
  if (!supervisor || supervisor.socket.readyState !== WEBSOCKET_OPEN) {
    input.reply.status(503).send({
      code: 'service_unavailable',
      message: 'No supervisor is connected for this device.',
    } satisfies ApiErrorShape);
    return;
  }

  try {
    const isolation = input.store.hostedWorkspaceIsolationForUser(
      input.deviceId,
      input.user.id,
    );
    if (isolation?.enabled) {
      if (
        input.request.method.toUpperCase() === 'GET' &&
        (targetUrl.pathname === '/api/workspaces' ||
          targetUrl.pathname === '/api/threads')
      ) {
        await ensureHostedUserBootstrap({
          store: input.store,
          supervisor,
          deviceId: input.deviceId,
          sandboxId: isolation.sandboxId,
          user: input.user,
        });
      }
      if (
        workspaceId &&
        !input.store.ownsHostedWorkspace(
          isolation.sandboxId,
          input.user.id,
          workspaceId,
        )
      ) {
        input.reply.status(403).send({
          code: 'forbidden',
          message: 'This workspace belongs to another VM user.',
        } satisfies ApiErrorShape);
        return;
      }
      if (
        threadId &&
        !input.store.ownsHostedThread(
          isolation.sandboxId,
          input.user.id,
          threadId,
        )
      ) {
        input.reply.status(403).send({
          code: 'forbidden',
          message: 'This thread belongs to another VM user.',
        } satisfies ApiErrorShape);
        return;
      }
      if (
        input.request.method.toUpperCase() === 'POST' &&
        targetUrl.pathname === '/api/threads/start'
      ) {
        const requestedWorkspaceId =
          isObject(input.request.body) &&
          typeof input.request.body.workspaceId === 'string'
            ? input.request.body.workspaceId
            : null;
        if (
          !requestedWorkspaceId ||
          !input.store.ownsHostedWorkspace(
            isolation.sandboxId,
            input.user.id,
            requestedWorkspaceId,
          )
        ) {
          input.reply.status(403).send({
            code: 'forbidden',
            message: 'Create threads only in your own workspace.',
          } satisfies ApiErrorShape);
          return;
        }
      }
      if (
        input.request.method.toUpperCase() === 'POST' &&
        targetUrl.pathname === '/api/threads/import'
      ) {
        input.reply.status(403).send({
          code: 'forbidden',
          message: 'Thread import is unavailable while user workspace isolation is enabled.',
        } satisfies ApiErrorShape);
        return;
      }
    }
    const requestId = randomUUID();
    const requestBody = relayRequestBody(input.request.body);
    const response = await supervisor.requestBroker.forward(supervisor.socket, {
      type: 'relay.request',
      timestamp: new Date().toISOString(),
      requestId,
      deviceId: input.deviceId,
      payload: {
        method: input.request.method,
        path: input.targetPath,
        headers: relayRequestHeaders(input.request.headers),
        body: requestBody.body,
        ...(requestBody.bodyEncoding
          ? { bodyEncoding: requestBody.bodyEncoding }
          : {}),
      },
    });

    for (const [name, value] of Object.entries(response.headers)) {
      if (canForwardResponseHeader(name)) {
        input.reply.header(name, value);
      }
    }
    if (isolation?.enabled && response.statusCode >= 200 && response.statusCode < 300) {
      const transformed = transformHostedIsolatedResponse({
        store: input.store,
        sandboxId: isolation.sandboxId,
        userId: input.user.id,
        method: input.request.method,
        pathname: targetUrl.pathname,
        response,
      });
      input.reply.status(response.statusCode).send(transformed);
      return;
    }
    input.reply.status(response.statusCode).send(relayResponseBody(response));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Relay request failed.';
    input.reply.status(message.includes('timed out') ? 504 : 503).send({
      code: 'service_unavailable',
      message,
    } satisfies ApiErrorShape);
  }
}

async function forwardSharedThreadList(input: {
  reply: FastifyReply;
  state: RelayState;
  store: RelayStore;
  user: RelayUserDto;
  deviceId: string;
  shares: RelaySessionShareDto[];
}) {
  const supervisor = input.state.supervisors.get(input.deviceId);
  if (!supervisor || supervisor.socket.readyState !== WEBSOCKET_OPEN) {
    input.reply.status(503).send({
      code: 'service_unavailable',
      message: 'No supervisor is connected for this device.',
    } satisfies ApiErrorShape);
    return;
  }

  const threads = await Promise.all(
    input.shares.map(async (share) => {
      input.store.recordShareAccess(share, input.user);
      const payload = await forwardSupervisorJson(
        supervisor,
        input.deviceId,
        `/api/threads/${encodeURIComponent(share.threadId)}?limit=1`,
        { timeoutMs: RELAY_REQUEST_TIMEOUT_MS },
      );
      const thread =
        isObject(payload) && isObject(payload.thread)
          ? payload.thread
          : payload;
      return isObject(thread) ? thread : null;
    }),
  );

  input.reply.send(
    threads.filter((thread): thread is Record<string, unknown> =>
      Boolean(thread),
    ),
  );
}

async function ensureHostedUserBootstrap(input: {
  store: RelayStore;
  supervisor: SupervisorConnection;
  deviceId: string;
  sandboxId: string;
  user: RelayUserDto;
}) {
  if (input.store.hostedUserWorkspaceIds(input.sandboxId, input.user.id).length) {
    return;
  }
  const key = `${input.sandboxId}:${input.user.id}`;
  const existing = hostedBootstrapPromises.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const slug = input.user.username
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'user';
    const directory = `${slug}-${input.user.id.slice(0, 8)}`;
    const absoluteDirectory = `/home/remote-codex/workspaces/${directory}`;
    const label = `${input.user.username}'s workspace`;
    const current = await forwardSupervisorCommandJson(
      input.supervisor,
      input.deviceId,
      'GET',
      '/api/workspaces',
    );
    const currentWorkspaces = Array.isArray(current) ? current : [];
    let workspace = currentWorkspaces.find(
      (candidate) =>
        isObject(candidate) &&
        typeof candidate.absPath === 'string' &&
        candidate.absPath === absoluteDirectory,
    );
    if (!workspace) {
      workspace = await forwardSupervisorCommandJson(
        input.supervisor,
        input.deviceId,
        'POST',
        '/api/workspaces',
        { absPath: absoluteDirectory, label },
      );
    }
    const workspaceId = stringField(workspace, 'id');
    if (!workspaceId) throw new Error('Initial workspace creation returned no id.');
    const thread = await forwardSupervisorCommandJson(
      input.supervisor,
      input.deviceId,
      'POST',
      '/api/threads/start',
      {
        workspaceId,
        title: 'Getting started',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'low',
        approvalMode: 'yolo',
      },
    );
    const threadId = stringField(thread, 'id');
    if (!threadId) throw new Error('Initial thread creation returned no id.');
    input.store.recordHostedUserWorkspace(
      input.sandboxId,
      input.user.id,
      workspaceId,
      true,
    );
    input.store.recordHostedUserThread(
      input.sandboxId,
      input.user.id,
      threadId,
      workspaceId,
    );
  })().finally(() => hostedBootstrapPromises.delete(key));
  hostedBootstrapPromises.set(key, pending);
  return pending;
}

async function forwardSupervisorCommandJson(
  supervisor: SupervisorConnection,
  deviceId: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await supervisor.requestBroker.forward(supervisor.socket, {
    type: 'relay.request',
    timestamp: new Date().toISOString(),
    requestId: randomUUID(),
    deviceId,
    payload: {
      method,
      path,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    let detail = relayJsonBody(response);
    try {
      const payload = JSON.parse(detail) as unknown;
      detail = isObject(payload) && typeof payload.message === 'string'
        ? payload.message
        : detail;
    } catch {
      // Keep the bounded raw response when the supervisor did not return JSON.
    }
    throw new Error(
      `Supervisor bootstrap request failed with ${response.statusCode}: ${detail.slice(0, 300)}`,
    );
  }
  return JSON.parse(relayJsonBody(response)) as unknown;
}

function transformHostedIsolatedResponse(input: {
  store: RelayStore;
  sandboxId: string;
  userId: string;
  method: string;
  pathname: string;
  response: RelayHttpResponsePayload;
}) {
  const raw = relayJsonBody(input.response);
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return relayResponseBody(input.response);
  }
  const method = input.method.toUpperCase();
  if (method === 'GET' && input.pathname === '/api/workspaces' && Array.isArray(payload)) {
    const owned = new Set(
      input.store.hostedUserWorkspaceIds(input.sandboxId, input.userId),
    );
    return payload.filter(
      (workspace) => isObject(workspace) && owned.has(stringField(workspace, 'id') ?? ''),
    );
  }
  if (method === 'POST' && input.pathname === '/api/workspaces' && isObject(payload)) {
    const workspaceId = stringField(payload, 'id');
    if (workspaceId) {
      input.store.recordHostedUserWorkspace(
        input.sandboxId,
        input.userId,
        workspaceId,
      );
    }
    return payload;
  }
  if (method === 'GET' && input.pathname === '/api/threads' && Array.isArray(payload)) {
    const ownedWorkspaces = new Set(
      input.store.hostedUserWorkspaceIds(input.sandboxId, input.userId),
    );
    return payload.filter((thread) => {
      if (!isObject(thread)) return false;
      const threadId = stringField(thread, 'id');
      const workspaceId = stringField(thread, 'workspaceId');
      if (!threadId || !workspaceId || !ownedWorkspaces.has(workspaceId)) return false;
      input.store.recordHostedUserThread(
        input.sandboxId,
        input.userId,
        threadId,
        workspaceId,
      );
      return true;
    });
  }
  if (method === 'POST' && input.pathname === '/api/threads/start' && isObject(payload)) {
    const threadId = stringField(payload, 'id');
    const workspaceId = stringField(payload, 'workspaceId');
    if (threadId && workspaceId) {
      input.store.recordHostedUserThread(
        input.sandboxId,
        input.userId,
        threadId,
        workspaceId,
      );
    }
  }
  return payload;
}

function relayResponseBody(response: {
  body: string;
  bodyEncoding?: 'utf8' | 'base64';
}) {
  if (response.bodyEncoding === 'base64') {
    return Buffer.from(response.body, 'base64');
  }
  return response.body;
}

function connectRelayWebsocket(
  supervisor: SupervisorConnection,
  socket: {
    send: (message: string) => void;
    readyState: number;
    close: (code?: number, reason?: string) => void;
    on: any;
  },
  store: RelayStore,
  user: RelayUserDto,
  deviceId: string,
  threadId: string | null,
  access: EffectiveRelayAccess,
) {
  const clientId = randomUUID();
  supervisor.clientSockets.set(clientId, {
    socket,
    threadId,
    deviceId,
    user,
    access,
  });
  sendToSupervisor(supervisor, {
    type: 'relay.client.connected',
    timestamp: new Date().toISOString(),
    clientId,
  });

  socket.on('message', (rawMessage: Buffer) => {
    let payload: unknown;
    try {
      payload = JSON.parse(rawMessage.toString());
    } catch {
      return;
    }

    const freshAccess = store.effectiveAccess(user.id, deviceId, {
      threadId: threadId ?? threadIdFromSocketPayload(payload),
    });
    if (!freshAccess) {
      supervisor.clientSockets.delete(clientId);
      socket.close(1008, 'Shared access is no longer allowed.');
      return;
    }
    const clientConnection = supervisor.clientSockets.get(clientId);
    if (clientConnection) {
      clientConnection.access = freshAccess;
    }

    if (
      freshAccess.kind === 'shared' &&
      freshAccess.threadAccess !== 'control'
    ) {
      socket.close(1008, 'Shared read-only session cannot control supervisor.');
      return;
    }

    sendToSupervisor(supervisor, {
      type: 'relay.client.message',
      timestamp: new Date().toISOString(),
      clientId,
      payload: payload as any,
    });
  });

  socket.on('close', () => {
    supervisor.clientSockets.delete(clientId);
    sendToSupervisor(supervisor, {
      type: 'relay.client.disconnected',
      timestamp: new Date().toISOString(),
      clientId,
    });
  });
}

function threadIdFromSocketPayload(payload: unknown) {
  return isObject(payload) && typeof payload.threadId === 'string'
    ? payload.threadId
    : null;
}

function sendToSupervisor(
  supervisor: SupervisorConnection,
  message: RelaySupervisorEnvelope,
) {
  if (supervisor.socket.readyState === WEBSOCKET_OPEN) {
    supervisor.socket.send(JSON.stringify(message));
  }
}

function registerRelayWebApp(app: FastifyInstance, distDirInput: string) {
  const distDir = path.resolve(distDirInput);
  const indexFile = path.join(distDir, 'index.html');
  const mimeTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.webp', 'image/webp'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
  ]);

  app.get('/*', async (request, reply) => {
    if (!fs.existsSync(indexFile)) {
      reply
        .status(503)
        .type('text/plain; charset=utf-8')
        .send('Relay web frontend is not built.');
      return;
    }
    const pathname = new URL(request.url, 'http://relay.local').pathname;
    if (
      pathname.startsWith('/relay/') ||
      pathname === '/healthz' ||
      pathname === '/supervisor/tunnel'
    ) {
      reply.status(404).send({
        code: 'not_found',
        message: 'The requested relay endpoint was not found.',
      } satisfies ApiErrorShape);
      return;
    }
    const assetPath = await resolveAssetPath(distDir, indexFile, pathname);
    if (!assetPath) {
      reply.status(404).type('text/plain; charset=utf-8').send('Not Found');
      return;
    }
    if (assetPath === indexFile) {
      const html = await fsp.readFile(indexFile, 'utf8');
      const payload = injectRelayBootstrap(html);
      reply
        .header('cache-control', 'no-cache')
        .header('content-length', Buffer.byteLength(payload))
        .type('text/html; charset=utf-8');
      return reply.send(payload);
    }
    const stat = await fsp.stat(assetPath);
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-length', stat.size)
      .type(
        mimeTypes.get(path.extname(assetPath).toLowerCase()) ??
          'application/octet-stream',
      );
    return reply.send(fs.createReadStream(assetPath));
  });
}

function injectRelayBootstrap(html: string) {
  const script = `<script>window.__REMOTE_CODEX_BOOTSTRAP__=${JSON.stringify({
    mode: 'relay',
    relayApiBase: '/relay',
  })};</script>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${script}</head>`);
  }
  return `${script}${html}`;
}

async function resolveAssetPath(
  distDir: string,
  indexFile: string,
  pathname: string,
) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath =
    decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(distDir, relativePath);
  if (candidate !== distDir && !candidate.startsWith(`${distDir}${path.sep}`)) {
    return null;
  }
  const stat = await safeStat(candidate);
  if (stat?.isFile()) {
    return candidate;
  }
  if (path.posix.extname(decodedPath)) {
    return null;
  }
  return indexFile;
}

function requireRelayUser(
  request: FastifyRequest,
  reply: FastifyReply,
  store: RelayStore,
  options: { admin?: boolean } = {},
) {
  const session = verifyRelayRequestSession(request, store);
  if (!session.authenticated || !session.user) {
    reply.status(401).send({
      code: 'unauthorized',
      message: 'Relay login is required.',
    } satisfies ApiErrorShape);
    return null;
  }
  if (options.admin && session.user.role !== 'admin') {
    reply.status(403).send({
      code: 'forbidden',
      message: 'Admin access is required.',
    } satisfies ApiErrorShape);
    return null;
  }
  if (!options.admin && session.user.role === 'admin') {
    reply.status(403).send({
      code: 'forbidden',
      message: 'Use the relay admin panel for this account.',
    } satisfies ApiErrorShape);
    return null;
  }
  store.recordUserSeen(session.user.id);
  (request as AuthenticatedRelayRequest).relayUser = session.user;
  return session.user;
}

function verifyRelayRequestSession(request: FastifyRequest, store: RelayStore) {
  const candidates = [
    bearerToken(request.headers.authorization),
    queryToken(request.query, 'relaySession'),
    queryToken(request.query, 'token'),
    readCookie(request.headers.cookie, RELAY_COOKIE_NAME),
  ];
  for (const token of candidates) {
    if (!token) continue;
    const session = store.verifySession(token);
    if (session.authenticated) return session;
  }
  return store.emptySession();
}

function attachRelayCookie(reply: FastifyReply, token: string) {
  reply.header(
    'set-cookie',
    `${RELAY_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 14}`,
  );
}

function clearRelayCookie(reply: FastifyReply) {
  reply.header(
    'set-cookie',
    `${RELAY_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

function oauthCallbackUrl(request: FastifyRequest, config: RelayServerConfig, provider: 'google' | 'github') {
  const configured = config.publicBaseUrl?.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  const protocol = forwardedProto || request.protocol;
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost:8788').split(',')[0]?.trim();
  const base = configured || `${protocol}://${host}`;
  return `${base}/relay/auth/oauth/${provider}/callback`;
}

function signOAuthState(provider: 'google' | 'github', secret: string) {
  const payload = Buffer.from(JSON.stringify({ provider, expiresAt: Date.now() + 10 * 60_000, nonce: crypto.randomBytes(18).toString('base64url') })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyOAuthState(state: string, provider: 'google' | 'github', secret: string) {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { provider?: string; expiresAt?: number };
    return parsed.provider === provider && typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now();
  } catch {
    return false;
  }
}

async function fetchGoogleIdentity(code: string, redirectUri: string, config: RelayServerConfig) {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.googleOAuthClientId!, client_secret: config.googleOAuthClientSecret!, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!tokenResponse.ok) throw new Error('Google token exchange failed.');
  const tokens = await tokenResponse.json() as { access_token?: string };
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } });
  if (!response.ok) throw new Error('Google profile lookup failed.');
  const profile = await response.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!profile.sub || !profile.email || !profile.email_verified) throw new Error('Google did not provide a verified email address.');
  return { provider: 'google' as const, subject: profile.sub, email: profile.email.toLowerCase(), username: profile.email.split('@')[0] || profile.name || 'google-user' };
}

async function fetchGitHubIdentity(code: string, redirectUri: string, config: RelayServerConfig) {
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.githubOAuthClientId!, client_secret: config.githubOAuthClientSecret!, redirect_uri: redirectUri }),
  });
  if (!tokenResponse.ok) throw new Error('GitHub token exchange failed.');
  const tokens = await tokenResponse.json() as { access_token?: string };
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${tokens.access_token}`, 'user-agent': 'remote-codex-relay' };
  const [userResponse, emailsResponse] = await Promise.all([
    fetch('https://api.github.com/user', { headers }),
    fetch('https://api.github.com/user/emails', { headers }),
  ]);
  if (!userResponse.ok || !emailsResponse.ok) throw new Error('GitHub profile lookup failed.');
  const user = await userResponse.json() as { id?: number; login?: string };
  const emails = await emailsResponse.json() as Array<{ email?: string; verified?: boolean; primary?: boolean }>;
  const email = emails.find((item) => item.primary && item.verified)?.email ?? emails.find((item) => item.verified)?.email;
  if (!user.id || !user.login || !email) throw new Error('GitHub did not provide a verified email address.');
  return { provider: 'github' as const, subject: String(user.id), email: email.toLowerCase(), username: user.login };
}

function connectionStatus(state: RelayState) {
  const statuses = new Map<string, DeviceConnectionStatus>();
  for (const [deviceId, supervisor] of state.supervisors) {
    statuses.set(deviceId, {
      connected: true,
      connectedAt: supervisor.connectedAt,
      lastHeartbeatAt: supervisor.lastHeartbeatAt,
      ipAddress: supervisor.ipAddress ?? null,
    });
  }
  return statuses;
}

async function enrichAdminSummary(
  summary: RelayAdminSummaryDto,
  state: RelayState,
  store: RelayStore,
  conversationWindowDays?: number,
): Promise<RelayAdminSummaryDto> {
  const workspacesByDeviceId = new Map<string, RelayAdminWorkspaceDto[]>();
  const threadsByDeviceId = new Map<string, RelayAdminThreadDto[]>();
  await Promise.all(
    summary.devices.map(async (device) => {
      const supervisor = state.supervisors.get(device.id);
      if (!supervisor || supervisor.socket.readyState !== WEBSOCKET_OPEN) {
        return;
      }
      const [workspaces, threads] = await Promise.all([
        fetchRelayWorkspaces(supervisor, device.id),
        fetchRelayThreads(supervisor, device.id),
      ]);
      workspacesByDeviceId.set(device.id, workspaces);
      const workspaceLabelById = new Map(
        workspaces.map((workspace) => [workspace.id, workspace.label]),
      );
      threadsByDeviceId.set(
        device.id,
        threads.map((thread) => ({
          ...thread,
          workspaceLabel: thread.workspaceId
            ? (workspaceLabelById.get(thread.workspaceId) ??
              thread.workspaceLabel)
            : null,
        })),
      );
    }),
  );
  const enriched = store.adminSummary(connectionStatus(state), {
    metadata: {
      workspacesByDeviceId,
      threadsByDeviceId,
    },
    ...(conversationWindowDays !== undefined ? { conversationWindowDays } : {}),
  });
  return {
    ...enriched,
    shares: enriched.shares.map((share) => {
      const thread = threadsByDeviceId
        .get(share.deviceId)
        ?.find((item) => item.id === share.threadId);
      const workspace = share.workspaceId
        ? workspacesByDeviceId
            .get(share.deviceId)
            ?.find((item) => item.id === share.workspaceId)
        : null;
      return {
        ...share,
        threadTitle: thread?.title ?? share.threadTitle,
        workspaceLabel:
          workspace?.label ?? thread?.workspaceLabel ?? share.workspaceLabel,
      };
    }),
  };
}

async function fetchRelayWorkspaces(
  supervisor: SupervisorConnection,
  deviceId: string,
): Promise<RelayAdminWorkspaceDto[]> {
  const payload = await forwardSupervisorJson(
    supervisor,
    deviceId,
    '/api/workspaces',
  );
  const rows = Array.isArray(payload) ? payload : [];
  const workspaces: RelayAdminWorkspaceDto[] = [];
  for (const workspace of rows.filter(isObject)) {
    const id = stringField(workspace, 'id');
    const label = stringField(workspace, 'label');
    if (!id || !label) {
      continue;
    }
    workspaces.push({
      id,
      label,
      absPath: stringField(workspace, 'absPath'),
    });
  }
  return workspaces.slice(0, 50);
}

async function fetchRelayThreads(
  supervisor: SupervisorConnection,
  deviceId: string,
): Promise<RelayAdminThreadDto[]> {
  const payload = await forwardSupervisorJson(
    supervisor,
    deviceId,
    '/api/threads',
  );
  const rows = Array.isArray(payload) ? payload : [];
  const threads: RelayAdminThreadDto[] = [];
  for (const thread of rows.filter(isObject)) {
    const id = stringField(thread, 'id');
    if (!id) {
      continue;
    }
    threads.push({
      id,
      title: stringField(thread, 'title') ?? 'Untitled thread',
      workspaceId: stringField(thread, 'workspaceId'),
      workspaceLabel: null,
      status: stringField(thread, 'status'),
      updatedAt:
        stringField(thread, 'updatedAt') ?? stringField(thread, 'createdAt'),
    });
  }
  return threads.slice(0, 80);
}

async function enrichPortalSummary(
  portal: RelayPortalSummaryDto,
  state: RelayState,
  store: RelayStore,
): Promise<RelayPortalSummaryDto> {
  const threadCache = new Map<string, Promise<string | null>>();
  const workspaceCache = new Map<string, Promise<string | null>>();

  const enrichShare = async (
    share: RelaySessionShareDto,
  ): Promise<RelaySessionShareDto> => {
    const supervisor = state.supervisors.get(share.deviceId);
    if (!supervisor || supervisor.socket.readyState !== WEBSOCKET_OPEN) {
      return {
        ...share,
        threadTitle: stableShareThreadTitle(share),
      };
    }

    const threadCacheKey = `${share.deviceId}:${share.threadId}`;
    let threadTitlePromise = threadCache.get(threadCacheKey);
    if (!threadTitlePromise) {
      threadTitlePromise = fetchRelayThreadTitle(
        supervisor,
        share.deviceId,
        share.threadId,
      );
      threadCache.set(threadCacheKey, threadTitlePromise);
    }

    let workspaceLabelPromise: Promise<string | null> = Promise.resolve(null);
    if (share.workspaceId) {
      const workspaceCacheKey = `${share.deviceId}:${share.workspaceId}`;
      const cached = workspaceCache.get(workspaceCacheKey);
      if (cached) {
        workspaceLabelPromise = cached;
      } else {
        workspaceLabelPromise = fetchRelayWorkspaceLabel(
          supervisor,
          share.deviceId,
          share.workspaceId,
        );
        workspaceCache.set(workspaceCacheKey, workspaceLabelPromise);
      }
    }

    const [threadTitle, workspaceLabel] = await Promise.all([
      threadTitlePromise,
      workspaceLabelPromise,
    ]);
    if (threadTitle || workspaceLabel) {
      store.updateShareMetadata(share.id, {
        threadTitle,
        workspaceLabel,
      });
    }
    return {
      ...share,
      threadTitle: threadTitle ?? stableShareThreadTitle(share),
      workspaceLabel: workspaceLabel ?? share.workspaceLabel,
    };
  };

  const [sharedWithMe, sharedByMe] = await Promise.all([
    Promise.all(portal.sharedWithMe.map(enrichShare)),
    Promise.all(portal.sharedByMe.map(enrichShare)),
  ]);

  return {
    ...portal,
    sharedWithMe,
    sharedByMe,
  };
}

async function fetchRelayThreadTitle(
  supervisor: SupervisorConnection,
  deviceId: string,
  threadId: string,
) {
  const payload = await forwardSupervisorJson(
    supervisor,
    deviceId,
    `/api/threads/${encodeURIComponent(threadId)}?limit=1`,
  );
  const thread =
    isObject(payload) && isObject(payload.thread) ? payload.thread : payload;
  return stringField(thread, 'title');
}

async function fetchRelayWorkspaceLabel(
  supervisor: SupervisorConnection,
  deviceId: string,
  workspaceId: string,
) {
  const payload = await forwardSupervisorJson(
    supervisor,
    deviceId,
    `/api/workspaces/${encodeURIComponent(workspaceId)}`,
  );
  return stringField(payload, 'label');
}

function stableShareThreadTitle(share: RelaySessionShareDto) {
  const threadTitle = share.threadTitle?.trim();
  if (!threadTitle) {
    return null;
  }
  const label = share.label?.trim();
  return label && threadTitle === label ? null : threadTitle;
}

async function forwardSupervisorJson(
  supervisor: SupervisorConnection,
  deviceId: string,
  targetPath: string,
  options: { timeoutMs?: number } = {},
) {
  try {
    const response = await supervisor.requestBroker.forward(
      supervisor.socket,
      {
        type: 'relay.request',
        timestamp: new Date().toISOString(),
        requestId: randomUUID(),
        deviceId,
        payload: {
          method: 'GET',
          path: targetPath,
          headers: {},
          body: null,
        },
      },
      { timeoutMs: options.timeoutMs ?? RELAY_PORTAL_METADATA_TIMEOUT_MS },
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return null;
    }
    const body = relayJsonBody(response);
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function relayJsonBody(response: RelayHttpResponsePayload) {
  if (response.bodyEncoding === 'base64') {
    return Buffer.from(response.body, 'base64').toString('utf8');
  }
  return response.body;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringField(value: unknown, field: string) {
  if (!isObject(value)) {
    return null;
  }
  const fieldValue = value[field];
  return typeof fieldValue === 'string' && fieldValue.trim().length > 0
    ? fieldValue
    : null;
}

function relayAccessDto(access: EffectiveRelayAccess): RelayEffectiveAccessDto {
  return {
    kind: access.kind,
    grantId: access.grant?.id ?? null,
    shareId: access.share?.id ?? null,
    scope: access.scope,
    threadAccess: access.threadAccess,
    workspaceAccess: access.workspaceAccess,
    workspaceId: access.workspaceId,
    workspaceScope: access.workspaceScope,
    canCreateThreads: access.canCreateThreads,
  };
}

function recordRelayAccess(
  store: RelayStore,
  access: EffectiveRelayAccess,
  user: RelayUserDto,
  kind: RelayAccessEventKindDto,
) {
  if (access.kind !== 'shared') {
    return;
  }
  if (access.share) {
    store.recordShareAccess(access.share, user, kind);
    return;
  }
  store.recordGrantAccess(access.grant, user, kind);
}

function firstAccessibleConnectedDevice(
  state: RelayState,
  store: RelayStore,
  userId: string,
  threadId?: string | null,
) {
  for (const deviceId of state.supervisors.keys()) {
    if (store.canAccessDevice(userId, deviceId, threadId)) {
      return deviceId;
    }
  }
  return null;
}

function isAllowedRelayTarget(pathValue: string) {
  const pathname = new URL(pathValue, 'http://relay.local').pathname;
  return pathname === '/healthz' || pathname.startsWith('/api/');
}

function isAllowedSharedRuntimeMetadataRequest(
  method: string,
  pathname: string,
) {
  if (method.toUpperCase() !== 'GET') {
    return false;
  }
  if (pathname === '/api/agent-runtimes') {
    return true;
  }
  if (pathname === '/api/plugins') {
    return true;
  }
  return /^\/api\/agent-runtimes\/[^/]+\/(?:status|models)$/.test(pathname);
}

function threadIdFromPath(pathValue: string) {
  const pathname = new URL(pathValue, 'http://relay.local').pathname;
  const match = /^\/api\/threads\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

function workspaceIdFromPath(pathValue: string) {
  const pathname = new URL(pathValue, 'http://relay.local').pathname;
  const match = /^\/api\/workspaces\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

function conversationEventFromRequest(
  method: string,
  pathValue: string,
  body: unknown,
) {
  if (method.toUpperCase() !== 'POST') {
    return null;
  }
  const pathname = new URL(pathValue, 'http://relay.local').pathname;
  if (pathname === '/api/threads/start') {
    return {
      threadId: null,
      workspaceId:
        isObject(body) && typeof body.workspaceId === 'string'
          ? body.workspaceId
          : null,
    };
  }
  const promptMatch = /^\/api\/threads\/([^/?#]+)\/prompt$/.exec(pathname);
  if (promptMatch) {
    return {
      threadId: decodeURIComponent(promptMatch[1]!),
      workspaceId: null,
    };
  }
  return null;
}

function isHostedUserActivityRequest(method: string, pathValue: string) {
  const methodName = method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(methodName)) {
    return false;
  }
  return new URL(pathValue, 'http://relay.local').pathname.startsWith('/api/');
}

function relayAccessEventKindFromRequest(
  method: string,
  pathValue: string,
): RelayAccessEventKindDto | null {
  const methodName = method.toUpperCase();
  const pathname = new URL(pathValue, 'http://relay.local').pathname;
  if (methodName === 'POST' && pathname === '/api/threads/start') {
    return 'create_thread';
  }
  if (
    methodName === 'POST' &&
    /^\/api\/threads\/[^/]+\/prompt$/.test(pathname)
  ) {
    return 'send_prompt';
  }
  if (methodName === 'GET' && /^\/api\/threads\/[^/]+$/.test(pathname)) {
    return 'open_thread';
  }
  if (methodName === 'GET' && /^\/api\/workspaces\/[^/]+$/.test(pathname)) {
    return 'open_device';
  }
  if (
    methodName === 'GET' &&
    /^\/api\/workspaces\/[^/]+\/(?:files\/(?:tree|preview|raw|download)|artifacts(?:\/[^/]+(?:\/download)?)?)$/.test(
      pathname,
    )
  ) {
    return 'read_workspace_file';
  }
  if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(methodName) &&
    /^\/api\/workspaces\/[^/]+\/files(?:\/(?:upload|move))?$/.test(pathname)
  ) {
    return 'write_workspace_file';
  }
  return null;
}

function relayClientIp(request: FastifyRequest) {
  const forwarded =
    firstHeaderValue(request.headers['cf-connecting-ip']) ??
    firstHeaderValue(request.headers['x-real-ip']) ??
    firstHeaderValue(request.headers['x-forwarded-for']);
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || forwarded;
  }
  return request.ip || null;
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function isAllowedForRelayAccess(
  access: EffectiveRelayAccess,
  method: string,
  pathValue: string,
) {
  if (access.kind === 'owner') {
    return true;
  }

  const pathname = new URL(pathValue, 'http://relay.local').pathname;
  const methodName = method.toUpperCase();
  if (isAllowedSharedRuntimeMetadataRequest(methodName, pathname)) {
    return true;
  }
  if (
    access.scope === 'device' &&
    methodName === 'POST' &&
    pathname === '/api/threads/start'
  ) {
    return access.canCreateThreads && access.threadAccess === 'control';
  }
  const threadId = threadIdFromPath(pathValue);
  if (threadId) {
    return isAllowedSharedThreadPath(access, methodName, pathname, threadId);
  }

  const workspaceId = workspaceIdFromPath(pathValue);
  if (workspaceId) {
    return isAllowedSharedWorkspacePath(
      access,
      methodName,
      pathname,
      workspaceId,
    );
  }
  if (access.scope === 'device') {
    if (
      methodName === 'GET' &&
      (pathname === '/api/threads' || pathname === '/api/workspaces')
    ) {
      return true;
    }
  }
  return false;
}

function isAllowedSharedThreadPath(
  access: EffectiveRelayAccess,
  methodName: string,
  pathname: string,
  threadId: string,
) {
  if (access.kind !== 'shared') {
    return false;
  }
  if (access.scope !== 'device' && access.grant.threadId !== threadId) {
    return false;
  }
  const escapedThreadId = escapeRegExp(encodeURIComponent(threadId));
  const readPatterns = [
    new RegExp(`^/api/threads/${escapedThreadId}$`),
    new RegExp(`^/api/threads/${escapedThreadId}/items/[^/]+/detail$`),
    new RegExp(`^/api/threads/${escapedThreadId}/export-turns$`),
    new RegExp(`^/api/threads/${escapedThreadId}/exports/pdf$`),
    new RegExp(`^/api/threads/${escapedThreadId}/assets/image$`),
    new RegExp(`^/api/threads/${escapedThreadId}/goal$`),
    new RegExp(`^/api/threads/${escapedThreadId}/skills$`),
    new RegExp(`^/api/threads/${escapedThreadId}/mcp-servers$`),
    new RegExp(`^/api/threads/${escapedThreadId}/hooks$`),
  ];
  if (
    methodName === 'GET' &&
    readPatterns.some((pattern) => pattern.test(pathname))
  ) {
    return true;
  }
  if (access.threadAccess !== 'control') {
    return false;
  }
  const controlReadPatterns = [
    new RegExp(`^/api/threads/${escapedThreadId}/fork-turns$`),
  ];
  if (methodName === 'GET') {
    return controlReadPatterns.some((pattern) => pattern.test(pathname));
  }
  const controlPatterns = [
    new RegExp(`^/api/threads/${escapedThreadId}/goal$`),
    new RegExp(`^/api/threads/${escapedThreadId}/resume$`),
    new RegExp(`^/api/threads/${escapedThreadId}/prompt$`),
    new RegExp(`^/api/threads/${escapedThreadId}/interrupt$`),
    new RegExp(`^/api/threads/${escapedThreadId}/compact$`),
    new RegExp(`^/api/threads/${escapedThreadId}/fork$`),
    new RegExp(`^/api/threads/${escapedThreadId}/hooks$`),
    new RegExp(`^/api/threads/${escapedThreadId}/hooks/trust$`),
    new RegExp(`^/api/threads/${escapedThreadId}/hooks/untrust$`),
    new RegExp(`^/api/threads/${escapedThreadId}/requests/[^/]+/respond$`),
  ];
  if (methodName === 'PATCH') {
    return [
      new RegExp(`^/api/threads/${escapedThreadId}/goal$`),
      new RegExp(`^/api/threads/${escapedThreadId}/settings$`),
    ].some((pattern) => pattern.test(pathname));
  }
  if (methodName === 'DELETE') {
    return new RegExp(`^/api/threads/${escapedThreadId}/goal$`).test(pathname);
  }
  if (methodName === 'PUT') {
    return new RegExp(`^/api/threads/${escapedThreadId}/hooks$`).test(pathname);
  }
  if (methodName === 'POST') {
    return controlPatterns.some((pattern) => pattern.test(pathname));
  }
  return false;
}

function isAllowedSharedWorkspacePath(
  access: EffectiveRelayAccess,
  methodName: string,
  pathname: string,
  workspaceId: string,
) {
  if (access.kind !== 'shared' || access.workspaceAccess === 'none') {
    return false;
  }
  if (access.scope !== 'device' && access.workspaceId !== workspaceId) {
    return false;
  }
  const escapedWorkspaceId = escapeRegExp(encodeURIComponent(workspaceId));
  const readPatterns = [
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/tree$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/preview$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/raw$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/download$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/artifacts$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/artifacts/[^/]+$`),
    new RegExp(
      `^/api/workspaces/${escapedWorkspaceId}/artifacts/[^/]+/download$`,
    ),
  ];
  if (
    methodName === 'GET' &&
    readPatterns.some((pattern) => pattern.test(pathname))
  ) {
    return true;
  }
  if (access.workspaceAccess !== 'write') {
    return false;
  }
  const writePatterns = [
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/upload$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/move$`),
  ];
  return (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(methodName) &&
    writePatterns.some((pattern) => pattern.test(pathname))
  );
}

function shouldForwardSocketEvent(
  event: SupervisorSocketServerEnvelope,
  threadId: string | null,
) {
  if (!threadId) {
    return true;
  }
  if (
    event.type === 'supervisor.connected' ||
    event.type === 'supervisor.pong'
  ) {
    return true;
  }
  return 'threadId' in event && event.threadId === threadId;
}

export function relayRequestBody(body: unknown): {
  body: string | null;
  bodyEncoding?: 'base64';
} {
  if (body === undefined || body === null) {
    return { body: null };
  }

  if (typeof body === 'string') {
    return { body };
  }

  if (Buffer.isBuffer(body)) {
    return {
      body: body.toString('base64'),
      bodyEncoding: 'base64',
    };
  }

  return { body: JSON.stringify(body) };
}

export function relayRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
) {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      RELAY_REQUEST_HEADER_BLOCKLIST.has(lower) ||
      lower.startsWith('x-forwarded-')
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      output[name] = value.join(', ');
    } else if (value !== undefined) {
      output[name] = value;
    }
  }
  return output;
}

function canForwardResponseHeader(name: string) {
  const lower = name.toLowerCase();
  return !RELAY_RESPONSE_HEADER_BLOCKLIST.has(lower);
}

function bearerToken(value: string | undefined) {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
  return match?.[1]?.trim() ?? null;
}

function queryToken(query: unknown, name = 'token') {
  if (!query || typeof query !== 'object' || !(name in query)) {
    return null;
  }

  const token = (query as Record<string, unknown>)[name];
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function readCookie(cookie: string | undefined, name: string) {
  if (!cookie) {
    return null;
  }
  for (const entry of cookie.split(';')) {
    const [entryName, ...valueParts] = entry.trim().split('=');
    if (entryName === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return null;
}

function pathParam(params: unknown, name: string) {
  if (!params || typeof params !== 'object' || !(name in params)) {
    return null;
  }
  const value = (params as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

function queryString(query: unknown, name: string) {
  if (!query || typeof query !== 'object' || !(name in query)) {
    return null;
  }
  const value = (query as Record<string, unknown>)[name];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function safeStat(filePath: string) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}
