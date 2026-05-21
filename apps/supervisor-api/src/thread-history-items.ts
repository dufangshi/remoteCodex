import type { AgentTurn } from '../../../packages/agent-runtime/src/index';
import type {
  ThreadHistoryItemDetailDto,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../../packages/shared/src/index';

const DEFERRED_COMMAND_DETAIL_TITLE = 'Command Output';
const DEFERRED_TOOL_DETAIL_TITLE = 'Tool Call Details';
const DEFERRED_AGENT_TOOL_DETAIL_TITLE = 'Agent Details';

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
  item: ThreadHistoryItemDto & { kind: 'toolCall' | 'agentToolCall' | 'skillToolCall' },
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const fullText = item.detailText?.trim() || item.text || 'Tool call';
  deferredDetails.set(item.id, {
    id: item.id,
    kind: item.kind,
    title:
      item.kind === 'agentToolCall'
        ? DEFERRED_AGENT_TOOL_DETAIL_TITLE
        : item.kind === 'skillToolCall'
          ? 'Skill Details'
        : DEFERRED_TOOL_DETAIL_TITLE,
    text: fullText,
  });

  return {
    ...item,
    text: summarizeText(item.text, 'Tool call'),
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
          || item.kind === 'agentToolCall'
          || item.kind === 'skillToolCall'
          ? deferToolCallHistoryItem(
              item as ThreadHistoryItemDto & {
                kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
              },
              deferredDetails,
            )
        : item,
    ),
  };
}

export function shouldPersistLiveHistoryItem(item: ThreadHistoryItemDto) {
  return (
    item.kind === 'agentMessage' ||
    item.kind === 'commandExecution' ||
    item.kind === 'fileChange' ||
    item.kind === 'fileRead' ||
    item.kind === 'hook' ||
    item.kind === 'agentToolCall' ||
    item.kind === 'skillToolCall' ||
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

  const trailingItems = items.slice(index);
  if (!trailingItems.some(hasHistoryItemSequence)) {
    return items;
  }

  const sequenceValues = trailingItems
    .map((item) => historyItemSequence(item))
    .filter(Number.isFinite);
  const maxSequence = sequenceValues.length > 0 ? Math.max(...sequenceValues) : 0;
  const orderedItems: Array<{
    item: ThreadHistoryItemDto;
    index: number;
    order: number;
  }> = [];

  let cursor = 0;
  while (cursor < trailingItems.length) {
    const item = trailingItems[cursor]!;
    if (hasHistoryItemSequence(item)) {
      orderedItems.push({ item, index: cursor, order: historyItemSequence(item) });
      cursor += 1;
      continue;
    }

    const blockStart = cursor;
    while (
      cursor < trailingItems.length &&
      !hasHistoryItemSequence(trailingItems[cursor]!)
    ) {
      cursor += 1;
    }

    const block = trailingItems.slice(blockStart, cursor);
    const previousSequenced = [...trailingItems.slice(0, blockStart)]
      .reverse()
      .find(hasHistoryItemSequence);
    const nextSequenced = trailingItems.slice(cursor).find(hasHistoryItemSequence);
    const previousSequence = previousSequenced
      ? historyItemSequence(previousSequenced)
      : null;
    const nextSequence = nextSequenced ? historyItemSequence(nextSequenced) : null;

    block.forEach((blockItem, blockIndex) => {
      let order: number;
      if (previousSequence === null && nextSequence !== null) {
        order = nextSequence - (block.length - blockIndex) / (block.length + 1);
      } else if (
        previousSequence !== null &&
        nextSequence !== null &&
        nextSequence > previousSequence
      ) {
        const span = nextSequence - previousSequence;
        order = previousSequence + ((blockIndex + 1) / (block.length + 1)) * span;
      } else {
        order = maxSequence + 1 + blockIndex / (block.length + 1);
      }
      orderedItems.push({
        item: blockItem,
        index: blockStart + blockIndex,
        order,
      });
    });
  }

  const sortedTrailingItems = orderedItems
    .sort((left, right) => {
      const orderDelta = left.order - right.order;
      return orderDelta === 0 ? left.index - right.index : orderDelta;
    })
    .map((entry) => entry.item);

  return [...leadingItems, ...sortedTrailingItems];
}

function mergeHistoryItemsBySequence(
  items: ThreadHistoryItemDto[],
  missingItems: ThreadHistoryItemDto[],
) {
  if (missingItems.length === 0) {
    return sortTurnItemsByRecordedSequence(items);
  }

  if (!missingItems.some(hasHistoryItemSequence)) {
    return sortTurnItemsByRecordedSequence([...items, ...missingItems]);
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

  return sortTurnItemsByRecordedSequence(mergedItems);
}

function copyPersistedSequence(
  item: ThreadHistoryItemDto,
  persistedItem: ThreadHistoryItemDto,
) {
  if (!hasHistoryItemSequence(persistedItem)) {
    return item;
  }

  const sequence = historyItemSequence(persistedItem);
  return item.sequence === sequence ? item : { ...item, sequence };
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
    const persistedItems = persistedItemsByTurnId.get(turn.id);
    if (!persistedItems || persistedItems.length === 0) {
      return turn;
    }

    let changed = false;
    const persistedItemsById = new Map(persistedItems.map((item) => [item.id, item]));
    const nextItems = turn.items.map((item) => {
      const persistedItem = persistedItemsById.get(item.id);
      if (!persistedItem) {
        return item;
      }

      persistedItemsById.delete(item.id);

      if (item.kind !== persistedItem.kind) {
        return item;
      }

      const sequencedItem = copyPersistedSequence(item, persistedItem);
      if (sequencedItem !== item) {
        changed = true;
      }

      if (
        persistedItem.kind === 'commandExecution' ||
        persistedItem.kind === 'toolCall' ||
        persistedItem.kind === 'agentToolCall' ||
        persistedItem.kind === 'skillToolCall'
      ) {
        const existingText = item.detailText?.trim() || item.text.trim();
        const persistedText = persistedItem.detailText?.trim() || persistedItem.text.trim();
        if (persistedText.length > existingText.length) {
          changed = true;
          return persistedItem.kind === 'commandExecution'
            ? deferCommandHistoryItem(
                persistedItem as ThreadHistoryItemDto & { kind: 'commandExecution' },
                deferredDetails,
              )
            : deferToolCallHistoryItem(
                persistedItem as ThreadHistoryItemDto & {
                  kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
                },
                deferredDetails,
              );
        }
      }

      return sequencedItem;
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
            || item.kind === 'agentToolCall'
            || item.kind === 'skillToolCall'
            ? deferToolCallHistoryItem(
                item as ThreadHistoryItemDto & {
                  kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
                },
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
    startedAt: turn.startedAt ?? parseUuidV7Timestamp(turn.providerTurnId),
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
