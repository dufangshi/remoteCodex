import type { AgentTurn } from '../../../packages/agent-runtime/src/index';
import {
  createThreadActivityNoteRecord,
  deleteThreadPendingSteerRecordById,
  getLatestThreadTurnMetadataByThreadId,
  getThreadRecordById,
  listThreadActivityNotesByThreadId,
  listThreadForkRecordsByForkedThreadId,
  listThreadForkRecordsBySourceThreadId,
  listThreadPendingSteerRecordsByThreadId,
  upsertThreadHistoryItemRecord,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import type {
  ThreadActivityNoteDto,
  ThreadAnsweredRequestNoteDto,
  ThreadPendingSteerDto,
  ThreadTurnDto,
} from '../../../packages/shared/src/index';

interface ThreadAuxiliaryStateStoreCallbacks {
  cachedTurns(localThreadId: string): ThreadTurnDto[];
  emitPendingSteerUpdated(localThreadId: string, turnId?: string): void;
  invalidateThreadDetailCache(localThreadId: string): void;
  shouldPreserveCompletedPendingSteer?(localThreadId: string, turnId: string): boolean;
  shouldPreserveMissingPendingSteer?(localThreadId: string, turnId: string): boolean;
}

export class ThreadAuxiliaryStateStore {
  private readonly answeredRequestNotes = new Map<string, ThreadAnsweredRequestNoteDto[]>();

  constructor(
    private readonly db: DatabaseClient,
    private readonly callbacks: ThreadAuxiliaryStateStoreCallbacks,
  ) {}

  clearThread(localThreadId: string) {
    this.answeredRequestNotes.delete(localThreadId);
  }

  listAnsweredRequestNotes(localThreadId: string): ThreadAnsweredRequestNoteDto[] {
    return [...(this.answeredRequestNotes.get(localThreadId) ?? [])];
  }

  appendAnsweredRequestNote(
    localThreadId: string,
    note: ThreadAnsweredRequestNoteDto | null,
  ) {
    if (!note) {
      return;
    }

    const current = this.answeredRequestNotes.get(localThreadId) ?? [];
    const next = [...current.filter((entry) => entry.id !== note.id), note];
    this.answeredRequestNotes.set(localThreadId, next.slice(-16));
  }

  listActivityNotes(localThreadId: string): ThreadActivityNoteDto[] {
    const cachedTurns = this.callbacks.cachedTurns(localThreadId);
    const notes: ThreadActivityNoteDto[] = listThreadActivityNotesByThreadId(
      this.db,
      localThreadId,
    ).map((record) => {
      const fallbackAnchor = [...cachedTurns]
        .reverse()
        .find(
          (turn) =>
            turn.startedAt &&
            turn.startedAt.localeCompare(record.createdAt) <= 0,
        );
      return {
        id: record.id,
        kind: 'fastMode',
        text: record.text,
        createdAt: record.createdAt,
        anchorTurnId: record.anchorTurnId ?? fallbackAnchor?.id ?? null,
      };
    });

    for (const record of listThreadForkRecordsBySourceThreadId(this.db, localThreadId)) {
      const forkedThread = getThreadRecordById(this.db, record.forkedThreadId);
      notes.push({
        id: `fork-created:${record.id}`,
        kind: 'forkCreated',
        createdAt: record.createdAt,
        anchorTurnId: record.sourceTurnId ?? null,
        linkedThreadId: record.forkedThreadId,
        linkedThreadTitle: forkedThread?.title ?? null,
        turnIndex: record.sourceTurnIndex ?? null,
      });
    }

    for (const record of listThreadForkRecordsByForkedThreadId(this.db, localThreadId)) {
      const sourceThread = getThreadRecordById(this.db, record.sourceThreadId);
      notes.push({
        id: `fork-source:${record.id}`,
        kind: 'forkSource',
        createdAt: record.createdAt,
        anchorTurnId: '__leading__',
        linkedThreadId: record.sourceThreadId,
        linkedThreadTitle: sourceThread?.title ?? null,
        turnIndex: record.sourceTurnIndex ?? null,
      });
    }

    return notes.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  appendActivityNote(
    localThreadId: string,
    input: { kind: 'fastMode'; text: string },
  ) {
    const cachedAnchorTurnId =
      this.callbacks.cachedTurns(localThreadId).at(-1)?.id ?? null;
    const metadataAnchorTurnId =
      getLatestThreadTurnMetadataByThreadId(this.db, localThreadId)?.turnId ?? null;
    createThreadActivityNoteRecord(this.db, {
      threadId: localThreadId,
      kind: input.kind,
      text: input.text,
      anchorTurnId: cachedAnchorTurnId ?? metadataAnchorTurnId,
    });
  }

  listPendingSteers(localThreadId: string): ThreadPendingSteerDto[] {
    return listThreadPendingSteerRecordsByThreadId(this.db, localThreadId).map((record) => ({
      id: record.id,
      clientRequestId: record.clientRequestId ?? null,
      turnId: record.turnId,
      prompt: record.displayPrompt,
      delivery: record.delivery === 'continuation' ? 'continuation' : 'steer',
      createdAt: record.createdAt,
    }));
  }

  listPendingSteerRecordsForTurn(localThreadId: string, turnId: string) {
    return listThreadPendingSteerRecordsByThreadId(this.db, localThreadId).filter(
      (record) => record.turnId === turnId,
    );
  }

  listQueuedContinuationRecords(localThreadId: string) {
    return listThreadPendingSteerRecordsByThreadId(this.db, localThreadId).filter(
      (record) => record.delivery === 'continuation',
    );
  }

  findPendingSteerRecord(localThreadId: string, id: string) {
    return listThreadPendingSteerRecordsByThreadId(this.db, localThreadId).find(
      (record) => record.id === id,
    ) ?? null;
  }

  hasPendingSteersForTurn(localThreadId: string, turnId: string) {
    return this.listPendingSteerRecordsForTurn(localThreadId, turnId).length > 0;
  }

  hasQueuedContinuationsForTurn(localThreadId: string, turnId: string) {
    return this.listPendingSteerRecordsForTurn(localThreadId, turnId).some(
      (record) => record.delivery === 'continuation',
    );
  }

  hasQueuedContinuations(localThreadId: string) {
    return this.listQueuedContinuationRecords(localThreadId).length > 0;
  }

  deletePendingSteerRecord(localThreadId: string, id: string, turnId?: string) {
    deleteThreadPendingSteerRecordById(this.db, id);
    this.callbacks.invalidateThreadDetailCache(localThreadId);
    this.callbacks.emitPendingSteerUpdated(localThreadId, turnId);
  }

  clearPendingSteersForTurn(localThreadId: string, turnId: string) {
    const records = listThreadPendingSteerRecordsByThreadId(this.db, localThreadId).filter(
      (record) => record.turnId === turnId,
    );
    if (records.length === 0) {
      return;
    }

    for (const record of records) {
      deleteThreadPendingSteerRecordById(this.db, record.id);
    }

    this.callbacks.invalidateThreadDetailCache(localThreadId);
    this.callbacks.emitPendingSteerUpdated(localThreadId, turnId);
  }

  reconcilePendingSteers(localThreadId: string, remoteSession: { turns: AgentTurn[] }) {
    const records = listThreadPendingSteerRecordsByThreadId(this.db, localThreadId);
    if (records.length === 0) {
      return;
    }

    const turnsById = new Map(
      remoteSession.turns.map((turn) => [turn.providerTurnId, turn]),
    );
    let removed = false;
    let persistedDisplayPrompt = false;
    const localImageUserItemCursorByTurnId = new Map<string, number>();
    const photoPendingSteerCountByTurnId = new Map<string, number>();
    for (const record of records) {
      if (!/\[PHOTO\s+[^\]]+\]/.test(record.displayPrompt)) {
        continue;
      }
      photoPendingSteerCountByTurnId.set(
        record.turnId,
        (photoPendingSteerCountByTurnId.get(record.turnId) ?? 0) + 1,
      );
    }

    for (const record of records) {
      const turn = turnsById.get(record.turnId);
      if (!turn) {
        if (this.callbacks.shouldPreserveMissingPendingSteer?.(localThreadId, record.turnId)) {
          continue;
        }
        deleteThreadPendingSteerRecordById(this.db, record.id);
        removed = true;
        continue;
      }

      const turnMessages = extractTurnUserMessages(turn);
      const persistedLocalImagePrompt = persistPendingSteerDisplayPrompt({
        db: this.db,
        localThreadId,
        record,
        turn,
        cursorByTurnId: localImageUserItemCursorByTurnId,
        pendingSteerCount:
          photoPendingSteerCountByTurnId.get(record.turnId) ?? 0,
      });
      persistedDisplayPrompt = persistedDisplayPrompt || persistedLocalImagePrompt;
      if (
        turnMessages.includes(record.submittedPrompt) ||
        turnMessages.includes(record.displayPrompt) ||
        persistedLocalImagePrompt ||
        (
          turn.status !== 'inProgress' &&
          !this.callbacks.shouldPreserveCompletedPendingSteer?.(localThreadId, record.turnId)
        )
      ) {
        deleteThreadPendingSteerRecordById(this.db, record.id);
        removed = true;
      }
    }

    if (removed || persistedDisplayPrompt) {
      this.callbacks.invalidateThreadDetailCache(localThreadId);
      this.callbacks.emitPendingSteerUpdated(localThreadId);
    }
  }
}

function extractTurnUserMessages(turn: AgentTurn) {
  return turn.items
    .filter((item) => item.kind === 'userMessage')
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0);
}

