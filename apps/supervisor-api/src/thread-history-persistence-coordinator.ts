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
import { ThreadLiveStateStore } from './thread-live-state-store';
import {
  parseStoredHistoryItem,
  shouldPersistLiveHistoryItem,
  shouldPersistRuntimeFinalHistoryItem,
} from './thread-history-items';

export class ThreadHistoryPersistenceCoordinator {
  constructor(
    private readonly db: DatabaseClient,
    private readonly liveState: ThreadLiveStateStore,
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
      itemJson: JSON.stringify(item),
    });
  }

  deletePersistedHistoryItemsForTurn(localThreadId: string, turnId: string) {
    deleteThreadHistoryItemRecordsByThreadAndTurnId(this.db, localThreadId, turnId);
  }

  persistFinalTurnOrderingHints(
    localThreadId: string,
    turnId: string,
    items: ThreadHistoryItemDto[],
  ) {
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

    upsertThreadTurnMetadata(this.db, {
      threadId: localThreadId,
      turnId: displayTurnId,
      model: runtimeMetadata.model ?? null,
      reasoningEffort: runtimeMetadata.reasoningEffort ?? null,
      reasoningEffortAvailable: runtimeMetadata.reasoningEffortAvailable ?? null,
      pricingModelKey: runtimeMetadata.pricingModelKey ?? null,
      pricingTierKey: runtimeMetadata.pricingTierKey ?? null,
      tokenUsageJson: runtimeMetadata.tokenUsageJson ?? null,
    });
    deleteThreadTurnMetadataByThreadAndTurnId(this.db, localThreadId, runtimeTurnId);
  }
}
