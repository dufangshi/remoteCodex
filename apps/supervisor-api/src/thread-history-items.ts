import type { AgentTurn } from '../../../packages/agent-runtime/src/index';
import type {
  ThreadHistoryItemDetailDto,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../../packages/shared/src/index';

const DEFERRED_COMMAND_DETAIL_TITLE = 'Command Output';
const DEFERRED_TOOL_DETAIL_TITLE = 'Tool Call Details';

export type TurnItemOrderSnapshot = Map<string, Map<string, number>>;

function parseUuidV7Timestamp(id: string): string | null {
  const normalized = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(normalized) || normalized[12]?.toLowerCase() !== '7') {
    return null;
  }

  const millis = Number.parseInt(normalized.slice(0, 12), 16);
  if (!Number.isFinite(millis)) {
    return null;
  }

  return new Date(millis).toISOString();
}

function summarizeText(text: string, fallback: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 1 && lines.at(-1)?.trim() === '') {
    lines.pop();
  }
  return lines.find((line) => line.trim().length > 0) ?? lines[0] ?? fallback;
}

function deferCommandHistoryItem(
  item: ThreadHistoryItemDto & { kind: 'commandExecution' },
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const fullText = item.detailText?.trim() || item.text || 'Command output';
  deferredDetails.set(item.id, {
    id: item.id,
    kind: item.kind,
    title: DEFERRED_COMMAND_DETAIL_TITLE,
    text: fullText,
  });

  return {
    ...item,
    text: summarizeText(fullText, 'Command output'),
    detailText: null,
    hasDeferredDetail: true,
  };
}

function deferToolCallHistoryItem(
  item: ThreadHistoryItemDto & { kind: 'toolCall' },
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const fullText = item.detailText?.trim() || item.text || 'Tool call';
  deferredDetails.set(item.id, {
    id: item.id,
    kind: item.kind,
    title: DEFERRED_TOOL_DETAIL_TITLE,
    text: fullText,
  });

  return {
    ...item,
    text: summarizeText(fullText, 'Tool call'),
    detailText: null,
    hasDeferredDetail: true,
  };
}

export function deferLargeHistoryItemDetails(
  turn: ThreadTurnDto,
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadTurnDto {
  return {
    ...turn,
    items: turn.items.map((item) =>
      item.kind === 'commandExecution'
        ? deferCommandHistoryItem(
            item as ThreadHistoryItemDto & { kind: 'commandExecution' },
            deferredDetails,
          )
        : item.kind === 'toolCall'
          ? deferToolCallHistoryItem(
              item as ThreadHistoryItemDto & { kind: 'toolCall' },
              deferredDetails,
            )
        : item,
    ),
  };
}

export function shouldPersistLiveHistoryItem(item: ThreadHistoryItemDto) {
  return (
    item.kind === 'commandExecution' ||
    item.kind === 'fileChange' ||
    item.kind === 'hook' ||
    item.kind === 'toolCall' ||
    item.kind === 'webSearch'
  );
}

export function parseStoredHistoryItem(value: string): ThreadHistoryItemDto | null {
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.id === 'string' &&
      typeof parsed.kind === 'string' &&
      typeof parsed.text === 'string'
    ) {
      return parsed as ThreadHistoryItemDto;
    }
  } catch {
    return null;
  }

  return null;
}

function hasHistoryItemSequence(item: ThreadHistoryItemDto) {
  return typeof item.sequence === 'number' && Number.isFinite(item.sequence);
}

function historyItemSequence(item: ThreadHistoryItemDto) {
  return hasHistoryItemSequence(item) ? item.sequence! : Number.POSITIVE_INFINITY;
}

export function sortHistoryItemsBySequence<T extends ThreadHistoryItemDto>(items: T[]): T[] {
  if (!items.some(hasHistoryItemSequence)) {
    return items;
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const sequenceDelta =
        historyItemSequence(left.item) - historyItemSequence(right.item);
      return sequenceDelta === 0 ? left.index - right.index : sequenceDelta;
    })
    .map((entry) => entry.item);
}

function sortTurnItemsByRecordedSequence(items: ThreadHistoryItemDto[]) {
  const leadingItems: ThreadHistoryItemDto[] = [];
  let index = 0;

  while (
    index < items.length &&
    items[index]?.kind === 'userMessage' &&
    !hasHistoryItemSequence(items[index]!)
  ) {
    leadingItems.push(items[index]!);
    index += 1;
  }

  return [...leadingItems, ...sortHistoryItemsBySequence(items.slice(index))];
}

