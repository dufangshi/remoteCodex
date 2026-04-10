import { randomUUID } from 'node:crypto';

import { desc, eq, inArray } from 'drizzle-orm';

import { DatabaseClient } from './client';
import { getDefaultHostRecord } from './client';
import { threads, workspaces } from './schema';

export interface CreateWorkspaceRecordInput {
  absPath: string;
  label: string;
}

export interface CreateThreadRecordInput {
  workspaceId: string;
  title: string;
  model?: string | null;
  approvalMode: string;
  codexThreadId?: string | null;
  summaryText?: string | null;
  source?: 'supervisor' | 'local_codex_import';
}

export interface UpdateThreadRecordInput {
  codexThreadId?: string | null;
  codexTurnId?: string | null;
  title?: string;
  model?: string | null;
  approvalMode?: string;
  status?: string;
  summaryText?: string | null;
  lastError?: string | null;
  lastTurnStartedAt?: string | null;
  lastTurnCompletedAt?: string | null;
  updatedAt?: string;
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

export function touchWorkspaceOpenedAt(db: DatabaseClient, id: string) {
  db.update(workspaces)
    .set({ lastOpenedAt: new Date().toISOString() })
    .where(eq(workspaces.id, id))
    .run();
}

export function listThreadRecords(db: DatabaseClient) {
  return db.select().from(threads).orderBy(desc(threads.createdAt)).all();
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
    approvalMode: input.approvalMode,
    status: 'idle',
    summaryText: input.summaryText ?? null,
    lastError: null as string | null,
    createdAt: now,
    updatedAt: now,
    lastTurnStartedAt: null as string | null,
    lastTurnCompletedAt: null as string | null,
    lastViewedAt: null as string | null,
    isPinned: false
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
