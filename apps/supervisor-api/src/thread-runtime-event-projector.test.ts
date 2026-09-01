import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDatabase,
  createThreadRecord,
  createWorkspaceRecord,
  runMigrations,
  seedDefaults,
  type DatabaseContext,
} from '../../../packages/db/src/index';
import { ThreadHistoryPersistenceCoordinator } from './thread-history-persistence-coordinator';
import { ThreadLiveStateStore } from './thread-live-state-store';
import {
  ThreadRuntimeEventProjector,
  type ThreadRuntimeEventProjectorCallbacks,
} from './thread-runtime-event-projector';
import { ThreadUsageAccounting } from './thread-usage-accounting';

const contexts: Array<{ directory: string; database: DatabaseContext }> = [];

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    context.database.sqlite.close();
    await fs.rm(context.directory, { recursive: true, force: true });
  }
});

describe('ThreadRuntimeEventProjector harness extensions', () => {
  it('persists extension events through the standard thread item journal', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-extension-event-'));
    const databasePath = path.join(directory, 'supervisor.sqlite');
    const workspacePath = path.join(directory, 'workspace');
    await fs.mkdir(workspacePath);
    runMigrations(databasePath);
    const database = createDatabase(databasePath);
    contexts.push({ directory, database });
    seedDefaults(database.db);
    const workspace = createWorkspaceRecord(database.db, {
      label: 'Extension event fixture',
      absPath: workspacePath,
    });
    const thread = createThreadRecord(database.db, {
      workspaceId: workspace.id,
      provider: 'acp',
      agentId: 'fixture-agent',
      providerSessionId: 'fixture-agent::session-1',
      title: 'Extension event fixture',
      model: 'fixture-model',
      approvalMode: 'yolo',
    });
    const liveState = new ThreadLiveStateStore();
    const persistence = new ThreadHistoryPersistenceCoordinator(database.db, liveState);
    const emitThreadEvent = vi.fn();
    const callbacks = {
      persistLiveHistoryItem: (
        localThreadId: string,
        turnId: string,
        item: any,
      ) => persistence.persistLiveHistoryItem(localThreadId, turnId, item),
      invalidateThreadDetailCache: vi.fn(),
      emitThreadEvent,
    } as unknown as ThreadRuntimeEventProjectorCallbacks;
    const projector = new ThreadRuntimeEventProjector({
      db: database.db,
      liveState,
      usageAccounting: new ThreadUsageAccounting(database.db),
      callbacks,
    });

    await projector.handleRuntimeEvent({
      type: 'harness.extension',
      provider: 'acp',
      providerSessionId: thread.providerSessionId!,
      providerTurnId: 'turn-1',
      providerItemId: 'extension-checkpoint-1',
      extensionId: 'fixture.session',
      extensionVersion: 1,
      event: 'checkpoint',
      operationId: 'operation-1',
      sequence: 1,
      payload: { sensitiveDetailNotPersisted: 'value' },
    });

    expect(persistence.listPersistedHistoryItemsByTurnId(thread.id)).toMatchObject(
      new Map([['turn-1', [{
        id: 'extension-checkpoint-1',
        kind: 'other',
        text: 'fixture.session: checkpoint',
        status: 'completed',
      }]]]),
    );
    expect(emitThreadEvent).toHaveBeenCalledWith(
      'thread.item.completed',
      thread.id,
      expect.objectContaining({
        turnId: 'turn-1',
        item: expect.objectContaining({ id: 'extension-checkpoint-1' }),
      }),
    );
    const stored = persistence
      .listPersistedHistoryItemsByTurnId(thread.id)
      .get('turn-1')?.[0];
    expect(JSON.stringify(stored)).not.toContain('sensitiveDetailNotPersisted');
  });
});
