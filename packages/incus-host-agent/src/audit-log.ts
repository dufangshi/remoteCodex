import fs from 'node:fs/promises';
import path from 'node:path';

export interface AuditEvent {
  requestId: string;
  action: string;
  sandboxId?: string;
  outcome: 'started' | 'succeeded' | 'failed';
  errorCode?: string;
}

export interface AuditLogger {
  write(event: AuditEvent): Promise<void>;
}

export class JsonFileAuditLogger implements AuditLogger {
  constructor(private readonly filePath: string) {}

  async write(event: AuditEvent): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), {
      recursive: true,
      mode: 0o700,
    });
    await fs.appendFile(
      this.filePath,
      `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    );
  }
}
