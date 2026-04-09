import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';

export type DatabaseClient = ReturnType<typeof drizzle<typeof schema>>;
export type SqliteDatabase = Database.Database;

export interface DatabaseContext {
  sqlite: SqliteDatabase;
  db: DatabaseClient;
}

function resolvePlatform(): string {
  if (process.platform === 'darwin') {
    return 'macos';
  }

  if (process.platform === 'linux') {
    return os.release().toLowerCase().includes('microsoft') ? 'wsl-ubuntu' : 'linux';
  }

  return process.platform;
}

export function createDatabase(databaseUrl: string): DatabaseContext {
  fs.mkdirSync(path.dirname(databaseUrl), { recursive: true });

  const sqlite = new Database(databaseUrl);
  sqlite.pragma('journal_mode = WAL');

  return {
    sqlite,
    db: drizzle(sqlite, { schema })
  };
}

export function getDefaultHostRecord() {
  const now = new Date().toISOString();

  return {
    id: 'local-host',
    hostname: os.hostname(),
    platform: resolvePlatform(),
    tailscaleName: null as string | null,
    createdAt: now,
    lastSeenAt: now
  };
}
