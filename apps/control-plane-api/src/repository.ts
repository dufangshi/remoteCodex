import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';

import { DatabaseClient } from '../../../packages/db/src/index';
import {
  controlAuthIdentities,
  controlAuditLogs,
  controlGatewayKeys,
  controlGatewayUsers,
  controlHarnessKeys,
  controlHarnessUsageEvents,
  controlHarnessUsers,
  controlPasswordCredentials,
  controlProjects,
  controlSandboxes,
  controlSessions,
  controlUsageEvents,
  controlUsageImportState,
  controlUsers,
  controlWorkspaces,
} from '../../../packages/db/src/schema';

export interface RegisterUserInput {
  authProvider: string;
  authSubject: string;
  email: string;
  displayName?: string | null | undefined;
}

export interface AuthIdentityInput extends RegisterUserInput {
  userId: string;
}

export interface UsageEventInput {
  userId: string;
  sandboxId: string;
  workspaceId?: string | null | undefined;
  sessionId?: string | null | undefined;
  gatewayKeyId?: string | null | undefined;
  provider: string;
  model: string;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cachedTokens?: number | undefined;
  costUsd?: number | undefined;
  externalRequestId?: string | null | undefined;
  occurredAt?: string | undefined;
}

export interface UsageImportMetricsInput {
  provider: string;
  source: string;
  cursor?: string | null | undefined;
  sourceCount: number;
  importedCount: number;
  duplicateCount: number;
  failureCount: number;
  failureMessage?: string | null | undefined;
}

export interface HarnessUsageEventInput {
  userId: string;
  sandboxId: string;
  workspaceId?: string | null | undefined;
  sessionId?: string | null | undefined;
  provider: string;
  module: string;
  tool?: string | null | undefined;
  runId?: string | null | undefined;
  jobId?: string | null | undefined;
  externalEventId?: string | null | undefined;
  computeUnits?: number | undefined;
  costUsd?: number | undefined;
  status?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  occurredAt?: string | undefined;
}

export interface SandboxDefaults {
  image: string;
  region: string;
  resourceProfile: string;
  s3PrefixBase: string;
}

export interface PaginationInput {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}

export class ControlPlaneRepository {
  constructor(private readonly db: DatabaseClient) {}

  upsertUser(input: RegisterUserInput) {
    const now = new Date().toISOString();
    const existing = this.db
      .select()
      .from(controlUsers)
      .where(
        and(
          eq(controlUsers.authProvider, input.authProvider),
          eq(controlUsers.authSubject, input.authSubject),
        ),
      )
      .get();

    if (existing) {
      this.db
        .update(controlUsers)
        .set({
          email: input.email,
          displayName: input.displayName ?? existing.displayName,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(controlUsers.id, existing.id))
        .run();
      return this.getUserById(existing.id)!;
    }

    const record = {
      id: randomUUID(),
      authProvider: input.authProvider,
      authSubject: input.authSubject,
      email: input.email,
      displayName: input.displayName ?? null,
      status: 'active',
      plan: 'developer',
      billingCustomerId: null,
      quotaProfile: 'developer',
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
    this.db.insert(controlUsers).values(record).run();
    this.audit(record.id, 'user.registered', 'user', record.id, {
      authProvider: input.authProvider,
    });
    return record;
  }

  listUsers(input: { status?: string | undefined; plan?: string | undefined } = {}) {
    const filters = [
      input.status ? eq(controlUsers.status, input.status) : null,
      input.plan ? eq(controlUsers.plan, input.plan) : null,
    ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));
    const query = this.db.select().from(controlUsers);
    return (filters.length ? query.where(and(...filters)) : query)
      .orderBy(desc(controlUsers.createdAt))
      .all();
  }

  listAuditLogs(input: { action?: string | undefined; resourceId?: string | undefined } = {}) {
    const filters = [
      input.action ? eq(controlAuditLogs.action, input.action) : null,
      input.resourceId ? eq(controlAuditLogs.resourceId, input.resourceId) : null,
    ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));
    const query = this.db.select().from(controlAuditLogs);
    return (filters.length ? query.where(and(...filters)) : query)
      .orderBy(desc(controlAuditLogs.createdAt))
      .all();
  }