function mergeHistoryItemsBySequence(
  items: ThreadHistoryItemDto[],
  missingItems: ThreadHistoryItemDto[],
) {
  if (missingItems.length === 0) {
    return items;
  }

  if (!missingItems.some(hasHistoryItemSequence)) {
    return [...items, ...missingItems];
  }

  const mergedItems = [...items];
  const orderedMissingItems = sortHistoryItemsBySequence(missingItems);
  for (const missingItem of orderedMissingItems) {
    if (!hasHistoryItemSequence(missingItem)) {
      mergedItems.push(missingItem);
      continue;
    }

    const firstGreaterIndex = mergedItems.findIndex(
      (item) =>
        hasHistoryItemSequence(item) &&
        historyItemSequence(item) > historyItemSequence(missingItem),
    );
    if (firstGreaterIndex >= 0) {
      mergedItems.splice(firstGreaterIndex, 0, missingItem);
      continue;
    }

    const lastLowerIndex = mergedItems.findLastIndex(
      (item) =>
        hasHistoryItemSequence(item) &&
        historyItemSequence(item) < historyItemSequence(missingItem),
    );
    if (lastLowerIndex >= 0) {
      mergedItems.splice(lastLowerIndex + 1, 0, missingItem);
      continue;
    }

    mergedItems.push(missingItem);
  }

  return mergedItems;
}

export function mergePersistedHistoryItemsIntoTurns(
  turns: ThreadTurnDto[],
  persistedItemsByTurnId: Map<string, ThreadHistoryItemDto[]>,
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadTurnDto[] {
  if (persistedItemsByTurnId.size === 0) {
    return turns;
  }

  return turns.map((turn) => {
    if (turn.status === 'inProgress') {
      return turn;
    }

    const persistedItems = persistedItemsByTurnId.get(turn.id);
    if (!persistedItems || persistedItems.length === 0) {
      return turn;
    }

    let changed = false;
    const persistedItemsById = new Map(persistedItems.map((item) => [item.id, item]));
    const nextItems = turn.items.map((item) => {
      const persistedItem = persistedItemsById.get(item.id);
      if (
        !persistedItem ||
        item.kind !== persistedItem.kind ||
        (persistedItem.kind !== 'commandExecution' && persistedItem.kind !== 'toolCall')
      ) {
        return item;
      }

      const existingText = item.detailText?.trim() || item.text.trim();
      const persistedText = persistedItem.detailText?.trim() || persistedItem.text.trim();
      if (persistedText.length <= existingText.length) {
        return item;
      }

      changed = true;
      persistedItemsById.delete(item.id);
      return persistedItem.kind === 'commandExecution'
        ? deferCommandHistoryItem(
            persistedItem as ThreadHistoryItemDto & { kind: 'commandExecution' },
            deferredDetails,
          )
        : deferToolCallHistoryItem(
            persistedItem as ThreadHistoryItemDto & { kind: 'toolCall' },
            deferredDetails,
          );
    });

    const existingItemIds = new Set(nextItems.map((item) => item.id));
    const missingItems = [...persistedItemsById.values()]
      .filter((item) => !existingItemIds.has(item.id))
      .map((item) =>
        item.kind === 'commandExecution'
          ? deferCommandHistoryItem(
              item as ThreadHistoryItemDto & { kind: 'commandExecution' },
              deferredDetails,
            )
          : item.kind === 'toolCall'
            ? deferToolCallHistoryItem(
                item as ThreadHistoryItemDto & { kind: 'toolCall' },
                deferredDetails,
              )
            : item,
      );
    if (missingItems.length === 0 && !changed) {
      return turn;
    }

    return {
      ...turn,
      items: mergeHistoryItemsBySequence(nextItems, missingItems),
    };
  });
}

export function agentTurnToThreadTurnDto(
  turn: AgentTurn,
  deferredDetails?: Map<string, ThreadHistoryItemDetailDto>,
): ThreadTurnDto {
  const baseTurn: ThreadTurnDto = {
    id: turn.providerTurnId,
    startedAt: parseUuidV7Timestamp(turn.providerTurnId),
    status: turn.status,
    error: turn.error?.message ?? null,
    items: turn.items,
  };

  return deferredDetails ? deferLargeHistoryItemDetails(baseTurn, deferredDetails) : baseTurn;
}

function applyRecordedTurnItemOrder(
  turn: ThreadTurnDto,
  turnItemOrder: TurnItemOrderSnapshot,
): ThreadTurnDto {
  const itemOrder = turnItemOrder.get(turn.id);
  if (!itemOrder || itemOrder.size === 0) {
    return turn;
  }

  let changed = false;
  const items = turn.items.map((item) => {
    const sequence = itemOrder.get(item.id);
    if (sequence === undefined || item.sequence === sequence) {
      return item;
    }

    changed = true;
    return {
      ...item,
      sequence,
    };
  });

  return changed ? { ...turn, items: sortTurnItemsByRecordedSequence(items) } : turn;
}

export function applyRecordedTurnItemOrders(
  turns: ThreadTurnDto[],
  turnItemOrder: TurnItemOrderSnapshot,
): ThreadTurnDto[] {
  if (turnItemOrder.size === 0) {
    return turns;
  }

  return turns.map((turn) => applyRecordedTurnItemOrder(turn, turnItemOrder));
}
