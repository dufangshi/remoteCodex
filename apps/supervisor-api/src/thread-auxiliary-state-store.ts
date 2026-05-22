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
      createdAt: record.createdAt,
    }));
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

    for (const record of records) {
      const turn = turnsById.get(record.turnId);
      if (!turn) {
        deleteThreadPendingSteerRecordById(this.db, record.id);
        removed = true;
        continue;
      }

      const turnMessages = extractTurnUserMessages(turn);
      if (
        turnMessages.includes(record.submittedPrompt) ||
        turnMessages.includes(record.displayPrompt) ||
        turn.status !== 'inProgress'
      ) {
        deleteThreadPendingSteerRecordById(this.db, record.id);
        removed = true;
      }
    }

    if (removed) {
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
