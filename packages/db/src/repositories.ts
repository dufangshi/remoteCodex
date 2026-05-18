import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray } from 'drizzle-orm';

import { DatabaseClient } from './client';
import { getDefaultHostRecord } from './client';
import {
  notifications,
  shellSessions,
  threadActivityNotes,
  threadForks,
  threadGoals,
  threadPendingSteers,
  threadTurnMetadata,
  threads,
  viewerSessions,
  policies,
  workspaces,
} from './schema';

export interface CreateWorkspaceRecordInput {
  absPath: string;
  label: string;
}

export interface CreateThreadRecordInput {
  workspaceId: string;
  title: string;
  model?: string | null;
  reasoningEffort?: string | null;
  fastMode?: boolean;
  fastBaseModel?: string | null;
  fastBaseReasoningEffort?: string | null;
  collaborationMode?: string;
  approvalMode: string;
  sandboxMode?: string | null;
  codexThreadId?: string | null;
  summaryText?: string | null;
  source?: 'supervisor' | 'local_codex_import';
  isConnected?: boolean;
}

export interface UpdateThreadRecordInput {
  codexThreadId?: string | null;
  codexTurnId?: string | null;
  title?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  fastMode?: boolean;
  fastBaseModel?: string | null;
  fastBaseReasoningEffort?: string | null;
  collaborationMode?: string;
  approvalMode?: string;
  sandboxMode?: string | null;
  status?: string;
  summaryText?: string | null;
  lastError?: string | null;
  lastTurnStartedAt?: string | null;
  lastTurnCompletedAt?: string | null;
  isConnected?: boolean;
  updatedAt?: string;
}

export interface UpsertThreadTurnMetadataInput {
  threadId: string;
  turnId: string;
  model?: string | null;
  reasoningEffort?: string | null;
  reasoningEffortAvailable?: boolean | null;
  pricingModelKey?: string | null;
  pricingTierKey?: string | null;
  tokenUsageJson?: string | null;
}

export interface CreateThreadPendingSteerRecordInput {
  threadId: string;
  turnId: string;
  clientRequestId?: string | null;
  displayPrompt: string;
  submittedPrompt: string;
}

export interface CreateThreadActivityNoteRecordInput {
  threadId: string;
  kind: string;
  text: string;
  anchorTurnId?: string | null;
}

export interface CreateThreadForkRecordInput {
  sourceThreadId: string;
  sourceTurnId?: string | null;
  sourceTurnIndex?: number | null;
  forkedThreadId: string;
}

