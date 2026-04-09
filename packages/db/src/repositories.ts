import { randomUUID } from 'node:crypto';

import { desc, eq } from 'drizzle-orm';

import { DatabaseClient } from './client';
import { getDefaultHostRecord } from './client';
import { workspaces } from './schema';

export interface CreateWorkspaceRecordInput {
  absPath: string;
  label: string;
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
