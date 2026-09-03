import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  runMigrations,
  seedDefaults,
  type DatabaseContext,
} from '../../../packages/db/src/index';
import type { AgentSessionDetail } from '../../../packages/agent-runtime/src/index';
import { seedAcpHistoryFixture } from './test/fixtures/acp-history-fixture';
import { ThreadDetailAssembler } from './thread-detail-assembler';
import { ThreadHistoryPersistenceCoordinator } from './thread-history-persistence-coordinator';
import { ThreadLiveStateStore } from './thread-live-state-store';
import { listThreadTurnMetadataMap } from './thread-turn-metadata';

const contexts: Array<{ directory: string; database: DatabaseContext }> = [];

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    context.database.sqlite.close();
    await fs.rm(context.directory, { recursive: true, force: true });
  }
});

describe('ACP supervisor history fixture', () => {
  it('restores missing turns, item ordering, failures, plans, and usage from SQLite', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-acp-history-'));
    const databasePath = path.join(directory, 'supervisor.sqlite');
    const workspacePath = path.join(directory, 'workspace');
    await fs.mkdir(workspacePath);
    runMigrations(databasePath);
    const database = createDatabase(databasePath);
    contexts.push({ directory, database });
    seedDefaults(database.db);
    const fixture = seedAcpHistoryFixture(database.db, workspacePath);
    const liveState = new ThreadLiveStateStore();
    let now = 1_000;
    const persistence = new ThreadHistoryPersistenceCoordinator(database.db, liveState, {
      now: () => now,
      intervalMs: 250,
      textDelta: 512,
    });
    const persisted = persistence.listPersistedHistoryItemsByTurnId(fixture.thread.id);
    expect([...persisted.keys()]).toEqual([
      'acp-history-turn-1',
      'acp-history-turn-2',
    ]);

    const remoteSession: AgentSessionDetail = {
      provider: 'acp',
      providerSessionId: fixture.thread.providerSessionId!,
      cwd: workspacePath,
      title: fixture.thread.title,
      preview: 'The second persisted ACP turn is complete.',
      createdAt: fixture.thread.createdAt,
      updatedAt: fixture.thread.updatedAt,
      status: 'idle',
      totalTurnCount: 2,
      turns: [{
        providerTurnId: 'acp-history-turn-2',
        startedAt: fixture.turns[1]!.startedAt,
        status: 'completed',
        error: null,
        items: fixture.turns[1]!.items,
      }],
    };
    persistence.persistHydratedTurns(fixture.thread.id, remoteSession.turns);
    persistence.persistHydratedTurns(fixture.thread.id, remoteSession.turns);
    expect(
      persistence.listPersistedHistoryItemsByTurnId(fixture.thread.id)
        .get('acp-history-turn-2'),
    ).toHaveLength(4);
    const assembler = new ThreadDetailAssembler({
      liveState,
      callbacks: {
        buildThreadPatch: () => ({ status: 'idle' }),
        findLocalSession: async () => null,
        listPersistedHistoryItemsByTurnId: (threadId) =>
          persistence.listPersistedHistoryItemsByTurnId(threadId),
        listPersistedHistoryItemsForTurn: (threadId, turnId) =>
          persistence.listPersistedHistoryItemsForTurn(threadId, turnId),
        listPersistedTurnSummariesByTurnId: (threadId) =>
          persistence.listPersistedTurnSummariesByTurnId(threadId),
        materializeHiddenRuntimeTurns: () => undefined,
        readRemoteSession: async () => remoteSession,
        resumeRemoteSession: async () => remoteSession,
        syncAfterRemoteSession: () => undefined,
        updateThreadRecord: () => undefined,
        getUpdatedThreadRecord: () => fixture.thread,
      },
    });
    const entry = await assembler.buildCacheEntry({
      localThreadId: fixture.thread.id,
      record: fixture.thread,
      turnMetadataById: listThreadTurnMetadataMap(database.db, fixture.thread.id),
    });

    expect(entry.turns.map((turn) => turn.id)).toEqual([
      'acp-history-turn-1',
      'acp-history-turn-2',
    ]);
    expect(entry.turns[0]).toMatchObject({
      status: 'completed',
      error: null,
      tokenUsage: {
        total: { totalTokens: 100 },
        modelContextWindow: 4096,
      },
      items: [
        { kind: 'userMessage' },
        { kind: 'reasoning' },
        { kind: 'commandExecution', status: 'failed' },
        { kind: 'plan' },
        { kind: 'agentMessage' },
      ],
    });
    expect(entry.turns[1]?.items.map((item) => item.kind)).toEqual([
      'userMessage',
      'fileRead',
      'toolCall',
      'agentMessage',
    ]);

    persistence.persistLiveHistoryItem(
      fixture.thread.id,
      'acp-final-snapshot-turn',
      {
        id: 'acp-final-snapshot-agent',
        kind: 'agentMessage',
        text: 'streamed response',
        status: 'running',
        sequence: 7,
        createdAt: '2026-09-01T04:00:07.000Z',
      },
    );
    persistence.persistHydratedTurns(fixture.thread.id, [{
      providerTurnId: 'acp-final-snapshot-turn',
      startedAt: '2026-09-01T04:00:00.000Z',
      status: 'completed',
      error: null,
      items: [{
        id: 'acp-final-snapshot-agent',
        kind: 'agentMessage',
        text: 'streamed response complete',
        status: 'completed',
      }],
    }]);
    expect(
      persistence.listPersistedHistoryItemsByTurnId(fixture.thread.id)
        .get('acp-final-snapshot-turn')?.[0],
    ).toMatchObject({
      sequence: 7,
      createdAt: '2026-09-01T04:00:07.000Z',
      status: 'completed',
    });

    persistence.checkpointLiveAgentMessage(
      fixture.thread.id,
      'acp-live-turn',
      { id: 'acp-live-agent', kind: 'agentMessage', text: 'first' },
    );
    now += 100;
    persistence.checkpointLiveAgentMessage(
      fixture.thread.id,
      'acp-live-turn',
      { id: 'acp-live-agent', kind: 'agentMessage', text: 'first second' },
    );
    expect(
      persistence.listPersistedHistoryItemsByTurnId(fixture.thread.id)
        .get('acp-live-turn'),
    ).toMatchObject([{ text: 'first' }]);
    now += 200;
    persistence.checkpointLiveAgentMessage(
      fixture.thread.id,
      'acp-live-turn',
      { id: 'acp-live-agent', kind: 'agentMessage', text: 'first second third' },
    );
    expect(
      persistence.listPersistedHistoryItemsByTurnId(fixture.thread.id)
        .get('acp-live-turn'),
    ).toMatchObject([{ text: 'first second third' }]);
  });
});
