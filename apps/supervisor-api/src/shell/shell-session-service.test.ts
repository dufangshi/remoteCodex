import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDatabase,
  createThreadRecord,
  createWorkspaceRecord,
  runMigrations,
  seedDefaults,
} from '../../../../packages/db/src/index';
import { SupervisorEventBus } from '../codex/event-bus';
import { ShellServiceError, ShellSessionService } from './shell-session-service';

describe('ShellSessionService', () => {
  let tempDir = '';
  let databasePath = '';
  let context: ReturnType<typeof createDatabase>;
  let workspacePath = '';
  let service: ShellSessionService;
  let sessionNames: Set<string>;
  let sentInputs: string[];
  let resizeCalls: Array<{ sessionName: string; cols: number; rows: number }>;
  let threadId = '';

  beforeEach(async () => {
    vi.useFakeTimers();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-shell-'));
    databasePath = path.join(tempDir, 'test.sqlite');
    workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });

    runMigrations(databasePath);
    context = createDatabase(databasePath);
    seedDefaults(context.db);
    sessionNames = new Set<string>();
    sentInputs = [];
    resizeCalls = [];

    const workspace = createWorkspaceRecord(context.db, {
      absPath: workspacePath,
      label: 'workspace',
    });
    const thread = createThreadRecord(context.db, {
      workspaceId: workspace.id,
      title: 'Shell thread',
      model: 'gpt-5',
      approvalMode: 'yolo',
    });
    threadId = thread.id;

    service = new ShellSessionService(
      context.db,
      new SupervisorEventBus(),
      {
        sessionNameForThread(id: string) {
          return `rcx-${id.slice(0, 8)}`;
        },
        async listSessionNames() {
          return [...sessionNames];
        },
        async hasSession(sessionName: string) {
          return sessionNames.has(sessionName);
        },
        async createSession(input: { sessionName: string }) {
          sessionNames.add(input.sessionName);
        },
        async resizeWindow(sessionName: string, cols: number, rows: number) {
          resizeCalls.push({ sessionName, cols, rows });
        },
        async sendInput(_sessionName: string, data: string) {
          sentInputs.push(data);
        },
        async capturePane() {
          return '(base) shell test % ';
        },
        async killSession(sessionName: string) {
          sessionNames.delete(sessionName);
        },
      } as any,
    );
  });

  afterEach(async () => {
    await service.stop();
    vi.useRealTimers();
    context.sqlite.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates a shell explicitly and exposes it as detached', async () => {
    const state = await service.createShellForThread(threadId, {
      cols: 100,
      rows: 30,
    });

    expect(state.state).toBe('detached');
    expect(state.shell).toMatchObject({
      threadId,
      cwd: workspacePath,
      status: 'detached',
    });
    expect(sessionNames.size).toBe(1);
  });

  it('allows a single attached viewer and keeps the shell alive after detach', async () => {
    const created = await service.createShellForThread(threadId);
    const shellId = created.shell?.id;
    expect(shellId).toBeTruthy();

    const firstAttachment = await service.attachShell(shellId!, {
      cols: 120,
      rows: 36,
      onData: () => {},
    });

    await expect(
      service.attachShell(shellId!, {
        cols: 120,
        rows: 36,
        onData: () => {},
      }),
    ).rejects.toMatchObject({
      code: 'viewer_conflict',
    } satisfies Partial<ShellServiceError>);

    await service.sendInput(shellId!, firstAttachment.viewerId, 'pwd\n');
    expect(sentInputs).toContain('pwd\n');
    expect(resizeCalls).toContainEqual({
      sessionName: expect.stringContaining('rcx-'),
      cols: 120,
      rows: 36,
    });

    await service.detachShell(shellId!, firstAttachment.viewerId);
    const stateAfterDetach = await service.getThreadShellState(threadId);

    expect(stateAfterDetach.state).toBe('detached');
    expect(sessionNames.size).toBe(1);
  });
});