export interface UpsertThreadGoalRecordInput {
  threadId: string;
  codexThreadId: string;
  localGoalId?: string | null;
  objective: string;
  status: string;
  tokenBudget?: number | null;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  startedAt: string;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateShellSessionRecordInput {
  workspaceId: string;
  threadId: string | null;
  tmuxSessionName: string;
  cwd: string;
  status: string;
}

export interface UpdateShellSessionRecordInput {
  tmuxSessionName?: string;
  cwd?: string;
  status?: string;
  updatedAt?: string;
  lastActivityAt?: string | null;
}

export interface CreateViewerSessionRecordInput {
  threadId: string | null;
  shellId: string | null;
  activeTab?: string | null;
}

export interface UpdateViewerSessionRecordInput {
  lastHeartbeatAt?: string | null;
  activeTab?: string | null;
}

export function getPolicyRecordByKey(db: DatabaseClient, key: string) {
  return db.select().from(policies).where(eq(policies.key, key)).get();
}

export function upsertPolicyRecord(db: DatabaseClient, key: string, valueJson: string) {
  const now = new Date().toISOString();
  const existing = getPolicyRecordByKey(db, key);

  if (existing) {
    db.update(policies)
      .set({
        valueJson,
        updatedAt: now
      })
      .where(eq(policies.key, key))
      .run();
    return;
  }

  db.insert(policies)
    .values({
      id: `policy-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
      key,
      valueJson,
      createdAt: now,
      updatedAt: now
    })
    .run();
}

export function listWorkspaceRecords(db: DatabaseClient) {
  return db.select().from(workspaces).orderBy(desc(workspaces.isFavorite), workspaces.label).all();
}

export function getWorkspaceRecordById(db: DatabaseClient, id: string) {
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get();
}

export function getWorkspaceRecordByPath(db: DatabaseClient, absPath: string) {
  return db.select().from(workspaces).where(eq(workspaces.absPath, absPath)).get();
}

export function createWorkspaceRecord(db: DatabaseClient, input: CreateWorkspaceRecordInput) {
  const now = new Date().toISOString();
  const host = getDefaultHostRecord();
  const record = {
    id: randomUUID(),
    hostId: host.id,
    label: input.label,
    absPath: input.absPath,
    isFavorite: false,
    createdAt: now,
    lastOpenedAt: null as string | null
  };

  db.insert(workspaces).values(record).run();

  return record;
}

export function updateWorkspaceFavorite(
  db: DatabaseClient,
  id: string,
  isFavorite: boolean
) {
  db.update(workspaces).set({ isFavorite }).where(eq(workspaces.id, id)).run();
}

export function updateWorkspaceLabel(db: DatabaseClient, id: string, label: string) {
  db.update(workspaces).set({ label }).where(eq(workspaces.id, id)).run();
}

export function touchWorkspaceOpenedAt(db: DatabaseClient, id: string) {
  db.update(workspaces)
    .set({ lastOpenedAt: new Date().toISOString() })
    .where(eq(workspaces.id, id))
    .run();
}

export function listThreadRecords(db: DatabaseClient) {
  return db.select().from(threads).orderBy(desc(threads.createdAt)).all();
}

export function listThreadRecordsByWorkspaceId(db: DatabaseClient, workspaceId: string) {
  return db.select().from(threads).where(eq(threads.workspaceId, workspaceId)).orderBy(desc(threads.createdAt)).all();
}

export function listThreadRecordsByIds(db: DatabaseClient, ids: string[]) {
  if (ids.length === 0) {
    return [];
  }

  return db.select().from(threads).where(inArray(threads.id, ids)).all();
}

export function getThreadRecordById(db: DatabaseClient, id: string) {
  return db.select().from(threads).where(eq(threads.id, id)).get();
}

export function getThreadRecordByCodexThreadId(db: DatabaseClient, codexThreadId: string) {
  return db.select().from(threads).where(eq(threads.codexThreadId, codexThreadId)).get();
}

export function createThreadRecord(db: DatabaseClient, input: CreateThreadRecordInput) {
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    codexThreadId: input.codexThreadId ?? null,
    codexTurnId: null as string | null,
    source: input.source ?? 'supervisor',
    title: input.title,
    model: input.model ?? null,
    reasoningEffort: input.reasoningEffort ?? null,
    fastMode: input.fastMode ?? false,
    fastBaseModel: input.fastBaseModel ?? null,
    fastBaseReasoningEffort: input.fastBaseReasoningEffort ?? null,
    collaborationMode: input.collaborationMode ?? 'default',
    approvalMode: input.approvalMode,
    sandboxMode: input.sandboxMode ?? null,
    status: 'idle',
    summaryText: input.summaryText ?? null,
    lastError: null as string | null,
    createdAt: now,
    updatedAt: now,
    lastTurnStartedAt: null as string | null,
    lastTurnCompletedAt: null as string | null,
    lastViewedAt: null as string | null,
    isPinned: false,
    isConnected: input.isConnected ?? true
  };

  db.insert(threads).values(record).run();
  return record;
}

export function updateThreadRecord(db: DatabaseClient, id: string, input: UpdateThreadRecordInput) {
  const updates = {
    ...input,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };

  db.update(threads).set(updates).where(eq(threads.id, id)).run();
}

export function deleteThreadRecord(db: DatabaseClient, id: string) {
  db.delete(threads).where(eq(threads.id, id)).run();
}

export function deleteThreadsByWorkspaceId(db: DatabaseClient, workspaceId: string) {
  db.delete(threads).where(eq(threads.workspaceId, workspaceId)).run();
}

export function listThreadTurnMetadataByThreadId(db: DatabaseClient, threadId: string) {
  return db.select().from(threadTurnMetadata).where(eq(threadTurnMetadata.threadId, threadId)).all();
}

export function getLatestThreadTurnMetadataByThreadId(
  db: DatabaseClient,
  threadId: string,
) {
  return db
    .select()
    .from(threadTurnMetadata)
    .where(eq(threadTurnMetadata.threadId, threadId))
    .orderBy(desc(threadTurnMetadata.createdAt))
    .get();
}

export function getThreadTurnMetadataByThreadAndTurnId(
  db: DatabaseClient,
  threadId: string,
  turnId: string,
) {
  return db
    .select()
    .from(threadTurnMetadata)
    .where(
      and(
        eq(threadTurnMetadata.threadId, threadId),
        eq(threadTurnMetadata.turnId, turnId),
      ),
    )
    .get();
}

export function upsertThreadTurnMetadata(
  db: DatabaseClient,
  input: UpsertThreadTurnMetadataInput,
) {
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(threadTurnMetadata)
    .where(
      and(
        eq(threadTurnMetadata.threadId, input.threadId),
        eq(threadTurnMetadata.turnId, input.turnId),
      ),
    )
    .get();

  if (existing) {
    db.update(threadTurnMetadata)
      .set({
        model: input.model !== undefined ? input.model : existing.model,
        reasoningEffort:
          input.reasoningEffort !== undefined
            ? input.reasoningEffort
            : existing.reasoningEffort,
        reasoningEffortAvailable:
          input.reasoningEffortAvailable !== undefined
            ? input.reasoningEffortAvailable
            : existing.reasoningEffortAvailable,
        pricingModelKey:
          input.pricingModelKey !== undefined
            ? input.pricingModelKey
            : existing.pricingModelKey,
        pricingTierKey:
          input.pricingTierKey !== undefined
            ? input.pricingTierKey
            : existing.pricingTierKey,
        tokenUsageJson:
          input.tokenUsageJson !== undefined
            ? input.tokenUsageJson
            : existing.tokenUsageJson,
        updatedAt: now,
      })
      .where(eq(threadTurnMetadata.id, existing.id))
      .run();
    return;
  }

  db.insert(threadTurnMetadata)
    .values({
      id: randomUUID(),
      threadId: input.threadId,
      turnId: input.turnId,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      reasoningEffortAvailable: input.reasoningEffortAvailable ?? null,
      pricingModelKey: input.pricingModelKey ?? null,
      pricingTierKey: input.pricingTierKey ?? null,
      tokenUsageJson: input.tokenUsageJson ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function deleteThreadTurnMetadataByThreadId(db: DatabaseClient, threadId: string) {
  db.delete(threadTurnMetadata).where(eq(threadTurnMetadata.threadId, threadId)).run();
}

export function listThreadPendingSteerRecordsByThreadId(
  db: DatabaseClient,
  threadId: string,
) {
  return db
    .select()
    .from(threadPendingSteers)
    .where(eq(threadPendingSteers.threadId, threadId))
    .orderBy(threadPendingSteers.createdAt)
    .all();
}

export function createThreadPendingSteerRecord(
  db: DatabaseClient,
  input: CreateThreadPendingSteerRecordInput,
) {
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    threadId: input.threadId,
    turnId: input.turnId,
    clientRequestId: input.clientRequestId ?? null,
    displayPrompt: input.displayPrompt,
    submittedPrompt: input.submittedPrompt,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(threadPendingSteers).values(record).run();
  return record;
}

export function deleteThreadPendingSteerRecordById(db: DatabaseClient, id: string) {
  db.delete(threadPendingSteers).where(eq(threadPendingSteers.id, id)).run();
}

export function deleteThreadPendingSteerRecordsByThreadId(
  db: DatabaseClient,
  threadId: string,
) {
  db.delete(threadPendingSteers).where(eq(threadPendingSteers.threadId, threadId)).run();
}

export function listThreadActivityNotesByThreadId(
  db: DatabaseClient,
  threadId: string,
) {
  return db
    .select()
    .from(threadActivityNotes)
    .where(eq(threadActivityNotes.threadId, threadId))
    .orderBy(threadActivityNotes.createdAt)
    .all();
}

export function createThreadActivityNoteRecord(
  db: DatabaseClient,
  input: CreateThreadActivityNoteRecordInput,
) {
  const record = {
    id: randomUUID(),
    threadId: input.threadId,
    kind: input.kind,
    text: input.text,
    anchorTurnId: input.anchorTurnId ?? null,
    createdAt: new Date().toISOString(),
  };

  db.insert(threadActivityNotes).values(record).run();
  return record;
}

export function deleteThreadActivityNotesByThreadId(
  db: DatabaseClient,
  threadId: string,
) {
  db.delete(threadActivityNotes).where(eq(threadActivityNotes.threadId, threadId)).run();
}

export function listThreadForkRecordsBySourceThreadId(
  db: DatabaseClient,
  sourceThreadId: string,
) {
  return db
    .select()
    .from(threadForks)
    .where(eq(threadForks.sourceThreadId, sourceThreadId))
    .orderBy(threadForks.createdAt)
    .all();
}

export function listThreadForkRecordsByForkedThreadId(
  db: DatabaseClient,
  forkedThreadId: string,
) {
  return db
    .select()
    .from(threadForks)
    .where(eq(threadForks.forkedThreadId, forkedThreadId))
    .orderBy(threadForks.createdAt)
    .all();
}

export function createThreadForkRecord(
  db: DatabaseClient,
  input: CreateThreadForkRecordInput,
) {
  const record = {
    id: randomUUID(),
    sourceThreadId: input.sourceThreadId,
    sourceTurnId: input.sourceTurnId ?? null,
    sourceTurnIndex: input.sourceTurnIndex ?? null,
    forkedThreadId: input.forkedThreadId,
    createdAt: new Date().toISOString(),
  };

  db.insert(threadForks).values(record).run();
  return record;
}

export function deleteThreadForkRecordsBySourceThreadId(
  db: DatabaseClient,
  sourceThreadId: string,
) {
  db.delete(threadForks).where(eq(threadForks.sourceThreadId, sourceThreadId)).run();
}

export function deleteThreadForkRecordsByForkedThreadId(
  db: DatabaseClient,
  forkedThreadId: string,
) {
  db.delete(threadForks).where(eq(threadForks.forkedThreadId, forkedThreadId)).run();
}

export function listThreadGoalRecordsByThreadId(db: DatabaseClient, threadId: string) {
  return db
    .select()
    .from(threadGoals)
    .where(eq(threadGoals.threadId, threadId))
    .orderBy(desc(threadGoals.updatedAt))
    .all();
}

export function getActiveThreadGoalRecord(db: DatabaseClient, threadId: string) {
  const records = db
    .select()
    .from(threadGoals)
    .where(eq(threadGoals.threadId, threadId))
    .orderBy(desc(threadGoals.updatedAt))
    .all();

  return records.find((record) =>
    ['active', 'paused', 'budgetLimited'].includes(record.status),
  ) ?? null;
}

function getThreadGoalRecordForUpsert(
  db: DatabaseClient,
  input: UpsertThreadGoalRecordInput,
) {
  if (input.localGoalId) {
    const byId = db
      .select()
      .from(threadGoals)
      .where(eq(threadGoals.id, input.localGoalId))
      .get();
    if (byId?.threadId === input.threadId) {
      return byId;
    }
  }

  const active = getActiveThreadGoalRecord(db, input.threadId);
  if (active) {
    return active;
  }

  const matchingObjective = db
    .select()
    .from(threadGoals)
    .where(
      and(
        eq(threadGoals.threadId, input.threadId),
        eq(threadGoals.codexThreadId, input.codexThreadId),
        eq(threadGoals.objective, input.objective),
      ),
    )
    .orderBy(desc(threadGoals.updatedAt))
    .get();
  if (matchingObjective) {
    return matchingObjective;
  }

  return (
    db
      .select()
      .from(threadGoals)
      .where(
        and(
          eq(threadGoals.threadId, input.threadId),
          eq(threadGoals.codexThreadId, input.codexThreadId),
          eq(threadGoals.objective, input.objective),
          eq(threadGoals.createdAt, input.createdAt ?? input.startedAt),
        ),
      )
      .orderBy(desc(threadGoals.updatedAt))
      .get() ?? null
  );
}

export function upsertThreadGoalRecord(
  db: DatabaseClient,
  input: UpsertThreadGoalRecordInput,
) {
  const now = new Date().toISOString();
  const existing = getThreadGoalRecordForUpsert(db, input);
  const terminalCompletedAt =
    input.completedAt ??
    (['complete', 'terminated'].includes(input.status)
        ? input.updatedAt ?? now
        : null);

  if (existing) {
    const updated = {
      objective: input.objective,
      status: input.status,
      tokenBudget: input.tokenBudget ?? null,
      tokensUsed: input.tokensUsed ?? existing.tokensUsed,
      timeUsedSeconds: input.timeUsedSeconds ?? existing.timeUsedSeconds,
      codexThreadId: input.codexThreadId,
      startedAt: input.startedAt,
      completedAt: terminalCompletedAt,
      updatedAt: input.updatedAt ?? now,
    };
    db.update(threadGoals).set(updated).where(eq(threadGoals.id, existing.id)).run();
    return { ...existing, ...updated };
  }

  const record = {
    id: randomUUID(),
    threadId: input.threadId,
    codexThreadId: input.codexThreadId,
    objective: input.objective,
    status: input.status,
    tokenBudget: input.tokenBudget ?? null,
    tokensUsed: input.tokensUsed ?? 0,
    timeUsedSeconds: input.timeUsedSeconds ?? 0,
    startedAt: input.startedAt,
    completedAt: terminalCompletedAt,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  db.insert(threadGoals).values(record).run();
  return record;
}

export function markActiveThreadGoalRecordTerminated(
  db: DatabaseClient,
  threadId: string,
) {
  const existing = getActiveThreadGoalRecord(db, threadId);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const updates = {
    status: 'terminated',
    completedAt: now,
    updatedAt: now,
  };
  db.update(threadGoals).set(updates).where(eq(threadGoals.id, existing.id)).run();
  return { ...existing, ...updates };
}

export function deleteThreadGoalRecordsByThreadId(db: DatabaseClient, threadId: string) {
  db.delete(threadGoals).where(eq(threadGoals.threadId, threadId)).run();
}

export function listShellSessionRecords(db: DatabaseClient) {
  return db.select().from(shellSessions).orderBy(desc(shellSessions.updatedAt)).all();
}

export function listShellSessionRecordsByWorkspaceId(db: DatabaseClient, workspaceId: string) {
  return db
    .select()
    .from(shellSessions)
    .where(eq(shellSessions.workspaceId, workspaceId))
    .orderBy(desc(shellSessions.updatedAt))
    .all();
}

export function getShellSessionRecordById(db: DatabaseClient, id: string) {
  return db.select().from(shellSessions).where(eq(shellSessions.id, id)).get();
}

export function getShellSessionRecordByThreadId(db: DatabaseClient, threadId: string) {
  return db.select().from(shellSessions).where(eq(shellSessions.threadId, threadId)).get();
}

export function createShellSessionRecord(
  db: DatabaseClient,
  input: CreateShellSessionRecordInput,
) {
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    tmuxSessionName: input.tmuxSessionName,
    cwd: input.cwd,
    status: input.status,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  };

  db.insert(shellSessions).values(record).run();
  return record;
}

export function updateShellSessionRecord(
  db: DatabaseClient,
  id: string,
  input: UpdateShellSessionRecordInput,
) {
  const updates = {
    ...input,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };

  db.update(shellSessions).set(updates).where(eq(shellSessions.id, id)).run();
}

export function deleteShellSessionRecord(db: DatabaseClient, id: string) {
  db.delete(shellSessions).where(eq(shellSessions.id, id)).run();
}

export function deleteShellSessionsByThreadId(db: DatabaseClient, threadId: string) {
  db.delete(shellSessions).where(eq(shellSessions.threadId, threadId)).run();
}

export function deleteShellSessionsByWorkspaceId(db: DatabaseClient, workspaceId: string) {
  db.delete(shellSessions).where(eq(shellSessions.workspaceId, workspaceId)).run();
}

export function createViewerSessionRecord(
  db: DatabaseClient,
  input: CreateViewerSessionRecordInput,
) {
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    threadId: input.threadId ?? null,
    shellId: input.shellId ?? null,
    connectedAt: now,
    lastHeartbeatAt: now,
    activeTab: input.activeTab ?? null,
  };

  db.insert(viewerSessions).values(record).run();
  return record;
}

export function getViewerSessionRecordById(db: DatabaseClient, id: string) {
  return db.select().from(viewerSessions).where(eq(viewerSessions.id, id)).get();
}

export function getViewerSessionRecordByShellId(db: DatabaseClient, shellId: string) {
  return db.select().from(viewerSessions).where(eq(viewerSessions.shellId, shellId)).get();
}

export function updateViewerSessionRecord(
  db: DatabaseClient,
  id: string,
  input: UpdateViewerSessionRecordInput,
) {
  db.update(viewerSessions)
    .set(input)
    .where(eq(viewerSessions.id, id))
    .run();
}

export function clearViewerSessionShell(db: DatabaseClient, id: string) {
  db.update(viewerSessions)
    .set({
      shellId: null,
      lastHeartbeatAt: new Date().toISOString(),
      activeTab: null,
    })
    .where(eq(viewerSessions.id, id))
    .run();
}

export function deleteViewerSessionRecord(db: DatabaseClient, id: string) {
  db.delete(viewerSessions).where(eq(viewerSessions.id, id)).run();
}

export function deleteViewerSessionsByShellId(db: DatabaseClient, shellId: string) {
  db.delete(viewerSessions).where(eq(viewerSessions.shellId, shellId)).run();
}

export function deleteViewerSessionsByThreadId(db: DatabaseClient, threadId: string) {
  db.delete(viewerSessions).where(eq(viewerSessions.threadId, threadId)).run();
}

export function deleteAllViewerSessionRecords(db: DatabaseClient) {
  db.delete(viewerSessions).run();
}

export function deleteNotificationsByThreadId(db: DatabaseClient, threadId: string) {
  db.delete(notifications).where(eq(notifications.threadId, threadId)).run();
}

export function deleteWorkspaceRecord(db: DatabaseClient, id: string) {
  db.delete(workspaces).where(eq(workspaces.id, id)).run();
}
