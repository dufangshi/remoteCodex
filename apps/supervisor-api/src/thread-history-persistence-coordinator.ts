import {
  deleteThreadHistoryItemRecordsByThreadAndTurnId,
  deleteThreadTurnMetadataByThreadAndTurnId,
  getThreadTurnMetadataByThreadAndTurnId,
  listThreadHistoryItemRecordsByThreadId,
  upsertThreadHistoryItemRecord,
  upsertThreadTurnMetadata,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import type {
  ThreadHistoryItemDto,
} from '../../../packages/shared/src/index';
import type { AgentTurn } from '../../../packages/agent-runtime/src/index';
import { ThreadLiveStateStore } from './thread-live-state-store';
import {
  parseStoredHistoryItem,
  shouldPersistLiveHistoryItem,
  shouldPersistRuntimeFinalHistoryItem,
} from './thread-history-items';

export class ThreadHistoryPersistenceCoordinator {
  private readonly liveAgentMessageCheckpoints = new Map<
    string,
    { savedAt: number; textLength: number }
  >();

  constructor(
    private readonly db: DatabaseClient,
    private readonly liveState: ThreadLiveStateStore,
    private readonly checkpointOptions: {
      now?: () => number;
      intervalMs?: number;
      textDelta?: number;
    } = {},
  ) {}

  listPersistedHistoryItemsByTurnId(localThreadId: string) {
    const itemsByTurnId = new Map<string, ThreadHistoryItemDto[]>();
    for (const record of listThreadHistoryItemRecordsByThreadId(this.db, localThreadId)) {
      const item = parseStoredHistoryItem(record.itemJson);
      if (!item) {
        continue;
      }
      if (item.kind === 'agentMessage' && !item.sourceTurnId) {
        continue;
      }

      const current = itemsByTurnId.get(record.turnId) ?? [];
      current.push(item);
      itemsByTurnId.set(record.turnId, current);
    }

    return itemsByTurnId;
  }

  persistLiveHistoryItem(
    localThreadId: string,
    turnId: string,
    item: ThreadHistoryItemDto,
  ) {
    if (!shouldPersistLiveHistoryItem(item)) {
      return;
    }

    upsertThreadHistoryItemRecord(this.db, {
      threadId: localThreadId,
      turnId,
      itemId: item.id,
      itemJson: JSON.stringify(
        item.kind === 'agentMessage'
          ? { ...item, sourceTurnId: turnId }
          : item,
      ),
    });
  }

  persistProjectedHistoryItem(
    localThreadId: string,
    turnId: string,
    item: ThreadHistoryItemDto,
  ) {
    upsertThreadHistoryItemRecord(this.db, {
      threadId: localThreadId,
      turnId,
      itemId: item.id,
      itemJson: JSON.stringify(item),
    });
  }

  checkpointLiveAgentMessage(
    localThreadId: string,
    turnId: string,
    item: ThreadHistoryItemDto,
  ) {
    if (item.kind !== 'agentMessage') {
      return;
    }
    const key = `${localThreadId}\0${turnId}\0${item.id}`;
    const previous = this.liveAgentMessageCheckpoints.get(key);
    const now = (this.checkpointOptions.now ?? Date.now)();
    const intervalMs = this.checkpointOptions.intervalMs ?? 250;
    const textDelta = this.checkpointOptions.textDelta ?? 512;
    if (
      previous &&
      now - previous.savedAt < intervalMs &&
      item.text.length - previous.textLength < textDelta
    ) {
      return;
    }
    this.persistLiveHistoryItem(localThreadId, turnId, item);
    this.liveAgentMessageCheckpoints.set(key, {
      savedAt: now,
      textLength: item.text.length,
    });
  }

  clearThread(localThreadId: string) {
    const prefix = `${localThreadId}\0`;
    for (const key of this.liveAgentMessageCheckpoints.keys()) {
      if (key.startsWith(prefix)) {
        this.liveAgentMessageCheckpoints.delete(key);
      }
    }
  }

  persistHydratedTurns(localThreadId: string, turns: AgentTurn[]) {
    for (const turn of turns) {
      if (turn.startedAt) {
        upsertThreadTurnMetadata(this.db, {
          threadId: localThreadId,
          turnId: turn.providerTurnId,
          createdAt: turn.startedAt,
        });
      }
      turn.items.forEach((item, index) => {
        if (!shouldPersistRuntimeFinalHistoryItem(item)) {
          return;
        }
        const createdAt = item.createdAt ?? turn.startedAt;
        this.persistProjectedHistoryItem(
          localThreadId,
          turn.providerTurnId,
          {
            ...item,
            ...(createdAt ? { createdAt } : {}),
            sequence: item.sequence ?? index,
            ...(item.kind === 'agentMessage' && !item.sourceTurnId
              ? { sourceTurnId: turn.providerTurnId }
              : {}),
          },
        );
      });
    }
  }

  deletePersistedHistoryItemsForTurn(localThreadId: string, turnId: string) {
    deleteThreadHistoryItemRecordsByThreadAndTurnId(this.db, localThreadId, turnId);
  }

  persistFinalTurnOrderingHints(
    localThreadId: string,
    turnId: string,
    items: ThreadHistoryItemDto[],
  ) {
    this.clearTurnCheckpoints(localThreadId, turnId);
    const orderingHints = this.liveState.finalTurnAgentMessageOrderingMetadata(
      localThreadId,
      turnId,
      items,
    );

    for (const item of items) {
      if (
        item.kind !== 'agentMessage' ||
        !shouldPersistRuntimeFinalHistoryItem(item)
      ) {
        continue;
      }

      const metadata = orderingHints.get(item.id);
      if (!metadata) {
        continue;
      }

      upsertThreadHistoryItemRecord(this.db, {
        threadId: localThreadId,
        turnId,
        itemId: item.id,
        itemJson: JSON.stringify({
          ...item,
          sequence: metadata.sequence,
          createdAt: item.createdAt ?? metadata.createdAt,
          sourceTurnId: turnId,
        }),
      });
    }
  }

  private clearTurnCheckpoints(localThreadId: string, turnId: string) {
    const prefix = `${localThreadId}\0${turnId}\0`;
    for (const key of this.liveAgentMessageCheckpoints.keys()) {
      if (key.startsWith(prefix)) {
        this.liveAgentMessageCheckpoints.delete(key);
      }
    }
  }

  persistRuntimeTurnItemsAsDisplayTurn(
    localThreadId: string,
    runtimeTurnId: string,
    displayTurnId: string,
    items: ThreadHistoryItemDto[],
  ) {
    if (runtimeTurnId === displayTurnId) {
      return;
    }

    for (const item of items) {
      if (!shouldPersistRuntimeFinalHistoryItem(item)) {
        continue;
      }

      const sequence = this.liveState.recordTurnItemOrder(localThreadId, displayTurnId, item.id);
      upsertThreadHistoryItemRecord(this.db, {
        threadId: localThreadId,
        turnId: displayTurnId,
        itemId: item.id,
        itemJson: JSON.stringify({
          ...item,
          sequence,
          sourceTurnId: runtimeTurnId,
        }),
      });
    }
  }

  copyRuntimeTurnTokenUsageToDisplayTurn(
    localThreadId: string,
    runtimeTurnId: string,
    displayTurnId: string,
  ) {
    if (runtimeTurnId === displayTurnId) {
      return;
    }

    const runtimeMetadata = getThreadTurnMetadataByThreadAndTurnId(
      this.db,
      localThreadId,
      runtimeTurnId,
    );
    if (!runtimeMetadata) {
      return;
    }

    const metadataPatch: Parameters<typeof upsertThreadTurnMetadata>[1] = {
      threadId: localThreadId,
      turnId: displayTurnId,
    };
    if (runtimeMetadata.model !== null) {
      metadataPatch.model = runtimeMetadata.model;
    }
    if (runtimeMetadata.reasoningEffort !== null) {
      metadataPatch.reasoningEffort = runtimeMetadata.reasoningEffort;
    }
    if (runtimeMetadata.reasoningEffortAvailable !== null) {
      metadataPatch.reasoningEffortAvailable = runtimeMetadata.reasoningEffortAvailable;
    }
    if (runtimeMetadata.pricingModelKey !== null) {
      metadataPatch.pricingModelKey = runtimeMetadata.pricingModelKey;
    }
    if (runtimeMetadata.pricingTierKey !== null) {
      metadataPatch.pricingTierKey = runtimeMetadata.pricingTierKey;
    }
    if (runtimeMetadata.tokenUsageJson !== null) {
      metadataPatch.tokenUsageJson = runtimeMetadata.tokenUsageJson;
    }
    if (runtimeMetadata.displayPrompt !== null) {
      metadataPatch.displayPrompt = runtimeMetadata.displayPrompt;
    }
    upsertThreadTurnMetadata(this.db, metadataPatch);
    deleteThreadTurnMetadataByThreadAndTurnId(this.db, localThreadId, runtimeTurnId);
  }
}
