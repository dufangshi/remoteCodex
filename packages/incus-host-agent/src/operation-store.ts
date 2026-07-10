import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface StoredOperation<T = unknown> {
  idempotencyKeyHash: string;
  action: string;
  sandboxId: string;
  status: 'running' | 'succeeded' | 'failed';
  result?: T;
  errorCode?: string;
  updatedAt: string;
}

export class FileOperationStore {
  constructor(private readonly directory: string) {}

  async read<T>(key: string): Promise<StoredOperation<T> | null> {
    try {
      return JSON.parse(
        await fs.readFile(this.filePath(key), 'utf8'),
      ) as StoredOperation<T>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async write<T>(key: string, operation: StoredOperation<T>): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.filePath(key);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(operation), { mode: 0o600 });
    await fs.rename(temporary, target);
  }

  hash(key: string) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  private filePath(key: string) {
    return path.join(this.directory, `${this.hash(key)}.json`);
  }
}