function persistPendingSteerDisplayPrompt(input: {
  db: DatabaseClient;
  localThreadId: string;
  record: {
    turnId: string;
    displayPrompt: string;
  };
  turn: AgentTurn;
  cursorByTurnId: Map<string, number>;
  pendingSteerCount: number;
}) {
  if (!/\[PHOTO\s+[^\]]+\]/.test(input.record.displayPrompt)) {
    return false;
  }

  const localImageUserItems = input.turn.items.filter(
    (item) =>
      item.kind === 'userMessage' &&
      /\[localImage\]/.test(item.text) &&
      item.text.trim() !== input.record.displayPrompt.trim(),
  );
  if (localImageUserItems.length === 0) {
    return false;
  }

  const cursor = input.cursorByTurnId.get(input.record.turnId) ?? 0;
  const firstPendingSteerItemIndex = Math.max(
    0,
    localImageUserItems.length - input.pendingSteerCount,
  );
  const item = localImageUserItems[firstPendingSteerItemIndex + cursor];
  if (!item) {
    return false;
  }

  input.cursorByTurnId.set(input.record.turnId, cursor + 1);
  upsertThreadHistoryItemRecord(input.db, {
    threadId: input.localThreadId,
    turnId: input.record.turnId,
    itemId: item.id,
    itemJson: JSON.stringify({
      ...item,
      text: input.record.displayPrompt,
    }),
  });
  return true;
}
