import type { AgentTurn } from '../../../packages/agent-runtime/src/index';
import { isTransientAgentHistoryItem } from '../../../packages/agent-runtime/src/index';
import type {
  ThreadHistoryItemDetailDto,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../../packages/shared/src/index';

const DEFERRED_COMMAND_DETAIL_TITLE = 'Command Output';
const DEFERRED_TOOL_DETAIL_TITLE = 'Tool Call Details';
const DEFERRED_AGENT_TOOL_DETAIL_TITLE = 'Agent Details';
const DEFERRED_FILE_CHANGE_DETAIL_TITLE = 'File Change Details';
const DEFERRED_FILE_READ_DETAIL_TITLE = 'File Read Details';
const DEFERRED_WEB_SEARCH_DETAIL_TITLE = 'Web Search Details';
const DEFERRED_HOOK_DETAIL_TITLE = 'Hook Details';

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

function normalizeHistoryItemCreatedAt(
  item: ThreadHistoryItemDto,
  fallback: string | null,
): ThreadHistoryItemDto {
  if (item.createdAt) {
    return item;
  }

  return {
    ...item,
    createdAt: parseUuidV7Timestamp(item.id) ?? fallback,
  };
}

function summarizeText(text: string, fallback: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 1 && lines.at(-1)?.trim() === '') {
    lines.pop();
  }
  return lines.find((line) => line.trim().length > 0) ?? lines[0] ?? fallback;
}

