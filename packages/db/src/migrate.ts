import fs from 'node:fs';
import path from 'node:path';
import { loadRuntimeConfig } from '../../config/src/index';
import { createDatabase } from './client';

interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
}

function resolveRepoRoot(start = process.cwd()): string {
  let current = path.resolve(start);

  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    current = path.dirname(current);
  }

  throw new Error('Unable to locate repository root from current working directory.');
}

export function getMigrationsDir(): string {
  return path.join(resolveRepoRoot(), 'packages', 'db', 'migrations');
}

export function runMigrations(databaseUrl: string) {
  const { sqlite } = createDatabase(databaseUrl);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = sqlite
    .prepare('SELECT name, applied_at, id FROM __migrations ORDER BY id ASC')
    .all() as MigrationRecord[];
  const appliedNames = new Set(applied.map((item) => item.name));

  const migrations = fs
    .readdirSync(getMigrationsDir())
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const migration of migrations) {
    if (appliedNames.has(migration)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(getMigrationsDir(), migration), 'utf8');
    sqlite.exec(sql);
    sqlite
      .prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)')
      .run(migration, new Date().toISOString());
  }

  sqlite.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (fs.existsSync('.env')) {
    process.loadEnvFile?.('.env');
  }
  const config = loadRuntimeConfig();
  runMigrations(config.databaseUrl);
}