  listRecentAuditLogs(input: {
    resourceId: string;
    actionPrefix?: string | undefined;
    limit: number;
  }) {
    const filters = [
      eq(controlAuditLogs.resourceId, input.resourceId),
      input.actionPrefix ? like(controlAuditLogs.action, `${escapeLike(input.actionPrefix)}%`) : null,
    ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));
    return this.db
      .select()
      .from(controlAuditLogs)
      .where(and(...filters))
      .orderBy(desc(controlAuditLogs.createdAt))
      .limit(input.limit)
      .all();
  }

  getUserById(id: string) {
    return this.db.select().from(controlUsers).where(eq(controlUsers.id, id)).get();
  }

  getUserByAuthSubject(authProvider: string, authSubject: string) {
    return this.db
      .select()
      .from(controlUsers)
      .where(
        and(
          eq(controlUsers.authProvider, authProvider),
          eq(controlUsers.authSubject, authSubject),
        ),
      )
      .get();
  }

  getUserByEmail(email: string) {
    return this.db
      .select()
      .from(controlUsers)
      .where(eq(controlUsers.email, normalizeEmail(email)))
      .get();
  }

  getUserByAuthIdentity(authProvider: string, authSubject: string) {
    const identity = this.db
      .select()
      .from(controlAuthIdentities)
      .where(
        and(
          eq(controlAuthIdentities.authProvider, authProvider),
          eq(controlAuthIdentities.authSubject, authSubject),
        ),
      )
      .get();
    return identity ? this.getUserById(identity.userId) : null;
  }

  upsertAuthIdentity(input: AuthIdentityInput) {
    const now = new Date().toISOString();
    const existing = this.db
      .select()
      .from(controlAuthIdentities)
      .where(
        and(
          eq(controlAuthIdentities.authProvider, input.authProvider),
          eq(controlAuthIdentities.authSubject, input.authSubject),
        ),
      )
      .get();
    if (existing) {
      this.db
        .update(controlAuthIdentities)
        .set({
          userId: input.userId,
          email: normalizeEmail(input.email),
          displayName: input.displayName ?? existing.displayName,
          updatedAt: now,
        })
        .where(eq(controlAuthIdentities.id, existing.id))
        .run();
      return this.db
        .select()
        .from(controlAuthIdentities)
        .where(eq(controlAuthIdentities.id, existing.id))
        .get()!;
    }
    const record = {
      id: randomUUID(),
      userId: input.userId,
      authProvider: input.authProvider,
      authSubject: input.authSubject,
      email: normalizeEmail(input.email),
      displayName: input.displayName ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(controlAuthIdentities).values(record).run();
    this.audit(input.userId, 'auth_identity.linked', 'user', input.userId, {
      authProvider: input.authProvider,
    });
    return record;
  }

  getPasswordCredentialByEmail(email: string) {
    return this.db
      .select()
      .from(controlPasswordCredentials)
      .where(eq(controlPasswordCredentials.email, normalizeEmail(email)))
      .get();
  }

  upsertPasswordCredential(input: {
    userId: string;
    email: string;
    passwordHash: string;
  }) {
    const now = new Date().toISOString();
    const email = normalizeEmail(input.email);
    const existing = this.getPasswordCredentialByEmail(email);
    if (existing) {
      this.db
        .update(controlPasswordCredentials)
        .set({
          userId: input.userId,
          passwordHash: input.passwordHash,
          updatedAt: now,
        })
        .where(eq(controlPasswordCredentials.id, existing.id))
        .run();
      return this.getPasswordCredentialByEmail(email)!;
    }
    const record = {
      id: randomUUID(),
      userId: input.userId,
      email,
      passwordHash: input.passwordHash,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    };
    this.db.insert(controlPasswordCredentials).values(record).run();
    this.audit(input.userId, 'password_credential.created', 'user', input.userId, {});
    return record;
  }

  markPasswordCredentialUsed(id: string) {
    this.db
      .update(controlPasswordCredentials)
      .set({
        lastUsedAt: new Date().toISOString(),
      })
      .where(eq(controlPasswordCredentials.id, id))
      .run();
  }

  updateUser(id: string, input: {
    status?: string | undefined;
    plan?: string | undefined;
    displayName?: string | null | undefined;
    billingCustomerId?: string | null | undefined;
    quotaProfile?: string | undefined;
  }) {
    const update: {
      status?: string;
      plan?: string;
      displayName?: string | null;
      billingCustomerId?: string | null;
      quotaProfile?: string;
      updatedAt: string;
    } = {
      updatedAt: new Date().toISOString(),
    };
    if (input.status !== undefined) {
      update.status = input.status;
    }
    if (input.plan !== undefined) {
      update.plan = input.plan;
    }
    if (input.displayName !== undefined) {
      update.displayName = input.displayName;
    }
    if (input.billingCustomerId !== undefined) {
      update.billingCustomerId = input.billingCustomerId;
    }
    if (input.quotaProfile !== undefined) {
      update.quotaProfile = input.quotaProfile;
    }
    this.db.update(controlUsers).set(update).where(eq(controlUsers.id, id)).run();
    this.audit(id, 'user.updated', 'user', id, input);
    return this.getUserById(id);
  }

  createProject(input: { userId: string; name: string; slug: string }) {
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      userId: input.userId,
      name: input.name,
      slug: input.slug,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(controlProjects).values(record).run();
    this.audit(input.userId, 'project.created', 'project', record.id, {
      slug: input.slug,
    });
    return record;
  }

  listProjects(userId: string, input: {
    pagination?: PaginationInput | undefined;
    search?: string | undefined;
    status?: string | undefined;
  } = {}): PaginatedResult<typeof controlProjects.$inferSelect> {
    const filters = [
      eq(controlProjects.userId, userId),
      input.status ? eq(controlProjects.status, input.status) : null,
      input.search ? like(controlProjects.name, `%${escapeLike(input.search)}%`) : null,
    ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));
    const total = this.db
      .select({ count: sql<number>`count(*)` })
      .from(controlProjects)
      .where(and(...filters))
      .get()?.count ?? 0;
    const query = this.db
      .select()
      .from(controlProjects)
      .where(and(...filters))
      .orderBy(desc(controlProjects.createdAt));
    const items = input.pagination
      ? query.limit(input.pagination.limit).offset(input.pagination.offset).all()
      : query.all();
    return paginated(items, input.pagination, total);
  }

  getProjectById(id: string) {
    return this.db.select().from(controlProjects).where(eq(controlProjects.id, id)).get();
  }

  updateProject(id: string, input: { name?: string | undefined; status?: string | undefined }) {
    const update: {
      name?: string;
      status?: string;
      updatedAt: string;
    } = {
      updatedAt: new Date().toISOString(),
    };
    if (input.name !== undefined) {
      update.name = input.name;
    }
    if (input.status !== undefined) {
      update.status = input.status;
    }
    this.db.update(controlProjects).set(update).where(eq(controlProjects.id, id)).run();
    const project = this.getProjectById(id);
    if (project) {
      this.audit(project.userId, 'project.updated', 'project', id, input);
    }
    return project;
  }

  ensureSandboxForUser(userId: string, defaults: SandboxDefaults) {
    const existing = this.db
      .select()
      .from(controlSandboxes)
      .where(eq(controlSandboxes.userId, userId))
      .get();
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const sandboxId = randomUUID();
    const record = {
      id: sandboxId,
      userId,
      state: 'stopped',
      image: defaults.image,
      region: defaults.region,
      resourceProfile: defaults.resourceProfile,
      k8sNamespace: null,
      k8sPodName: null,
      routerBaseUrl: null,
      workerServiceName: null,
      s3Prefix: `${defaults.s3PrefixBase.replace(/\/$/, '')}/${userId}/${sandboxId}`,
      gatewayKeyId: null,
      lastStartedAt: null,
      lastSeenAt: null,
      idleTimeoutAt: null,
      statusReason: null,
      startupProgress: 0,
      lastFailureCode: null,
      lastFailureMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(controlSandboxes).values(record).run();
    this.audit(userId, 'sandbox.created', 'sandbox', sandboxId, {
      state: record.state,
      image: record.image,
      region: record.region,
    });
    return record;
  }

  getSandboxByUserId(userId: string) {
    return this.db
      .select()
      .from(controlSandboxes)
      .where(eq(controlSandboxes.userId, userId))
      .get();
  }

  getSandboxById(id: string) {
    return this.db.select().from(controlSandboxes).where(eq(controlSandboxes.id, id)).get();
  }

  hasSandbox(id: string) {
    return Boolean(this.getSandboxById(id));
  }

  updateSandboxState(
    sandboxId: string,
    input: {
      state: string;
      routerBaseUrl?: string | null;
      workerServiceName?: string | null;
      k8sNamespace?: string | null;
      k8sPodName?: string | null;
      statusReason?: string | null;
      startupProgress?: number;
      lastFailureCode?: string | null;
      lastFailureMessage?: string | null;
      auditMetadata?: Record<string, unknown>;
    },
  ) {
    const now = new Date().toISOString();
    const { auditMetadata: _auditMetadata, ...stateInput } = input;
    this.db
      .update(controlSandboxes)
      .set({
        ...stateInput,
        lastStartedAt: input.state === 'running' ? now : undefined,
        updatedAt: now,
      })
      .where(eq(controlSandboxes.id, sandboxId))
      .run();
    const sandbox = this.getSandboxById(sandboxId);
    if (sandbox) {
      this.audit(sandbox.userId, `sandbox.${input.state}`, 'sandbox', sandboxId, {
        ...input,
        ...(input.auditMetadata ?? {}),
        auditMetadata: undefined,
      });
    }
    return sandbox;
  }

  patchSandbox(
    sandboxId: string,
    input: Partial<{
      state: string;
      image: string;
      region: string;
      resourceProfile: 'small' | 'standard' | 'large';
      routerBaseUrl: string | null;
      workerServiceName: string | null;
      k8sNamespace: string | null;
      k8sPodName: string | null;
      lastStartedAt: string | null;
      lastSeenAt: string | null;
      idleTimeoutAt: string | null;
      statusReason: string | null;
      startupProgress: number;
      lastFailureCode: string | null;
      lastFailureMessage: string | null;
      updatedAt: string;
    }>,
  ) {
    const sandbox = this.getSandboxById(sandboxId);
    if (!sandbox) {
      return null;
    }
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    this.db
      .update(controlSandboxes)
      .set({
        ...input,
        updatedAt,
      })
      .where(eq(controlSandboxes.id, sandboxId))
      .run();
    this.audit(sandbox.userId, 'sandbox.patched', 'sandbox', sandboxId, input);
    return this.getSandboxById(sandboxId);
  }

  markSandboxSeen(sandboxId: string, seenAt = new Date().toISOString()) {
    this.db
      .update(controlSandboxes)
      .set({
        lastSeenAt: seenAt,
        updatedAt: seenAt,
      })
      .where(eq(controlSandboxes.id, sandboxId))
      .run();
    return this.getSandboxById(sandboxId);
  }

  createWorkspace(input: {
    userId: string;
    projectId?: string | null | undefined;
    sandboxId: string;
    name: string;
    slug: string;
    sourceType: string;
    gitUrl?: string | null | undefined;
    defaultBranch?: string | null | undefined;
  }) {
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      userId: input.userId,
      projectId: input.projectId ?? null,
      sandboxId: input.sandboxId,
      name: input.name,
      slug: input.slug,
      status: 'active',
      path: `/workspace/${input.slug}`,
      sourceType: input.sourceType,
      gitUrl: input.gitUrl ?? null,
      defaultBranch: input.defaultBranch ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(controlWorkspaces).values(record).run();
    this.audit(input.userId, 'workspace.created', 'workspace', record.id, {
      sandboxId: input.sandboxId,
      projectId: input.projectId ?? null,
      slug: input.slug,
    });
    return record;
  }

  listWorkspaces(userId: string, input: {
    projectId?: string | undefined;
    pagination?: PaginationInput | undefined;
    search?: string | undefined;
    status?: string | undefined;
  } = {}): PaginatedResult<typeof controlWorkspaces.$inferSelect> {
    const filters = [
      eq(controlWorkspaces.userId, userId),
      input.projectId ? eq(controlWorkspaces.projectId, input.projectId) : null,
      input.status ? eq(controlWorkspaces.status, input.status) : null,
      input.search ? like(controlWorkspaces.name, `%${escapeLike(input.search)}%`) : null,
    ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));
    const total = this.db
      .select({ count: sql<number>`count(*)` })
      .from(controlWorkspaces)
      .where(and(...filters))
      .get()?.count ?? 0;
    const query = this.db
      .select()
      .from(controlWorkspaces)
      .where(and(...filters))
      .orderBy(desc(controlWorkspaces.createdAt));
    const items = input.pagination
      ? query.limit(input.pagination.limit).offset(input.pagination.offset).all()
      : query.all();
    return paginated(items, input.pagination, total);
  }

  getWorkspaceById(id: string) {
    return this.db.select().from(controlWorkspaces).where(eq(controlWorkspaces.id, id)).get();
  }

  updateWorkspace(id: string, input: {
    name?: string | undefined;
    status?: string | undefined;
  }) {
    const update: {
      name?: string;
      status?: string;
      updatedAt: string;
    } = {
      updatedAt: new Date().toISOString(),
    };
    if (input.name !== undefined) {
      update.name = input.name;
    }
    if (input.status !== undefined) {
      update.status = input.status;
    }
    this.db.update(controlWorkspaces).set(update).where(eq(controlWorkspaces.id, id)).run();
    const workspace = this.getWorkspaceById(id);
    if (workspace) {
      this.audit(workspace.userId, 'workspace.updated', 'workspace', id, input);
    }
    return workspace;
  }

  createSession(input: {
    userId: string;
    sandboxId: string;
    workspaceId: string;
    provider: string;
    title: string;
  }) {
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      userId: input.userId,
      sandboxId: input.sandboxId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      workerSessionId: null,
      title: input.title,
      status: 'created',
      lastActivityAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(controlSessions).values(record).run();
    this.audit(input.userId, 'session.created', 'session', record.id, {
      provider: input.provider,
      workspaceId: input.workspaceId,
    });
    return record;
  }

  listSessionsForWorkspace(
    workspaceId: string,
    input: {
      pagination?: PaginationInput | undefined;
      search?: string | undefined;
      status?: string | undefined;
      provider?: string | undefined;
    } = {},
  ): PaginatedResult<typeof controlSessions.$inferSelect> {
    const filters = [
      eq(controlSessions.workspaceId, workspaceId),
      input.status ? eq(controlSessions.status, input.status) : null,
      input.provider ? eq(controlSessions.provider, input.provider) : null,
      input.search ? like(controlSessions.title, `%${escapeLike(input.search)}%`) : null,
    ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));
    const total = this.db
      .select({ count: sql<number>`count(*)` })
      .from(controlSessions)
      .where(and(...filters))
      .get()?.count ?? 0;
    const query = this.db
      .select()
      .from(controlSessions)
      .where(and(...filters))
      .orderBy(desc(controlSessions.createdAt));
    const items = input.pagination
      ? query.limit(input.pagination.limit).offset(input.pagination.offset).all()
      : query.all();
    return paginated(items, input.pagination, total);
  }

  getSessionById(id: string) {
    return this.db.select().from(controlSessions).where(eq(controlSessions.id, id)).get();
  }

  listSandboxes() {
    return this.db
      .select()
      .from(controlSandboxes)
      .orderBy(desc(controlSandboxes.updatedAt))
      .all();
  }

  listSandboxesByStates(states: string[]) {
    if (states.length === 0) {
      return [];
    }
    return this.db
      .select()
      .from(controlSandboxes)
      .where(inArray(controlSandboxes.state, states))
      .orderBy(desc(controlSandboxes.updatedAt))
      .all();
  }

  updateSession(id: string, input: {
    title?: string | undefined;
    status?: string | undefined;
    workerSessionId?: string | null | undefined;
  }) {
    const now = new Date().toISOString();
    const update: {
      title?: string;
      status?: string;
      workerSessionId?: string | null;
      lastActivityAt?: string;
      updatedAt: string;
    } = {
      updatedAt: now,
    };
    if (input.title !== undefined) {
      update.title = input.title;
    }
    if (input.status !== undefined) {
      update.status = input.status;
      update.lastActivityAt = now;
    }
    if (input.workerSessionId !== undefined) {
      update.workerSessionId = input.workerSessionId;
      update.lastActivityAt = now;
    }
    this.db.update(controlSessions).set(update).where(eq(controlSessions.id, id)).run();
    const session = this.getSessionById(id);
    if (session) {
      this.audit(session.userId, 'session.updated', 'session', id, input);
    }
    return session;
  }

  checkpointSession(id: string, input: {
    workerSessionId?: string | null | undefined;
    status?: string | undefined;
  }) {
    const now = new Date().toISOString();
    const update: {
      workerSessionId?: string | null;
      status?: string;
      lastActivityAt: string;
      updatedAt: string;
    } = {
      lastActivityAt: now,
      updatedAt: now,
    };
    if (input.workerSessionId !== undefined) {
      update.workerSessionId = input.workerSessionId;
    }
    if (input.status !== undefined) {
      update.status = input.status;
    }
    this.db.update(controlSessions).set(update).where(eq(controlSessions.id, id)).run();
    const session = this.getSessionById(id);
    if (session) {
      this.audit(session.userId, 'session.checkpointed', 'session', id, input);
    }
    return session;
  }

  upsertGatewayUser(input: { userId: string; provider: string; externalUserId: string }) {
    const existing = this.db
      .select()
      .from(controlGatewayUsers)
      .where(
        and(
          eq(controlGatewayUsers.userId, input.userId),
          eq(controlGatewayUsers.provider, input.provider),
        ),
      )
      .get();
    if (existing) {
      return existing;
    }
    const record = {
      id: randomUUID(),
      userId: input.userId,
      provider: input.provider,
      externalUserId: input.externalUserId,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(controlGatewayUsers).values(record).run();
    return record;
  }

  upsertGatewayKey(input: {
    userId: string;
    sandboxId: string;
    provider: string;
    externalKeyId: string;
    keyCiphertext?: string | null;
  }) {
    const existing = this.db
      .select()
      .from(controlGatewayKeys)
      .where(
        and(
          eq(controlGatewayKeys.sandboxId, input.sandboxId),
          eq(controlGatewayKeys.provider, input.provider),
        ),
      )
      .get();
    if (existing) {
      return existing;
    }
    const record = {
      id: randomUUID(),
      userId: input.userId,
      sandboxId: input.sandboxId,
      provider: input.provider,
      externalKeyId: input.externalKeyId,
      keyCiphertext: input.keyCiphertext ?? null,
      status: 'active',
      createdAt: new Date().toISOString(),
      rotatedAt: null,
      revokedAt: null,
    };
    this.db.insert(controlGatewayKeys).values(record).run();
    this.db
      .update(controlSandboxes)
      .set({ gatewayKeyId: record.id, updatedAt: new Date().toISOString() })
      .where(eq(controlSandboxes.id, input.sandboxId))
      .run();
    return record;
  }

  updateGatewayKeyRotation(input: {
    sandboxId: string;
    provider: string;
    externalKeyId: string;
    keyCiphertext?: string | null;
  }) {
    const now = new Date().toISOString();
    this.db
      .update(controlGatewayKeys)
      .set({
        externalKeyId: input.externalKeyId,
        keyCiphertext: input.keyCiphertext ?? null,
        status: 'active',
        rotatedAt: now,
        revokedAt: null,
      })
      .where(
        and(
          eq(controlGatewayKeys.sandboxId, input.sandboxId),
          eq(controlGatewayKeys.provider, input.provider),
        ),
      )
      .run();
    const key = this.getGatewayKeyForSandbox(input.sandboxId);
    if (key) {
      this.audit(key.userId, 'gateway_key.rotated', 'gateway_key', key.id, {
        provider: input.provider,
        externalKeyId: input.externalKeyId,
      });
    }
    return key;
  }

  revokeGatewayKey(input: { sandboxId: string; provider: string }) {
    const existing = this.getGatewayKeyForSandbox(input.sandboxId);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    this.db
      .update(controlGatewayKeys)
      .set({
        status: 'revoked',
        revokedAt: now,
      })
      .where(eq(controlGatewayKeys.id, existing.id))
      .run();
    this.db
      .update(controlSandboxes)
      .set({ gatewayKeyId: null, updatedAt: now })
      .where(eq(controlSandboxes.id, input.sandboxId))
      .run();
    const key = this.getGatewayKeyForSandbox(input.sandboxId);
    this.audit(existing.userId, 'gateway_key.revoked', 'gateway_key', existing.id, {
      provider: input.provider,
      externalKeyId: existing.externalKeyId,
    });
    return key;
  }

  getGatewayKeyForSandbox(sandboxId: string) {
    return this.db
      .select()
      .from(controlGatewayKeys)
      .where(eq(controlGatewayKeys.sandboxId, sandboxId))
      .get();
  }

  getGatewayKeyByExternalId(input: { provider: string; externalKeyId: string }) {
    return this.db
      .select()
      .from(controlGatewayKeys)
      .where(
        and(
          eq(controlGatewayKeys.provider, input.provider),
          eq(controlGatewayKeys.externalKeyId, input.externalKeyId),
        ),
      )
      .get();
  }

  getGatewayUserForUser(input: { userId: string; provider: string }) {
    return this.db
      .select()
      .from(controlGatewayUsers)
      .where(
        and(
          eq(controlGatewayUsers.userId, input.userId),
          eq(controlGatewayUsers.provider, input.provider),
        ),
      )
      .get();
  }

  upsertHarnessUser(input: { userId: string; provider: string; externalUserId: string }) {
    const existing = this.db
      .select()
      .from(controlHarnessUsers)
      .where(
        and(
          eq(controlHarnessUsers.userId, input.userId),
          eq(controlHarnessUsers.provider, input.provider),
        ),
      )
      .get();
    if (existing) {
      return existing;
    }
    const record = {
      id: randomUUID(),
      userId: input.userId,
      provider: input.provider,
      externalUserId: input.externalUserId,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(controlHarnessUsers).values(record).run();
    return record;
  }

  upsertHarnessKey(input: {
    userId: string;
    sandboxId: string;
    provider: string;
    externalKeyId: string;
    keyCiphertext?: string | null;
    secretName?: string | null;
    secretKey?: string | null;
  }) {
    const existing = this.db
      .select()
      .from(controlHarnessKeys)
      .where(
        and(
          eq(controlHarnessKeys.sandboxId, input.sandboxId),
          eq(controlHarnessKeys.provider, input.provider),
        ),
      )
      .get();
    if (existing) {
      return existing;
    }
    const record = {
      id: randomUUID(),
      userId: input.userId,
      sandboxId: input.sandboxId,
      provider: input.provider,
      externalKeyId: input.externalKeyId,
      keyCiphertext: input.keyCiphertext ?? null,
      secretName: input.secretName ?? null,
      secretKey: input.secretKey ?? null,
      status: 'active',
      createdAt: new Date().toISOString(),
      rotatedAt: null,
      revokedAt: null,
    };
    this.db.insert(controlHarnessKeys).values(record).run();
    this.audit(input.userId, 'harness_key.created', 'harness_key', record.id, {
      provider: input.provider,
      externalKeyId: input.externalKeyId,
      sandboxId: input.sandboxId,
      secretName: input.secretName ?? null,
      secretKey: input.secretKey ?? null,
    });
    return record;
  }

  updateHarnessKeyRotation(input: {
    sandboxId: string;
    provider: string;
    externalKeyId: string;
    keyCiphertext?: string | null;
    secretName?: string | null;
    secretKey?: string | null;
  }) {
    const now = new Date().toISOString();
    this.db
      .update(controlHarnessKeys)
      .set({
        externalKeyId: input.externalKeyId,
        keyCiphertext: input.keyCiphertext ?? null,
        secretName: input.secretName ?? null,
        secretKey: input.secretKey ?? null,
        status: 'active',
        rotatedAt: now,
        revokedAt: null,
      })
      .where(
        and(
          eq(controlHarnessKeys.sandboxId, input.sandboxId),
          eq(controlHarnessKeys.provider, input.provider),
        ),
      )
      .run();
    const key = this.getHarnessKeyForSandbox(input.sandboxId);
    if (key) {
      this.audit(key.userId, 'harness_key.rotated', 'harness_key', key.id, {
        provider: input.provider,
        externalKeyId: input.externalKeyId,
        secretName: input.secretName ?? null,
        secretKey: input.secretKey ?? null,
      });
    }
    return key;
  }

  revokeHarnessKey(input: { sandboxId: string; provider: string }) {
    const existing = this.getHarnessKeyForSandbox(input.sandboxId);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    this.db
      .update(controlHarnessKeys)
      .set({
        status: 'revoked',
        revokedAt: now,
      })
      .where(eq(controlHarnessKeys.id, existing.id))
      .run();
    const key = this.getHarnessKeyForSandbox(input.sandboxId);
    this.audit(existing.userId, 'harness_key.revoked', 'harness_key', existing.id, {
      provider: input.provider,
      externalKeyId: existing.externalKeyId,
    });
    return key;
  }

  getHarnessKeyForSandbox(sandboxId: string) {
    return this.db
      .select()
      .from(controlHarnessKeys)
      .where(eq(controlHarnessKeys.sandboxId, sandboxId))
      .get();
  }

  getHarnessKeyByExternalId(input: { provider: string; externalKeyId: string }) {
    return this.db
      .select()
      .from(controlHarnessKeys)
      .where(
        and(
          eq(controlHarnessKeys.provider, input.provider),
          eq(controlHarnessKeys.externalKeyId, input.externalKeyId),
        ),
      )
      .get();
  }

  getHarnessUserForUser(input: { userId: string; provider: string }) {
    return this.db
      .select()
      .from(controlHarnessUsers)
      .where(
        and(
          eq(controlHarnessUsers.userId, input.userId),
          eq(controlHarnessUsers.provider, input.provider),
        ),
      )
      .get();
  }

  usageSummaryForUser(userId: string) {
    return (
      this.db
      .select({
        requestCount: sql<number>`count(*)`,
        inputTokens: sql<number>`coalesce(sum(${controlUsageEvents.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${controlUsageEvents.outputTokens}), 0)`,
        cachedTokens: sql<number>`coalesce(sum(${controlUsageEvents.cachedTokens}), 0)`,
        costUsd: sql<number>`coalesce(sum(${controlUsageEvents.costUsd}), 0)`,
      })
      .from(controlUsageEvents)
      .where(eq(controlUsageEvents.userId, userId))
      .get() ?? {
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
      }
    );
  }

  listUsageEventsForUser(userId: string, limit = 100) {
    return this.db
      .select()
      .from(controlUsageEvents)
      .where(eq(controlUsageEvents.userId, userId))
      .orderBy(desc(controlUsageEvents.occurredAt))
      .limit(limit)
      .all();
  }

  getUsageImportState(input: { provider: string; source: string }) {
    return this.db
      .select()
      .from(controlUsageImportState)
      .where(
        and(
          eq(controlUsageImportState.provider, input.provider),
          eq(controlUsageImportState.source, input.source),
        ),
      )
      .get();
  }

  markUsageImportStarted(input: { provider: string; source: string }) {
    const now = new Date().toISOString();
    const existing = this.getUsageImportState(input);
    if (existing) {
      this.db
        .update(controlUsageImportState)
        .set({
          lastStartedAt: now,
          updatedAt: now,
        })
        .where(eq(controlUsageImportState.id, existing.id))
        .run();
      return this.getUsageImportState(input)!;
    }
    const record = {
      id: randomUUID(),
      provider: input.provider,
      source: input.source,
      cursor: null,
      lastStartedAt: now,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastFailureMessage: null,
      lastSourceCount: 0,
      lastImportedCount: 0,
      lastDuplicateCount: 0,
      lastFailureCount: 0,
      updatedAt: now,
    };
    this.db.insert(controlUsageImportState).values(record).run();
    return record;
  }

  recordUsageImportMetrics(input: UsageImportMetricsInput) {
    const now = new Date().toISOString();
    const existing =
      this.getUsageImportState({ provider: input.provider, source: input.source }) ??
      this.markUsageImportStarted({ provider: input.provider, source: input.source });
    this.db
      .update(controlUsageImportState)
      .set({
        cursor: input.cursor ?? existing.cursor,
        lastSucceededAt: input.failureCount > 0 ? existing.lastSucceededAt : now,
        lastFailedAt: input.failureCount > 0 ? now : existing.lastFailedAt,
        lastFailureMessage: input.failureMessage ?? null,
        lastSourceCount: input.sourceCount,
        lastImportedCount: input.importedCount,
        lastDuplicateCount: input.duplicateCount,
        lastFailureCount: input.failureCount,
        updatedAt: now,
      })
      .where(eq(controlUsageImportState.id, existing.id))
      .run();
    return this.getUsageImportState({ provider: input.provider, source: input.source })!;
  }

  recordUsageEvent(input: UsageEventInput) {
    if (input.externalRequestId) {
      const existing = this.db
        .select()
        .from(controlUsageEvents)
        .where(
          and(
            eq(controlUsageEvents.provider, input.provider),
            eq(controlUsageEvents.externalRequestId, input.externalRequestId),
          ),
        )
        .get();
      if (existing) {
        return existing;
      }
    }
    const record = {
      id: randomUUID(),
      userId: input.userId,
      sandboxId: input.sandboxId,
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      gatewayKeyId: input.gatewayKeyId ?? null,
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      cachedTokens: input.cachedTokens ?? 0,
      costUsd: input.costUsd ?? 0,
      externalRequestId: input.externalRequestId ?? null,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      importedAt: new Date().toISOString(),
    };
    this.db.insert(controlUsageEvents).values(record).run();
    return record;
  }

  recordHarnessUsageEvent(input: HarnessUsageEventInput) {
    if (input.externalEventId) {
      const existing = this.db
        .select()
        .from(controlHarnessUsageEvents)
        .where(
          and(
            eq(controlHarnessUsageEvents.provider, input.provider),
            eq(controlHarnessUsageEvents.externalEventId, input.externalEventId),
          ),
        )
        .get();
      if (existing) {
        return existing;
      }
    }
    const record = {
      id: randomUUID(),
      userId: input.userId,
      sandboxId: input.sandboxId,
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      provider: input.provider,
      module: input.module,
      tool: input.tool ?? null,
      runId: input.runId ?? null,
      jobId: input.jobId ?? null,
      externalEventId: input.externalEventId ?? null,
      computeUnits: input.computeUnits ?? 0,
      costUsd: input.costUsd ?? 0,
      status: input.status ?? 'unknown',
      metadataJson: JSON.stringify(input.metadata ?? {}),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      importedAt: new Date().toISOString(),
    };
    this.db.insert(controlHarnessUsageEvents).values(record).run();
    this.audit(input.userId, 'harness.usage_recorded', 'harness_usage', record.id, {
      sandboxId: input.sandboxId,
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      provider: input.provider,
      module: input.module,
      tool: input.tool ?? null,
      runId: input.runId ?? null,
      jobId: input.jobId ?? null,
      externalEventId: input.externalEventId ?? null,
      computeUnits: input.computeUnits ?? 0,
      costUsd: input.costUsd ?? 0,
      status: input.status ?? 'unknown',
    });
    return record;
  }

  listHarnessUsageEventsForUser(userId: string, limit = 100) {
    return this.db
      .select()
      .from(controlHarnessUsageEvents)
      .where(eq(controlHarnessUsageEvents.userId, userId))
      .orderBy(desc(controlHarnessUsageEvents.occurredAt))
      .limit(limit)
      .all();
  }

  harnessUsageSummaryForUser(userId: string) {
    return (
      this.db
        .select({
          eventCount: sql<number>`count(*)`,
          computeUnits: sql<number>`coalesce(sum(${controlHarnessUsageEvents.computeUnits}), 0)`,
          costUsd: sql<number>`coalesce(sum(${controlHarnessUsageEvents.costUsd}), 0)`,
        })
        .from(controlHarnessUsageEvents)
        .where(eq(controlHarnessUsageEvents.userId, userId))
        .get() ?? {
        eventCount: 0,
        computeUnits: 0,
        costUsd: 0,
      }
    );
  }

  audit(
    userId: string | null,
    action: string,
    resourceType: string,
    resourceId: string | null,
    metadata: unknown,
  ) {
    this.db
      .insert(controlAuditLogs)
      .values({
        id: randomUUID(),
        userId,
        action,
        resourceType,
        resourceId,
        metadataJson: JSON.stringify(metadata),
        createdAt: new Date().toISOString(),
      })
      .run();
  }
}

function paginated<T>(items: T[], pagination: PaginationInput | undefined, total: number): PaginatedResult<T> {
  const limit = pagination?.limit ?? total;
  const offset = pagination?.offset ?? 0;
  return {
    items,
    page: {
      limit,
      offset,
      total,
      hasMore: offset + items.length < total,
    },
  };
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