function containsRemoteCodexArtifact(text: string | null | undefined) {
  return /```(?:artifact|remote-codex-artifact)\b/i.test(text ?? '');
}

function deferCommandHistoryItem(
  item: ThreadHistoryItemDto & { kind: 'commandExecution' },
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const fullText = item.detailText?.trim() || item.text || 'Command output';
  const summaryText = item.previewText?.trim() || fullText;
  deferredDetails.set(item.id, {
    id: item.id,
    kind: item.kind,
    title: DEFERRED_COMMAND_DETAIL_TITLE,
    text: fullText,
  });

  return {
    ...item,
    text: summarizeText(summaryText, 'Command output'),
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

function deferredDetailTitleForItem(item: ThreadHistoryItemDto) {
  switch (item.kind) {
    case 'commandExecution':
      return DEFERRED_COMMAND_DETAIL_TITLE;
    case 'toolCall':
      return DEFERRED_TOOL_DETAIL_TITLE;
    case 'agentToolCall':
      return DEFERRED_AGENT_TOOL_DETAIL_TITLE;
    case 'skillToolCall':
      return 'Skill Details';
    case 'fileChange':
      return DEFERRED_FILE_CHANGE_DETAIL_TITLE;
    case 'fileRead':
      return DEFERRED_FILE_READ_DETAIL_TITLE;
    case 'webSearch':
      return DEFERRED_WEB_SEARCH_DETAIL_TITLE;
    case 'hook':
      return item.hookEventLabel
        ? `${item.hookEventLabel} ${DEFERRED_HOOK_DETAIL_TITLE}`
        : DEFERRED_HOOK_DETAIL_TITLE;
    default:
      return 'Details';
  }
}

function fallbackDetailTextForItem(item: ThreadHistoryItemDto) {
  switch (item.kind) {
    case 'fileChange':
      return 'File changes';
    case 'fileRead':
      return 'File read';
    case 'webSearch':
      return 'Web search';
    case 'hook':
      return 'Hook output';
    default:
      return 'Details';
  }
}

function fullDetailTextForItem(item: ThreadHistoryItemDto, fallback: string) {
  const detailText = item.detailText?.trim();
  const hookOutputText =
    item.kind === 'hook'
      ? item.hookOutputEntries
        ?.map((entry) => entry.text.trim())
        .filter(Boolean)
        .join('\n')
        .trim() ?? ''
      : '';

  if (detailText && hookOutputText && !detailText.includes(hookOutputText)) {
    return [detailText, 'Output:', hookOutputText].join('\n\n');
  }

  return detailText || hookOutputText || item.text || fallback;
}

function deferInlineDetailHistoryItem(
  item: ThreadHistoryItemDto & {
    kind: 'fileChange' | 'fileRead' | 'webSearch' | 'hook';
  },
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const fallback = fallbackDetailTextForItem(item);
  const fullText = fullDetailTextForItem(item, fallback);
  deferredDetails.set(item.id, {
    id: item.id,
    kind: item.kind,
    title: deferredDetailTitleForItem(item),
    text: fullText,
  });

  const previewText = item.previewText?.trim();
  const text = item.text.trim() || summarizeText(previewText || fullText, fallback);

  const deferredItem: ThreadHistoryItemDto = {
    ...item,
    text,
    detailText: null,
    hasDeferredDetail: true,
  };

  if (item.kind === 'hook') {
    return {
      ...deferredItem,
      hookOutputEntries: null,
    };
  }

  return deferredItem;
}

export function deferHistoryItemDetail(
  item: ThreadHistoryItemDto,
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  if (item.kind === 'commandExecution') {
    return deferCommandHistoryItem(
      item as ThreadHistoryItemDto & { kind: 'commandExecution' },
      deferredDetails,
    );
  }

  if (
    item.kind === 'toolCall' ||
    item.kind === 'agentToolCall' ||
    item.kind === 'skillToolCall'
  ) {
    return containsRemoteCodexArtifact(item.detailText)
      ? item
      : deferToolCallHistoryItem(
          item as ThreadHistoryItemDto & {
            kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
          },
          deferredDetails,
        );
  }

  if (
    item.kind === 'fileChange' ||
    item.kind === 'fileRead' ||
    item.kind === 'webSearch' ||
    item.kind === 'hook'
  ) {
    if (
      !item.detailText?.trim() &&
      !(
        item.kind === 'hook' &&
        item.hookOutputEntries?.some((entry) => entry.text.trim().length > 0)
      )
    ) {
      return item;
    }

    return deferInlineDetailHistoryItem(
      item as ThreadHistoryItemDto & {
        kind: 'fileChange' | 'fileRead' | 'webSearch' | 'hook';
      },
      deferredDetails,
    );
  }

  return item;
}

export function deferHistoryItemDetailForTransport(
  item: ThreadHistoryItemDto,
): ThreadHistoryItemDto {
  return deferHistoryItemDetail(item, new Map());
}

export function deferLargeHistoryItemDetails(
  turn: ThreadTurnDto,
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadTurnDto {
  return {
    ...turn,
    items: turn.items.map((item) => deferHistoryItemDetail(item, deferredDetails)),
  };
}

export function shouldPersistLiveHistoryItem(item: ThreadHistoryItemDto) {
  return (
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

export function shouldPersistFinalHistoryItem(item: ThreadHistoryItemDto) {
  return item.kind === 'agentMessage' || shouldPersistLiveHistoryItem(item);
}

export function shouldPersistRuntimeFinalHistoryItem(
  item: ThreadHistoryItemDto,
) {
  if (item.kind === 'agentMessage' && isTransientAgentHistoryItem(item)) {
    return false;
  }

  return shouldPersistFinalHistoryItem(item);
}

function visibleRuntimeTurnItems(items: ThreadHistoryItemDto[]) {
  const hasFinalAgentMessage = items.some(
    (item) => item.kind === 'agentMessage' && !isTransientAgentHistoryItem(item),
  );
  if (!hasFinalAgentMessage) {
    return items;
  }

  return items.filter(
    (item) => !(item.kind === 'agentMessage' && isTransientAgentHistoryItem(item)),
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

function historyItemTranscriptOrder(item: ThreadHistoryItemDto) {
  return typeof item.transcriptOrder === 'number' && Number.isFinite(item.transcriptOrder)
    ? item.transcriptOrder
    : null;
}

function copyPersistedOrderingHints(
  item: ThreadHistoryItemDto,
  persistedItem: ThreadHistoryItemDto,
  turnStartedAt: string | null | undefined,
) {
  let nextItem = item;
  if (
    persistedItem.createdAt &&
    (!nextItem.createdAt ||
      (nextItem.kind === 'agentMessage' && nextItem.createdAt === turnStartedAt))
  ) {
    nextItem = { ...nextItem, createdAt: persistedItem.createdAt };
  }

  if (hasHistoryItemSequence(persistedItem)) {
    const sequence = historyItemSequence(persistedItem);
    if (nextItem.sequence !== sequence) {
      nextItem = { ...nextItem, sequence };
    }
  }

  const transcriptOrder = historyItemTranscriptOrder(persistedItem);
  if (transcriptOrder !== null && nextItem.transcriptOrder !== transcriptOrder) {
    nextItem = { ...nextItem, transcriptOrder };
  }

  return nextItem;
}

export function sortHistoryItemsBySequence<T extends ThreadHistoryItemDto>(items: T[]): T[] {
  return sortTurnItemsByRecordedSequence(items) as T[];
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

function shouldAppendPersistedMissingItem(
  turn: ThreadTurnDto,
  item: ThreadHistoryItemDto,
) {
  if (item.kind !== 'agentMessage') {
    return true;
  }

  // Older builds persisted streaming agent drafts. Once the provider transcript
  // contains completed assistant messages, treat that transcript as authoritative.
  const isCrossTurnProjection = Boolean(item.sourceTurnId && item.sourceTurnId !== turn.id);
  return !(
    turn.status === 'completed' &&
    turn.items.some((turnItem) => turnItem.kind === 'agentMessage') &&
    !isCrossTurnProjection
  );
}

function shouldUsePersistedUserMessageText(
  item: ThreadHistoryItemDto,
  persistedItem: ThreadHistoryItemDto,
) {
  return (
    item.kind === 'userMessage' &&
    persistedItem.kind === 'userMessage' &&
    /\[localImage\]/.test(item.text) &&
    /\[PHOTO\s+[^\]]+\]/.test(persistedItem.text)
  );
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
    const nextItems = turn.items.map((item, transcriptIndex) => {
      const persistedItem = persistedItemsById.get(item.id);
      const itemWithTranscriptOrder =
        item.transcriptOrder === transcriptIndex
          ? item
          : { ...item, transcriptOrder: transcriptIndex };
      if (!persistedItem) {
        changed = true;
        return itemWithTranscriptOrder;
      }

      persistedItemsById.delete(item.id);

      if (item.kind !== persistedItem.kind) {
        changed = itemWithTranscriptOrder !== item || changed;
        return itemWithTranscriptOrder;
      }

      const persistedItemWithTranscriptOrder = {
        ...persistedItem,
        transcriptOrder: transcriptIndex,
      };
      if (shouldUsePersistedUserMessageText(item, persistedItemWithTranscriptOrder)) {
        changed = true;
        return deferHistoryItemDetail(persistedItemWithTranscriptOrder, deferredDetails);
      }

      const sequencedItem = copyPersistedOrderingHints(
        itemWithTranscriptOrder,
        persistedItemWithTranscriptOrder,
        turn.startedAt,
      );
      if (sequencedItem !== item) {
        changed = true;
      }

      if (shouldPersistLiveHistoryItem(persistedItem)) {
        const existingText = item.detailText?.trim() || item.text.trim();
        const persistedText = persistedItem.detailText?.trim() || persistedItem.text.trim();
        if (persistedText.length > existingText.length) {
          changed = true;
          return deferHistoryItemDetail(persistedItemWithTranscriptOrder, deferredDetails);
        }
      }

      return deferHistoryItemDetail(sequencedItem, deferredDetails);
    });

    const existingItemIds = new Set(nextItems.map((item) => item.id));
    const missingItems = [...persistedItemsById.values()]
      .filter((item) => !existingItemIds.has(item.id))
      .filter((item) => shouldAppendPersistedMissingItem(turn, item))
      .map((item) => deferHistoryItemDetail(item, deferredDetails));
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
  const startedAt = turn.startedAt ?? parseUuidV7Timestamp(turn.providerTurnId);
  const baseTurn: ThreadTurnDto = {
    id: turn.providerTurnId,
    startedAt,
    status: turn.status,
    error: turn.error?.message ?? null,
    items: visibleRuntimeTurnItems(turn.items).map((item, transcriptIndex) =>
      normalizeHistoryItemCreatedAt(
        item.transcriptOrder === transcriptIndex
          ? item
          : { ...item, transcriptOrder: transcriptIndex },
        startedAt,
      ),
    ),
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
