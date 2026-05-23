import { randomUUID } from 'node:crypto';

import { and, desc, eq, sql } from 'drizzle-orm';

import { DatabaseClient } from '../../../packages/db/src/index';
import {
  controlAuditLogs,
  controlGatewayKeys,
  controlGatewayUsers,
  controlSandboxes,
  controlSessions,
  controlUsageEvents,
  controlUsers,
  controlWorkspaces,
} from '../../../packages/db/src/schema';

export interface RegisterUserInput {
  authProvider: string;
  authSubject: string;
  email: string;
  displayName?: string | null | undefined;
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

export interface SandboxDefaults {
  image: string;
  region: string;
  s3PrefixBase: string;
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

  listUsers() {
    return this.db.select().from(controlUsers).orderBy(desc(controlUsers.createdAt)).all();
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

  updateUser(id: string, input: { status?: string | undefined; plan?: string | undefined; displayName?: string | null | undefined }) {
    const update: {
      status?: string;
      plan?: string;
      displayName?: string | null;
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
    this.db.update(controlUsers).set(update).where(eq(controlUsers.id, id)).run();
    this.audit(id, 'user.updated', 'user', id, input);
    return this.getUserById(id);
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
      k8sNamespace: null,
      k8sPodName: null,
      routerBaseUrl: null,
      workerServiceName: null,
      s3Prefix: `${defaults.s3PrefixBase.replace(/\/$/, '')}/${userId}/${sandboxId}`,
      gatewayKeyId: null,
      lastStartedAt: null,
      lastSeenAt: null,
      idleTimeoutAt: null,
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

  updateSandboxState(
    sandboxId: string,
    input: {
      state: string;
      routerBaseUrl?: string | null;
      workerServiceName?: string | null;
      k8sNamespace?: string | null;
      k8sPodName?: string | null;
    },
  ) {
    const now = new Date().toISOString();
    this.db
      .update(controlSandboxes)
      .set({
        ...input,
        lastStartedAt: input.state === 'running' ? now : undefined,
        updatedAt: now,
      })
      .where(eq(controlSandboxes.id, sandboxId))
      .run();
    const sandbox = this.getSandboxById(sandboxId);
    if (sandbox) {
      this.audit(sandbox.userId, `sandbox.${input.state}`, 'sandbox', sandboxId, input);
    }
    return sandbox;
  }

  createWorkspace(input: {
    userId: string;
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
      sandboxId: input.sandboxId,
      name: input.name,
      slug: input.slug,
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
      slug: input.slug,
    });
    return record;
  }

  listWorkspaces(userId: string) {
    return this.db
      .select()
      .from(controlWorkspaces)
      .where(eq(controlWorkspaces.userId, userId))
      .orderBy(desc(controlWorkspaces.createdAt))
      .all();
  }

  getWorkspaceById(id: string) {
    return this.db.select().from(controlWorkspaces).where(eq(controlWorkspaces.id, id)).get();
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

  listSessionsForWorkspace(workspaceId: string) {
    return this.db
      .select()
      .from(controlSessions)
      .where(eq(controlSessions.workspaceId, workspaceId))
      .orderBy(desc(controlSessions.createdAt))
      .all();
  }

  getSessionById(id: string) {
    return this.db.select().from(controlSessions).where(eq(controlSessions.id, id)).get();
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

  getGatewayKeyForSandbox(sandboxId: string) {
    return this.db
      .select()
      .from(controlGatewayKeys)
      .where(eq(controlGatewayKeys.sandboxId, sandboxId))
      .get();
  }

  usageSummaryForUser(userId: string) {
    return this.db
      .select({
        requestCount: sql<number>`count(*)`,
        inputTokens: sql<number>`coalesce(sum(${controlUsageEvents.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${controlUsageEvents.outputTokens}), 0)`,
        cachedTokens: sql<number>`coalesce(sum(${controlUsageEvents.cachedTokens}), 0)`,
        costUsd: sql<number>`coalesce(sum(${controlUsageEvents.costUsd}), 0)`,
      })
      .from(controlUsageEvents)
      .where(eq(controlUsageEvents.userId, userId))
      .get();
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

  recordUsageEvent(input: UsageEventInput) {
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
