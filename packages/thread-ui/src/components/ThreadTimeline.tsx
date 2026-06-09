import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
  type RefObject,
} from 'react';

import type {
  RespondThreadActionRequestInput,
  ThreadActionRequestDto,
  ThreadActivityNoteDto,
  ThreadHistoryItemDetailDto,
  ThreadHistoryItemDto,
  ThreadPendingSteerDto,
  ThreadTurnDto,
} from '@remote-codex/shared';
import { LongTextDialog } from './LongTextDialog';
import type { ThreadTimelineAdapter } from '../adapters';
import {
  formatLongTimestamp,
  formatShortTimestamp,
  turnStatusLabel,
} from './threadPresentation';
import { GraphChatMarkdownAwareBody } from './graph-chat/GraphChatMessageBody';
import { GraphChatHistoryEntries } from './graph-chat/GraphChatHistoryEntries';
import {
  GraphChatAgentToolCallItem as AgentToolCallItem,
  GraphChatArtifactHistoryItem as ArtifactHistoryItem,
  GraphChatCommandGroupItem as CommandGroupItem,
  GraphChatCommandItem as CommandItem,
  GraphChatContextCompactionItem as ContextCompactionItem,
  GraphChatFileChangeGroupItem as FileChangeGroupItem,
  GraphChatFileChangeItem as FileChangeItem,
  GraphChatFileReadGroupItem as FileReadGroupItem,
  GraphChatFileReadItem as FileReadItem,
  GraphChatGenericHistoryItem as GenericHistoryItem,
  GraphChatHookItem as HookItem,
  GraphChatImageItem as ImageItem,
  GraphChatPlanHistoryItem as PlanHistoryItem,
  GraphChatSearchGroupItem as SearchGroupItem,
  GraphChatSkillToolCallItem as SkillToolCallItem,
  GraphChatToolCallItem as ToolCallItem,
  GraphChatWebSearchItem as WebSearchItem,
} from './graph-chat/GraphChatHistoryItems';
import { GraphChatCompactMessageItem as CompactMessageItem } from './graph-chat/GraphChatCompactMessageItem';
import { GraphChatTurnBody } from './graph-chat/GraphChatTurnBody';
import { GraphChatTurnFrame } from './graph-chat/GraphChatTurnFrame';

export interface ThreadTimelineProps {
  threadId?: string | undefined;
  turns: ThreadTurnDto[];
  totalTurnCount?: number;
  pendingRequests?: ThreadActionRequestDto[];
  activeTurnId?: string | null;
  threadRunning?: boolean;
  livePlan?: {
    turnId: string;
    explanation: string | null;
    plan: Array<{ step: string; status: string }>;
  } | null;
  liveItems?: {
    turnId: string;
    items: ThreadHistoryItemDto[];
  } | null;
  respondingRequestId?: string | null;
  onRespondToRequest?: (
    requestId: string,
    input: RespondThreadActionRequestInput,
  ) => Promise<void> | void;
  liveOutput: string;
  scrollRequestKey?: number;
  bottomSpacer?: number;
  className?: string;
  onTailVisibilityChange?: (isVisible: boolean) => void;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
  ephemeralUserNote?: string | null;
  answeredRequestNotes?: Array<{
    id: string;
    turnId?: string | null;
    title: string;
    summaryLines: string[];
    createdAt?: string;
  }>;
  activityNotes?: ThreadActivityNoteDto[];
  pendingSteers?: ThreadPendingSteerDto[];
  optimisticSteers?: Array<{
    id: string;
    clientRequestId: string;
    turnId: string;
    prompt: string;
    createdAt: string;
    status: 'steering' | 'accepted';
  }>;
  optimisticTurn?: TimelineTurn | null;
  onLoadHistoryItemDetail?: (
    itemId: string,
  ) => Promise<ThreadHistoryItemDetailDto> | ThreadHistoryItemDetailDto;
  onOpenThread?: (threadId: string) => void;
  onSelectArtifact?: (input: {
    item: ThreadHistoryItemDto & { kind: 'artifact' };
    artifact: NonNullable<ThreadHistoryItemDto['artifact']>;
  }) => void;
  onSelectHistoryItemDetail?: (input: {
    item: ThreadHistoryItemDto;
    detail: ThreadHistoryItemDetailDto;
  }) => void;
  adapter?: ThreadTimelineAdapter | undefined;
}

interface ExpandedTextState {
  title: string;
  text: string;
}

interface CommandHistoryItem extends ThreadHistoryItemDto {
  kind: 'commandExecution';
}

interface FileChangeHistoryItem extends ThreadHistoryItemDto {
  kind: 'fileChange';
}

interface SearchHistoryItem extends ThreadHistoryItemDto {
  kind: 'webSearch';
}

interface FileReadHistoryItem extends ThreadHistoryItemDto {
  kind: 'fileRead';
}

interface ContextCompactionHistoryItem extends ThreadHistoryItemDto {
  kind: 'contextCompaction';
}

interface AgentMessageHistoryItemWithReasoning extends ThreadHistoryItemDto {
  kind: 'agentMessage';
  reasoningItems?: Array<ThreadHistoryItemDto & { kind: 'reasoning' }>;
}

type TimelineHistoryEntry =
  | {
      kind: 'item';
      key: string;
      item: ThreadHistoryItemDto;
    }
  | {
      kind: 'commandGroup';
      key: string;
      items: CommandHistoryItem[];
    }
  | {
      kind: 'fileChangeGroup';
      key: string;
      items: FileChangeHistoryItem[];
    }
  | {
      kind: 'searchGroup';
      key: string;
      items: SearchHistoryItem[];
    }
  | {
      kind: 'fileReadGroup';
      key: string;
      items: FileReadHistoryItem[];
    };

type TimelineTurn = Omit<ThreadTurnDto, 'status'> & {
  status: ThreadTurnDto['status'] | 'sending';
};

type TimelineAgentMessageEntry = Extract<TimelineHistoryEntry, { kind: 'item' }> & {
  item: AgentMessageHistoryItemWithReasoning;
};

interface TurnTokenDetail {
  id: string;
  label: string;
  tokenCompactValue: string;
  tokenRawValue: number;
  usdCompactValue: string;
  usdRawValue: number | null;
  className: string;
  icon: ReactNode | null;
}

const INITIAL_VISIBLE_TURNS = 10;
const LOAD_STEP = 10;
const FOLLOW_TAIL_THRESHOLD_PX = 80;
function useChangeRevision(inputs: readonly unknown[]) {
  const previousInputsRef = useRef<readonly unknown[] | null>(null);
  const revisionRef = useRef(0);
  const previousInputs = previousInputsRef.current;
  const changed =
    previousInputs === null ||
    previousInputs.length !== inputs.length ||
    inputs.some((input, index) => !Object.is(input, previousInputs[index]));

  if (changed) {
    revisionRef.current += 1;
    previousInputsRef.current = inputs;
  }

  return revisionRef.current;
}

function normalizeLines(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  while (lines.length > 1 && lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  return lines;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function parseHookPromptText(text: string): ThreadHistoryItemDto | null {
  const match = text
    .trim()
    .match(/^<hook_prompt(?:\s+hook_run_id="([^"]+)")?>([\s\S]*)<\/hook_prompt>$/);
  if (!match) {
    return null;
  }

  const hookRunId = match[1] ? decodeXmlEntities(match[1]) : null;
  const output = decodeXmlEntities(match[2] ?? '').trim();
  const eventName = hookRunId?.split(':')[0] ?? 'hook';
  const eventLabel = eventName === 'stop' ? 'Stop' : eventName;
  const sourcePath = hookRunId?.split(':').slice(2).join(':') || null;

  return {
    id: `live-hook-prompt:${hookRunId ?? 'unknown'}`,
    kind: 'hook',
    text: `${eventLabel} hook`,
    previewText: output || `${eventLabel} hook`,
    detailText: output || null,
    status: 'Completed',
    hookEventName: eventName,
    hookEventLabel: eventLabel,
    hookHandlerType: 'command',
    hookScope: 'turn',
    hookSource: sourcePath ? 'project' : null,
    hookSourcePath: sourcePath,
    hookStatusMessage: null,
    hookOutputEntries: output ? [{ kind: 'warning', text: output }] : [],
  };
}

function isCompactChatItem(kind: ThreadHistoryItemDto['kind']) {
  return kind === 'userMessage' || kind === 'agentMessage';
}

function isSteerTailHistoryItem(kind: ThreadHistoryItemDto['kind']) {
  return (
    kind === 'commandExecution' ||
    kind === 'webSearch' ||
    kind === 'fileRead' ||
    kind === 'fileChange' ||
    kind === 'image' ||
    kind === 'contextCompaction'
  );
}

function isSteerConsumptionHistoryItem(kind: ThreadHistoryItemDto['kind']) {
  return (
    kind === 'agentMessage' ||
    kind === 'reasoning' ||
    kind === 'agentToolCall' ||
    kind === 'skillToolCall' ||
    kind === 'toolCall' ||
    kind === 'plan'
  );
}

function prepareTurnItemsForRendering(
  items: ThreadHistoryItemDto[],
  active: boolean,
) {
  if (!active) {
    return items;
  }

  const prepared = [...items];
  const firstUserIndex = prepared.findIndex((item) => item.kind === 'userMessage');
  if (firstUserIndex < 0) {
    return prepared;
  }

  for (let index = firstUserIndex + 1; index < prepared.length; index += 1) {
    const item = prepared[index];
    if (!item || item.kind !== 'userMessage') {
      continue;
    }

    let tailEnd = index + 1;
    while (
      tailEnd < prepared.length &&
      isSteerTailHistoryItem(prepared[tailEnd]!.kind)
    ) {
      tailEnd += 1;
    }

    if (tailEnd === index + 1) {
      continue;
    }

    const [steerItem] = prepared.splice(index, 1);
    prepared.splice(tailEnd - 1, 0, steerItem!);
    index = tailEnd - 1;
  }

  let seenPrimaryUserMessage = false;
  return prepared.map((item, index) => {
    if (item.kind !== 'userMessage') {
      return item;
    }

    if (!seenPrimaryUserMessage) {
      seenPrimaryUserMessage = true;
      return item;
    }

    const hasConsumptionAfter = prepared
      .slice(index + 1)
      .some((nextItem) => isSteerConsumptionHistoryItem(nextItem.kind));

    if (hasConsumptionAfter) {
      return item;
    }

    return {
      ...item,
      status: 'Awaiting response',
    };
  });
}

function hasHistoryItemSequence(item: ThreadHistoryItemDto) {
  return typeof item.sequence === 'number' && Number.isFinite(item.sequence);
}

function historyItemSequence(item: ThreadHistoryItemDto) {
  return hasHistoryItemSequence(item) ? item.sequence! : Number.POSITIVE_INFINITY;
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

function mergeLiveTurnItems(
  items: ThreadHistoryItemDto[],
  liveItems: ThreadHistoryItemDto[] | null | undefined,
) {
  if (!liveItems || liveItems.length === 0) {
    return sortTurnItemsByRecordedSequence(items);
  }

  const liveItemsById = new Map(liveItems.map((item) => [item.id, item]));
  const mergedItems: ThreadHistoryItemDto[] = items.map((item) => {
    const liveItem = liveItemsById.get(item.id);
    if (!liveItem) {
      return item;
    }

    liveItemsById.delete(item.id);
    const mergedItem: ThreadHistoryItemDto = {
      ...item,
      ...liveItem,
      text: liveItem.text || item.text,
    };
    const detailText = liveItem.detailText ?? item.detailText;
    const previewText = liveItem.previewText ?? item.previewText;
    const status = liveItem.status ?? item.status;
    const sequence = liveItem.sequence ?? item.sequence;
    if (detailText !== undefined) {
      mergedItem.detailText = detailText;
    }
    if (previewText !== undefined) {
      mergedItem.previewText = previewText;
    }
    if (status !== undefined) {
      mergedItem.status = status;
    }
    if (sequence !== undefined) {
      mergedItem.sequence = sequence;
    }
    return mergedItem;
  });
  const uniqueLiveItems = [...liveItemsById.values()];
  if (uniqueLiveItems.length === 0 && !mergedItems.some(hasHistoryItemSequence)) {
    return mergedItems;
  }

  mergedItems.push(...uniqueLiveItems);
  if (
    !mergedItems.some(
      (item) => typeof item.sequence === 'number' && Number.isFinite(item.sequence),
    )
  ) {
    return mergedItems;
  }

  return sortTurnItemsByRecordedSequence(mergedItems);
}

function getLiveOutputTailForTurn(
  liveOutput: string,
  items: ThreadHistoryItemDto[],
) {
  if (!liveOutput) {
    return '';
  }

  const materializedAgentTexts = items
    .filter(
      (
        item,
      ): item is ThreadHistoryItemDto & {
        kind: 'agentMessage';
      } => item.kind === 'agentMessage',
    )
    .map((item) => item.text)
    .filter((text) => text.length > 0);

  const lastMaterializedAgentText = materializedAgentTexts.at(-1) ?? '';
  if (lastMaterializedAgentText) {
    const anchorIndex = liveOutput.lastIndexOf(lastMaterializedAgentText);
    if (anchorIndex >= 0) {
      const anchoredTail = liveOutput.slice(
        anchorIndex + lastMaterializedAgentText.length,
      );
      if (!anchoredTail.trim()) {
        return '';
      }
      return anchoredTail;
    }
  }

  const materializedAgentText = materializedAgentTexts.join('');
  if (!materializedAgentText) {
    return liveOutput;
  }

  const sharedPrefixLength = Math.min(
    liveOutput.length,
    materializedAgentText.length,
  );
  let consumedLength = 0;
  while (
    consumedLength < sharedPrefixLength &&
    liveOutput[consumedLength] === materializedAgentText[consumedLength]
  ) {
    consumedLength += 1;
  }

  if (consumedLength === 0) {
    return liveOutput;
  }

  const remainingOutput = liveOutput.slice(consumedLength);
  return remainingOutput.trim() ? remainingOutput : '';
}

function isRunningHistoryStatus(status?: string | null) {
  if (!status) {
    return false;
  }

  const normalized = status.toLowerCase();
  return (
    normalized.includes('running') ||
    normalized.includes('inprogress') ||
    normalized.includes('in_progress')
  );
}

function isActiveTurnStatus(status: TimelineTurn['status']) {
  return status === 'inProgress' || status === 'sending';
}

function isNearBottom(
  container: HTMLDivElement,
  threshold = FOLLOW_TAIL_THRESHOLD_PX,
) {
  const distanceFromBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight;
  return distanceFromBottom <= threshold;
}

function isElementVisible(container: HTMLDivElement, element: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const visibleTop = Math.max(containerRect.top, elementRect.top);
  const visibleBottom = Math.min(containerRect.bottom, elementRect.bottom);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  return visibleHeight > 0;
}

function groupTimelineHistoryItems(items: ThreadHistoryItemDto[]) {
  const entries: TimelineHistoryEntry[] = [];
  let index = 0;
  const attachedReasoningIds = new Set<string>();
  const pendingReasoningItems: Array<ThreadHistoryItemDto & { kind: 'reasoning' }> = [];

  function lastAgentMessageEntry() {
    const lastEntry = entries.at(-1);
    if (lastEntry?.kind !== 'item' || lastEntry.item.kind !== 'agentMessage') {
      return null;
    }

    return lastEntry as TimelineAgentMessageEntry;
  }

  function attachReasoningToAgentMessage(
    entry: TimelineAgentMessageEntry,
    reasoningItems: Array<ThreadHistoryItemDto & { kind: 'reasoning' }>,
  ) {
    if (reasoningItems.length === 0) {
      return;
    }

    entry.item = {
      ...entry.item,
      reasoningItems: [
        ...(entry.item.reasoningItems ?? []),
        ...reasoningItems,
      ],
    };
    for (const reasoningItem of reasoningItems) {
      attachedReasoningIds.add(reasoningItem.id);
    }
  }

  function flushPendingReasoningItems() {
    const reasoningItems = pendingReasoningItems.splice(0);
    for (const reasoningItem of reasoningItems) {
      entries.push({
        kind: 'item',
        key: reasoningItem.id,
        item: reasoningItem,
      });
    }
  }

  while (index < items.length) {
    const current = items[index];
    if (!current) {
      break;
    }

    if (attachedReasoningIds.has(current.id)) {
      index += 1;
      continue;
    }

    if (current.kind === 'reasoning') {
      let cursor = index;
      const reasoningItems: Array<ThreadHistoryItemDto & { kind: 'reasoning' }> = [];
      while (cursor < items.length && items[cursor]?.kind === 'reasoning') {
        reasoningItems.push(items[cursor] as ThreadHistoryItemDto & { kind: 'reasoning' });
        cursor += 1;
      }
      const previousAgentMessage = lastAgentMessageEntry();
      if (previousAgentMessage) {
        attachReasoningToAgentMessage(previousAgentMessage, reasoningItems);
      } else {
        pendingReasoningItems.push(...reasoningItems);
      }
      index = cursor;
      continue;
    }

    if (current.kind === 'agentMessage') {
      const reasoningItems = pendingReasoningItems.splice(0);
      const entry: TimelineAgentMessageEntry = {
        kind: 'item',
        key: current.id,
        item: current as AgentMessageHistoryItemWithReasoning,
      };
      attachReasoningToAgentMessage(entry, reasoningItems);
      entries.push(entry);
      index += 1;
      continue;
    }

    if (
      current.kind !== 'commandExecution' &&
      current.kind !== 'fileChange' &&
      current.kind !== 'webSearch' &&
      current.kind !== 'fileRead'
    ) {
      entries.push({
        kind: 'item',
        key: current.id,
        item: current,
      });
      index += 1;
      continue;
    }

    const groupedItems: ThreadHistoryItemDto[] = [];
    while (index < items.length && items[index]?.kind === current.kind) {
      groupedItems.push(items[index]!);
      index += 1;
    }

    if (groupedItems.length === 1) {
      entries.push({
        kind: 'item',
        key: groupedItems[0]!.id,
        item: groupedItems[0]!,
      });
      continue;
    }

    const groupKey = groupedItems.map((item) => item.id).join(':');

    if (current.kind === 'commandExecution') {
      entries.push({
        kind: 'commandGroup',
        key: groupKey,
        items: groupedItems as CommandHistoryItem[],
      });
      continue;
    }

    if (current.kind === 'fileChange') {
      entries.push({
        kind: 'fileChangeGroup',
        key: groupKey,
        items: groupedItems as FileChangeHistoryItem[],
      });
      continue;
    }

    if (current.kind === 'fileRead') {
      entries.push({
        kind: 'fileReadGroup',
        key: groupKey,
        items: groupedItems as FileReadHistoryItem[],
      });
      continue;
    }

    entries.push({
      kind: 'searchGroup',
      key: groupKey,
      items: groupedItems as SearchHistoryItem[],
    });
  }

  flushPendingReasoningItems();

  return entries;
}

function CompactMessageIcon({
  kind,
}: {
  kind: Extract<ThreadHistoryItemDto['kind'], 'userMessage' | 'agentMessage'>;
}) {
  if (kind === 'userMessage') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5 fill-none stroke-current"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8Z" />
        <path d="M3.5 13.25a4.5 4.5 0 0 1 9 0" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.25" y="3" width="9.5" height="7.5" rx="2" />
      <path d="M5.5 6.75h.01M10.5 6.75h.01M6.5 12.25h3" />
      <path d="M6 10.5v1.75M10 10.5v1.75" />
    </svg>
  );
}

function RunningDots({
  tone = 'amber',
}: {
  tone?: 'amber' | 'emerald' | 'sky';
}) {
  const dotClassName =
    tone === 'emerald'
      ? 'bg-sky-200/90'
      : tone === 'sky'
        ? 'bg-sky-300/90'
        : 'bg-amber-200/90';

  return (
    <span className="ml-1.5 inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`h-1.5 w-1.5 rounded-full animate-pulse ${dotClassName}`}
          style={{ animationDelay: `${index * 180}ms` }}
        />
      ))}
    </span>
  );
}

function normalizePlanStepStatus(status: string) {
  const normalized = status.trim().toLowerCase();

  if (
    normalized === 'completed' ||
    normalized === 'done' ||
    normalized === 'complete'
  ) {
    return 'completed' as const;
  }

  if (
    normalized === 'in_progress' ||
    normalized === 'in progress' ||
    normalized === 'inprogress' ||
    normalized === 'running' ||
    normalized === 'active'
  ) {
    return 'in_progress' as const;
  }

  if (
    normalized === 'pending' ||
    normalized === 'todo' ||
    normalized === 'not_started' ||
    normalized === 'not started' ||
    normalized === 'queued'
  ) {
    return 'pending' as const;
  }

  if (normalized === 'failed' || normalized === 'error') {
    return 'failed' as const;
  }

  return 'other' as const;
}

function isLivePlanExecutionEvidence(item: ThreadHistoryItemDto) {
  switch (item.kind) {
    case 'fileChange':
    case 'webSearch':
    case 'image':
    case 'contextCompaction':
      return true;
    case 'commandExecution':
    case 'toolCall':
      return !isRunningHistoryStatus(item.status);
    default:
      return false;
  }
}

function deriveDisplayedLivePlan(
  livePlan: {
    turnId: string;
    explanation: string | null;
    plan: Array<{ step: string; status: string }>;
  } | null,
  items: ThreadHistoryItemDto[],
  turnStatus: TimelineTurn['status'],
) {
  if (!livePlan || !isActiveTurnStatus(turnStatus)) {
    return livePlan;
  }

  const firstInProgressIndex = livePlan.plan.findIndex(
    (step) => normalizePlanStepStatus(step.status) === 'in_progress',
  );
  if (firstInProgressIndex < 0) {
    return livePlan;
  }

  const nextPendingIndex = livePlan.plan.findIndex(
    (step, index) =>
      index > firstInProgressIndex &&
      normalizePlanStepStatus(step.status) === 'pending',
  );
  if (nextPendingIndex < 0) {
    return livePlan;
  }

  const hasExecutionEvidence = items.some((item) =>
    isLivePlanExecutionEvidence(item),
  );
  if (!hasExecutionEvidence) {
    return livePlan;
  }

  const nextPlan = livePlan.plan.map((step, index) => {
    if (index === firstInProgressIndex) {
      return { ...step, status: 'completed' };
    }
    if (index === nextPendingIndex) {
      return { ...step, status: 'in_progress' };
    }
    return step;
  });

  return {
    ...livePlan,
    plan: nextPlan,
  };
}

function TurnStatusIndicator({
  status,
}: {
  status: TimelineTurn['status'];
}) {
  const label = turnStatusLabel(status);

  if (status === 'completed') {
    return (
        <span
          aria-label={label}
          title={label}
          className="timeline-status-icon timeline-status-icon-success inline-flex h-4 w-4 items-center justify-center"
        >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 fill-none stroke-current"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3.75 8.25 2.5 2.5 6-6" />
        </svg>
      </span>
    );
  }

  if (status === 'failed') {
    return (
        <span
          aria-label={label}
          title={label}
          className="timeline-status-icon timeline-status-icon-failed inline-flex h-4 w-4 items-center justify-center"
        >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 fill-none stroke-current"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 5 6 6M11 5l-6 6" />
        </svg>
      </span>
    );
  }

  if (status === 'interrupted') {
    return (
        <span
          aria-label={label}
          title={label}
          className="timeline-status-icon timeline-status-icon-warning inline-flex h-4 w-4 items-center justify-center"
        >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 fill-none stroke-current"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 4.5v7M10 4.5v7" />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-label={label}
      title={label}
      className="inline-flex min-w-[1.25rem] items-center justify-center text-sky-200"
    >
      <RunningDots tone="emerald" />
    </span>
  );
}

function TurnStatusBar({
  turn,
  variant = 'header',
}: {
  turn: TimelineTurn;
  variant?: 'header' | 'footer';
}) {
  const label = turnStatusLabel(turn.status);
  const runtimeSummary = formatTurnRuntimeSummary(turn);
  const tokenBadges = buildTurnTokenBadges(turn);
  const priceBadge = buildTurnPriceBadge(turn);
  const active = isActiveTurnStatus(turn.status);
  const toneClassName =
    turn.status === 'failed'
      ? 'border-rose-300/20 bg-rose-300/[0.06] text-rose-100'
      : active
        ? 'border-sky-300/22 bg-sky-300/[0.08] text-sky-100'
        : 'border-stone-700/90 bg-stone-900/70 text-stone-200';

  if (variant === 'footer') {
    return (
      <div
        className={`flex w-full flex-col gap-1.5 rounded-[0.95rem] border px-3 py-2 text-xs ${toneClassName}`}
      >
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <TurnStatusIndicator status={turn.status} />
            <span className="timeline-soft-text min-w-0 truncate">{runtimeSummary}</span>
          </div>
          {turn.startedAt && (
            <time
              dateTime={turn.startedAt}
              title={formatLongTimestamp(turn.startedAt)}
              className="timeline-meta-text shrink-0 text-[11px]"
            >
              {formatShortTimestamp(turn.startedAt)}
            </time>
          )}
        </div>
        {(priceBadge || tokenBadges.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 pl-6">
            {priceBadge ? (
              <span
                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${priceBadge.className}`}
                title={priceBadge.title}
              >
                {priceBadge.label}
              </span>
            ) : null}
            {tokenBadges.map((badge) => (
              <span
                key={badge.id}
                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                title={badge.title}
              >
                {badge.icon ? <span className="mr-1">{badge.icon}</span> : null}
                {badge.label}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const title = `${label} · ${runtimeSummary}`;

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] sm:text-[11px] ${toneClassName}`}
      title={title}
    >
      <TurnStatusIndicator status={turn.status} />
      <span className="timeline-meta-text min-w-0 truncate">{runtimeSummary}</span>
    </span>
  );
}

function TokenInIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2.75v8" />
      <path d="m4.75 7.5 3.25 3.25L11.25 7.5" />
    </svg>
  );
}

function TokenOutIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13.25v-8" />
      <path d="m11.25 8.5-3.25-3.25L4.75 8.5" />
    </svg>
  );
}

function TokenCacheIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.25 5.25 8 2.75l4.75 2.5L8 7.75l-4.75-2.5Z" />
      <path d="M3.25 8 8 10.5 12.75 8" />
      <path d="M3.25 10.75 8 13.25l4.75-2.5" />
      <path d="M3.25 5.25v5.5" />
      <path d="M12.75 5.25v5.5" />
    </svg>
  );
}

function TokenReasonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.2 3.2a2.3 2.3 0 0 0-2.95 3.5A2.4 2.4 0 0 0 4.5 11h.2c.25 1.1 1.1 1.8 2.3 1.8h1.8c1.2 0 2.05-.7 2.3-1.8h.2A2.4 2.4 0 0 0 12.75 6.7 2.3 2.3 0 0 0 9.8 3.2" />
      <path d="M6.3 6.15c.45-.42 1.02-.65 1.7-.65s1.25.23 1.7.65" />
      <path d="M8 5.5v4.75" />
      <path d="M6.75 9.05 8 10.25l1.25-1.2" />
    </svg>
  );
}

function formatCompactTokenCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    const rounded = value >= 10_000_000 ? Math.round(value / 1_000_000) : value / 1_000_000;
    return `${String(rounded.toFixed(1)).replace(/\.0$/, '')}m`;
  }

  if (value >= 1_000) {
    const rounded = value >= 10_000 ? Math.round(value / 1_000) : value / 1_000;
    return `${String(rounded.toFixed(1)).replace(/\.0$/, '')}k`;
  }

  return String(Math.round(value));
}

function formatCompactUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0';
  }

  if (value >= 100) {
    return `$${Math.round(value)}`;
  }

  if (value >= 10) {
    return `$${String(value.toFixed(1)).replace(/\.0$/, '')}`;
  }

  if (value >= 1) {
    return `$${String(value.toFixed(2)).replace(/0$/, '').replace(/\.$/, '')}`;
  }

  if (value >= 0.1) {
    return `$${value.toFixed(2)}`;
  }

  if (value >= 0.01) {
    return `$${value.toFixed(3)}`;
  }

  if (value >= 0.001) {
    return `$${value.toFixed(4)}`;
  }

  return '<$0.001';
}

function formatDetailedUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.0000';
  }

  return `$${value.toFixed(4)}`;
}

function proportionalOutputUsd(
  totalOutputUsd: number | null | undefined,
  outputTokens: number,
  sliceTokens: number,
) {
  const outputUsdValue = totalOutputUsd ?? null;
  if (
    !Number.isFinite(outputUsdValue ?? NaN) ||
    outputUsdValue === null ||
    outputTokens <= 0 ||
    sliceTokens <= 0
  ) {
    return null;
  }

  return (outputUsdValue * sliceTokens) / outputTokens;
}

function buildTurnTokenDetails(turn: TimelineTurn) {
  const usage = turn.tokenUsage?.total;
  if (!usage) {
    return [];
  }

  const nonCachedInputTokens = Math.max(
    usage.inputTokens - usage.cachedInputTokens,
    0,
  );
  const cachedInputTokens = Math.max(usage.cachedInputTokens, 0);
  const reasoningOutputTokens = Math.max(usage.reasoningOutputTokens, 0);
  const nonReasoningOutputTokens = Math.max(
    usage.outputTokens - reasoningOutputTokens,
    0,
  );

  const details: Array<TurnTokenDetail | null> = [
    nonCachedInputTokens > 0
      ? {
          id: 'in',
          label: 'Input',
          tokenCompactValue: formatCompactTokenCount(nonCachedInputTokens),
          tokenRawValue: nonCachedInputTokens,
          usdCompactValue: turn.priceEstimate
            ? formatDetailedUsd(turn.priceEstimate.inputUsd)
            : '--',
          usdRawValue: turn.priceEstimate?.inputUsd ?? null,
          className: 'token-badge-in',
          icon: <TokenInIcon />,
        }
      : null,
    cachedInputTokens > 0
      ? {
          id: 'cache',
          label: 'Cached input',
          tokenCompactValue: formatCompactTokenCount(cachedInputTokens),
          tokenRawValue: cachedInputTokens,
          usdCompactValue: turn.priceEstimate
            ? formatDetailedUsd(turn.priceEstimate.cachedInputUsd)
            : '--',
          usdRawValue: turn.priceEstimate?.cachedInputUsd ?? null,
          className: 'token-badge-cache',
          icon: <TokenCacheIcon />,
        }
      : null,
    nonReasoningOutputTokens > 0
      ? {
          id: 'out',
          label: 'Output',
          tokenCompactValue: formatCompactTokenCount(nonReasoningOutputTokens),
          tokenRawValue: nonReasoningOutputTokens,
          usdCompactValue: turn.priceEstimate
            ? formatDetailedUsd(
                proportionalOutputUsd(
                  turn.priceEstimate.outputUsd,
                  Math.max(usage.outputTokens, 0),
                  nonReasoningOutputTokens,
                ) ?? 0,
              )
            : '--',
          usdRawValue: proportionalOutputUsd(
            turn.priceEstimate?.outputUsd,
            Math.max(usage.outputTokens, 0),
            nonReasoningOutputTokens,
          ),
          className: 'token-badge-out',
          icon: <TokenOutIcon />,
        }
      : null,
    reasoningOutputTokens > 0
      ? {
          id: 'reason',
          label: 'Reasoning',
          tokenCompactValue: formatCompactTokenCount(reasoningOutputTokens),
          tokenRawValue: reasoningOutputTokens,
          usdCompactValue: turn.priceEstimate
            ? formatDetailedUsd(
                proportionalOutputUsd(
                  turn.priceEstimate.outputUsd,
                  Math.max(usage.outputTokens, 0),
                  reasoningOutputTokens,
                ) ?? 0,
              )
            : '--',
          usdRawValue: proportionalOutputUsd(
            turn.priceEstimate?.outputUsd,
            Math.max(usage.outputTokens, 0),
            reasoningOutputTokens,
          ),
          className: 'token-badge-reason',
          icon: <TokenReasonIcon />,
        }
      : null,
  ];

  return details.filter((detail): detail is TurnTokenDetail => detail !== null);
}

function buildTurnTokenBadges(turn: TimelineTurn) {
  return buildTurnTokenDetails(turn).map((detail) => ({
    id: detail.id,
    label: detail.tokenCompactValue,
    title: `${detail.label}: ${detail.tokenRawValue} tokens`,
    className: detail.className,
    icon: detail.icon,
  }));
}

function buildTurnPriceBadge(turn: TimelineTurn) {
  return {
    label: turn.priceEstimate
      ? formatCompactUsd(turn.priceEstimate.totalUsd)
      : '--',
    title:
      turn.priceEstimate === null || turn.priceEstimate === undefined
        ? 'Price estimate unavailable for this model.'
        : `Estimated cost: ${formatDetailedUsd(turn.priceEstimate.totalUsd)}`,
    className: turn.priceEstimate
      ? 'token-badge-total'
      : 'token-badge-empty',
  };
}

const TURN_HEADER_BADGE_CLASS_NAME =
  'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-normal leading-none sm:text-[11px]';

function TurnTokenSummary({ turn }: { turn: TimelineTurn }) {
  const details = buildTurnTokenDetails(turn);
  const priceBadge = buildTurnPriceBadge(turn);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDesktopOpen, setIsDesktopOpen] = useState(false);
  const [mobilePopoverShift, setMobilePopoverShift] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const desktopPriceRef = useRef<HTMLDivElement | null>(null);
  const mobilePopoverRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!isMobileOpen || details.length === 0) {
      setMobilePopoverShift(0);
      return;
    }

    const updatePopoverShift = () => {
      const anchor = containerRef.current;
      const popover = mobilePopoverRef.current;
      if (!anchor || !popover) {
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const popoverWidth = popover.offsetWidth || popover.getBoundingClientRect().width;
      if (popoverWidth <= 0) {
        return;
      }

      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportPadding = 12;
      const desiredLeft = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
      const minLeft = viewportPadding;
      const maxLeft = Math.max(minLeft, viewportWidth - viewportPadding - popoverWidth);
      const clampedLeft = Math.min(Math.max(desiredLeft, minLeft), maxLeft);
      setMobilePopoverShift(Math.round(clampedLeft - desiredLeft));
    };

    updatePopoverShift();
    window.addEventListener('resize', updatePopoverShift);
    return () => {
      window.removeEventListener('resize', updatePopoverShift);
    };
  }, [details.length, isMobileOpen]);

  useEffect(() => {
    if (!isMobileOpen && !isDesktopOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsMobileOpen(false);
      }

      if (desktopPriceRef.current && !desktopPriceRef.current.contains(event.target)) {
        setIsDesktopOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isDesktopOpen, isMobileOpen]);

  if (!priceBadge && details.length === 0) {
    return null;
  }

  const renderBreakdownPopover = () => (
    <div className="thread-token-popover min-w-[12rem] rounded-2xl border p-2.5 shadow-2xl shadow-black/20 backdrop-blur">
      <div className="space-y-1">
        {details.map((detail) => (
          <div
            key={detail.id}
            className="thread-token-popover-row flex items-center justify-between gap-3 rounded-xl border px-2.5 py-1.5 text-[11px]"
            title={`${detail.label}: ${detail.tokenRawValue} tokens`}
          >
            <span className="thread-token-popover-text inline-flex min-w-0 items-center gap-2">
              <span className="inline-flex shrink-0">{detail.icon}</span>
              <span className="thread-token-popover-strong font-medium">{detail.usdCompactValue}</span>
            </span>
            <span className="thread-token-popover-text shrink-0 font-medium">
              {detail.tokenCompactValue}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div
        className="hidden shrink-0 items-center gap-1.5 md:inline-flex"
      >
        {priceBadge ? (
          <div
            ref={desktopPriceRef}
            className="relative shrink-0"
            onMouseEnter={() => setIsDesktopOpen(true)}
            onMouseLeave={() => setIsDesktopOpen(false)}
          >
            <button
              type="button"
              aria-label="Show token and price details"
              aria-expanded={isDesktopOpen}
              onFocus={() => setIsDesktopOpen(true)}
              onBlur={() => setIsDesktopOpen(false)}
              className={`${TURN_HEADER_BADGE_CLASS_NAME} appearance-none whitespace-nowrap bg-transparent !text-[10px] !font-normal !leading-none transition hover:bg-[var(--theme-hover)] sm:!text-[11px] ${priceBadge.className}`}
              title={priceBadge.title}
            >
              {priceBadge.label}
            </button>
            {isDesktopOpen && details.length > 0 ? (
              <div className="absolute left-1/2 top-full z-30 mt-1.5 -translate-x-1/2">
                {renderBreakdownPopover()}
              </div>
            ) : null}
          </div>
        ) : null}
        {details.map((detail) => (
          <span
            key={detail.id}
            className={`${TURN_HEADER_BADGE_CLASS_NAME} ${detail.className}`}
            title={`${detail.label}: ${detail.usdCompactValue}, ${detail.tokenRawValue} tokens`}
          >
            {detail.icon}
            <span className="font-medium text-stone-100">{detail.tokenCompactValue}</span>
          </span>
        ))}
      </div>
      <div ref={containerRef} className="relative shrink-0 md:hidden">
        {priceBadge ? (
          <button
            type="button"
            aria-label="Show token and price details"
            aria-expanded={isMobileOpen}
            onClick={() => setIsMobileOpen((current) => !current)}
            className={`${TURN_HEADER_BADGE_CLASS_NAME} appearance-none whitespace-nowrap bg-transparent !text-[10px] !font-normal !leading-none transition hover:bg-[var(--theme-hover)] sm:!text-[11px] ${priceBadge.className}`}
            title={priceBadge.title}
          >
            {priceBadge.label}
          </button>
        ) : null}
        {isMobileOpen && details.length > 0 ? (
          <div
            ref={mobilePopoverRef}
            className="absolute left-1/2 top-full z-30 mt-1.5"
            style={{ transform: `translateX(${mobilePopoverShift}px) translateX(-50%)` }}
          >
            {renderBreakdownPopover()}
          </div>
        ) : null}
      </div>
    </>
  );
}

function formatTurnRuntimeSummary(turn: TimelineTurn) {
  const modelLabel = turn.model?.trim() ? turn.model.trim() : '--';
  let reasoningLabel = '--';

  if (turn.reasoningEffortAvailable === null || turn.reasoningEffortAvailable === undefined) {
    reasoningLabel = '--';
  } else if (turn.reasoningEffortAvailable === false) {
    reasoningLabel = '-';
  } else {
    reasoningLabel = turn.reasoningEffort ?? '--';
  }

  return [modelLabel, reasoningLabel].join(' · ');
}

const HistoryItemRow = memo(function HistoryItemRow({
  threadId,
  item,
  scrollRootRef,
  onOpenExpandedText,
  onOpenCommandDetail,
  onOpenToolCallDetail,
  onOpenDeferredHistoryItemDetail,
  onSelectArtifact,
  adapter,
  timeLabel,
  timeTitle,
}: {
  threadId: string | undefined;
  item: ThreadHistoryItemDto;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  timeLabel?: string | null | undefined;
  timeTitle?: string | null | undefined;
  onOpenExpandedText: (title: string, text: string) => void;
  onOpenCommandDetail: (
    item: ThreadHistoryItemDto & { kind: 'commandExecution' },
    title: string,
  ) => void;
  onOpenToolCallDetail: (
    item: ThreadHistoryItemDto & {
      kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
    },
    title: string,
  ) => void;
  onOpenDeferredHistoryItemDetail: (
    item: ThreadHistoryItemDto,
    title: string,
    fallbackText: string,
    loadingText: string,
    errorText: string,
  ) => void;
  onSelectArtifact?: ThreadTimelineProps['onSelectArtifact'];
  adapter?: ThreadTimelineAdapter | undefined;
}) {
  if (isCompactChatItem(item.kind)) {
    return (
      <CompactMessageItem
        threadId={threadId}
        item={
          item as ThreadHistoryItemDto & {
            kind: 'userMessage' | 'agentMessage';
          }
        }
        scrollRootRef={scrollRootRef}
        timeLabel={timeLabel}
        timeTitle={timeTitle}
        {...(adapter ? { adapter } : {})}
      />
    );
  }

  if (item.kind === 'artifact') {
    return (
      <ArtifactHistoryItem
        item={
          item as ThreadHistoryItemDto & {
            kind: 'artifact';
          }
        }
        {...(onSelectArtifact
          ? {
              onSelect: (nextItem, artifact) =>
                onSelectArtifact({ item: nextItem, artifact }),
            }
          : {})}
      />
    );
  }

  if (item.kind === 'commandExecution') {
    return (
      <CommandItem
        item={
          item as ThreadHistoryItemDto & {
            kind: 'commandExecution';
          }
        }
        onOpen={onOpenCommandDetail}
      />
    );
  }

  if (item.kind === 'toolCall') {
    return (
      <ToolCallItem
        item={
          item as ThreadHistoryItemDto & {
            kind: 'toolCall';
          }
        }
        onOpen={onOpenToolCallDetail}
      />
    );
  }

  if (item.kind === 'agentToolCall') {
    return (
      <AgentToolCallItem
        item={
          item as ThreadHistoryItemDto & {
            kind: 'agentToolCall';
          }
        }
        onOpen={onOpenToolCallDetail}
      />
    );
  }

  if (item.kind === 'skillToolCall') {
    return (
      <SkillToolCallItem
        item={
          item as ThreadHistoryItemDto & {
            kind: 'skillToolCall';
          }
        }
        onOpen={onOpenToolCallDetail}
      />
    );
  }

  if (item.kind === 'webSearch') {
    const typedItem = item as ThreadHistoryItemDto & {
      kind: 'webSearch';
    };
    const detailText = typedItem.detailText?.trim() || typedItem.text || 'Web search';
    return (
      <WebSearchItem
        item={typedItem}
        onOpen={() =>
          onOpenDeferredHistoryItemDetail(
            typedItem,
            'Web Search Details',
            detailText,
            'Loading full web search details...',
            'Unable to load full web search details.',
          )
        }
      />
    );
  }

  if (item.kind === 'fileRead') {
    const typedItem = item as ThreadHistoryItemDto & {
      kind: 'fileRead';
    };
    const detailText = typedItem.detailText?.trim() || typedItem.text || 'File read';
    return (
      <FileReadItem
        item={typedItem}
        onOpen={() =>
          onOpenDeferredHistoryItemDetail(
            typedItem,
            'File Read Details',
            detailText,
            'Loading full file read details...',
            'Unable to load full file read details.',
          )
        }
      />
    );
  }

  if (item.kind === 'image') {
    return (
      <ImageItem
        threadId={threadId}
        item={
          item as ThreadHistoryItemDto & {
            kind: 'image';
          }
        }
        onOpen={onOpenExpandedText}
        getImageAssetUrl={adapter?.getImageAssetUrl}
      />
    );
  }

  if (item.kind === 'plan') {
    return (
      <PlanHistoryItem
        item={
          item as ThreadHistoryItemDto & {
            kind: 'plan';
          }
        }
        scrollRootRef={scrollRootRef}
      />
    );
  }

  if (item.kind === 'fileChange') {
    const typedItem = item as ThreadHistoryItemDto & {
      kind: 'fileChange';
    };
    const detailText = typedItem.detailText?.trim() || typedItem.text || 'File change';
    return (
      <FileChangeItem
        item={typedItem}
        onOpen={() =>
          onOpenDeferredHistoryItemDetail(
            typedItem,
            'File Change Details',
            detailText,
            'Loading full file change details...',
            'Unable to load full file change details.',
          )
        }
      />
    );
  }

  if (item.kind === 'contextCompaction') {
    return (
      <ContextCompactionItem
        item={
          item as ThreadHistoryItemDto & {
            kind: 'contextCompaction';
          }
        }
      />
    );
  }

  if (item.kind === 'hook') {
    return (
      <HookItem
        item={
          item as ThreadHistoryItemDto & {
            kind: 'hook';
          }
        }
      />
    );
  }

  return <GenericHistoryItem item={item} />;
});

function PendingRequestCard({
  request,
  busy = false,
  onRespond,
}: {
  request: ThreadActionRequestDto;
  busy?: boolean;
  onRespond?: ((
    requestId: string,
    input: RespondThreadActionRequestInput,
  ) => Promise<void> | void) | undefined;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [selectedPlanDecision, setSelectedPlanDecision] = useState<string | null>(null);
  const primaryQuestion = request.questions[0] ?? null;
  const OTHER_SENTINEL = '__other__';
  const cardTitle =
    request.kind === 'planDecision'
      ? 'Plan'
      : request.kind === 'requestUserInput'
        ? 'Answer Required'
        : request.title;

  function getOptionPresentation(label: string) {
    const recommended = /\s*\(recommended\)\s*$/i.test(label);
    return {
      rawLabel: label,
      displayLabel: label.replace(/\s*\(recommended\)\s*$/i, '').trim(),
      recommended,
    };
  }

  function respondWithSingleAnswer(answer: string) {
    if (!primaryQuestion) {
      return;
    }

    setSelectedPlanDecision(answer);
    void onRespond?.(request.id, {
      answers: {
        [primaryQuestion.id]: {
          answers: [answer],
        },
      },
    });
  }

  function currentAnswerForQuestion(question: ThreadActionRequestDto['questions'][number]) {
    const selected = answers[question.id] ?? '';
    if (Array.isArray(selected)) {
      return selected
        .map((answer) =>
          answer === OTHER_SENTINEL
            ? (customAnswers[question.id] ?? '').trim()
            : answer.trim(),
        )
        .filter(Boolean)
        .join(', ');
    }
    if (selected === OTHER_SENTINEL) {
      return (customAnswers[question.id] ?? '').trim();
    }

    return selected.trim();
  }

  function currentAnswersForQuestion(question: ThreadActionRequestDto['questions'][number]) {
    const selected = answers[question.id] ?? '';
    if (Array.isArray(selected)) {
      return selected
        .map((answer) =>
          answer === OTHER_SENTINEL
            ? (customAnswers[question.id] ?? '').trim()
            : answer.trim(),
        )
        .filter(Boolean);
    }
    if (selected === OTHER_SENTINEL) {
      const customAnswer = (customAnswers[question.id] ?? '').trim();
      return customAnswer ? [customAnswer] : [];
    }
    const singleAnswer = selected.trim();
    return singleAnswer ? [singleAnswer] : [];
  }

  function toggleMultiSelectAnswer(questionId: string, label: string) {
    setAnswers((current) => {
      const currentAnswers = current[questionId];
      const selectedAnswers = Array.isArray(currentAnswers) ? currentAnswers : [];
      const nextAnswers = selectedAnswers.includes(label)
        ? selectedAnswers.filter((entry) => entry !== label)
        : [...selectedAnswers, label];
      return {
        ...current,
        [questionId]: nextAnswers,
      };
    });
  }

  return (
    <div className="timeline-pending-card w-full rounded-[1rem] border px-3 py-3 sm:rounded-[1.2rem] sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="timeline-primary-text text-sm font-medium">{cardTitle}</p>
          {request.kind !== 'planDecision' && request.description && (
            <p className="timeline-soft-text mt-1 text-[13px] leading-5">{request.description}</p>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {request.questions.map((question) => (
          <div
            key={question.id}
            className="timeline-question-section rounded-xl border p-2.5 sm:p-3"
          >
            <p className="timeline-meta-text text-xs uppercase tracking-[0.2em]">
              {question.header}
            </p>
            <p className="timeline-primary-text mt-1 text-[13px] leading-5 sm:text-sm">
              {question.question}
            </p>
            {request.kind === 'planDecision' && question.options && question.options.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {question.options.map((option, index) => {
                  const presentation = getOptionPresentation(option.label);
                  const isImplement =
                    presentation.displayLabel.toLowerCase() === 'implement';
                  return (
                    <button
                      key={option.label}
                      type="button"
                      disabled={busy}
                      onClick={() => respondWithSingleAnswer(option.label)}
                      className={`relative rounded-2xl border px-2.5 py-1.5 pr-6 text-[12px] leading-4 transition sm:text-[13px] ${
                        index === 0
                          ? 'ui-action-info'
                          : 'border-stone-700 text-stone-200 hover:bg-stone-800'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                      title={option.description}
                    >
                      {presentation.recommended ? (
                        <span
                          aria-hidden="true"
                          className="absolute right-1.5 top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/18 text-[10px] leading-none text-current"
                        >
                          ✦
                        </span>
                      ) : null}
                      {busy && selectedPlanDecision === option.label
                        ? isImplement
                          ? 'Starting...'
                          : 'Saving...'
                        : presentation.displayLabel}
                    </button>
                  );
                })}
              </div>
            ) : question.options && question.options.length > 0 ? (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  {question.options.map((option) => {
                    const presentation = getOptionPresentation(option.label);
                    const selectedAnswer = answers[question.id];
                    return (
                      <button
                        key={option.label}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          question.multiSelect
                            ? toggleMultiSelectAnswer(question.id, option.label)
                            : setAnswers((current) => ({
                                ...current,
                                [question.id]: option.label,
                              }))
                        }
                        className={`relative rounded-2xl border px-3 py-1.5 pr-6 text-[12px] leading-4 transition sm:text-[13px] ${
                          (question.multiSelect
                            ? Array.isArray(selectedAnswer) &&
                              selectedAnswer.includes(option.label)
                            : selectedAnswer === option.label)
                            ? 'ui-status-warning'
                            : 'border-stone-700 text-stone-300 hover:bg-stone-800'
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                        title={option.description}
                      >
                        {presentation.recommended ? (
                          <span
                            aria-hidden="true"
                            className="absolute right-1.5 top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/10 text-[10px] leading-none text-amber-100/90"
                          >
                            ✦
                          </span>
                        ) : null}
                        {presentation.displayLabel}
                      </button>
                    );
                  })}
                  {question.isOther && (
                    (() => {
                      const selectedAnswer = answers[question.id];
                      return (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            question.multiSelect
                              ? toggleMultiSelectAnswer(question.id, OTHER_SENTINEL)
                              : setAnswers((current) => ({
                                  ...current,
                                  [question.id]: OTHER_SENTINEL,
                                }))
                          }
                          className={`rounded-2xl border px-3 py-1.5 text-[12px] leading-4 transition sm:text-[13px] ${
                            (question.multiSelect
                              ? Array.isArray(selectedAnswer) &&
                                selectedAnswer.includes(OTHER_SENTINEL)
                              : selectedAnswer === OTHER_SENTINEL)
                              ? 'ui-status-info'
                              : 'border-stone-700 text-stone-300 hover:bg-stone-800'
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          Not from above
                        </button>
                      );
                    })()
                  )}
                </div>
                {question.isOther &&
                  (() => {
                    const selectedAnswer = answers[question.id];
                    const showOtherInput = question.multiSelect
                      ? Array.isArray(selectedAnswer) &&
                        selectedAnswer.includes(OTHER_SENTINEL)
                      : selectedAnswer === OTHER_SENTINEL;
                    return showOtherInput ? (
                      <input
                        aria-label={`${question.header} custom answer`}
                        value={customAnswers[question.id] ?? ''}
                        onChange={(event) =>
                          setCustomAnswers((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                        placeholder="Enter a custom answer"
                        className="mt-3 w-full rounded-xl border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-sky-300"
                      />
                    ) : null;
                  })()}
              </>
            ) : (
              <input
                aria-label={question.header}
                value={answers[question.id] ?? ''}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))
                }
                className="mt-3 w-full rounded-xl border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-amber-300"
              />
            )}
          </div>
        ))}
      </div>
      {request.kind !== 'planDecision' && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={
              busy ||
              request.questions.some((question) => !currentAnswerForQuestion(question))
            }
            onClick={() =>
              void onRespond?.(request.id, {
                answers: Object.fromEntries(
                  request.questions.map((question) => [
                    question.id,
                    {
                      answers: currentAnswersForQuestion(question),
                    },
                  ]),
                ),
              })
            }
            className="ui-action-info rounded-full px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed"
          >
            {busy ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      )}
    </div>
  );
}

function AnsweredRequestNote({
  note,
}: {
  note: {
    id: string;
    turnId?: string | null;
    title: string;
    summaryLines: string[];
    createdAt?: string;
  };
}) {
  return (
    <div className="timeline-note-card w-full rounded-2xl border px-3 py-2.5">
      <p className="timeline-meta-text text-[11px] uppercase tracking-[0.2em]">
        {note.title}
      </p>
      <div className="mt-1 space-y-1">
        {note.summaryLines.map((line, index) => (
          <p
            key={`${note.id}-${index}`}
            className="timeline-primary-text text-[13px] leading-5"
          >
            You selected {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function ActivityNoteCard({
  note,
  onOpenThread,
  onOpenLinkedThread,
}: {
  note: ThreadActivityNoteDto;
  onOpenThread?: ((threadId: string) => void) | undefined;
  onOpenLinkedThread?: ((threadId: string) => void) | undefined;
}) {
  const title =
    note.kind === 'forkCreated'
      ? 'Fork'
      : note.kind === 'forkSource'
        ? 'Fork source'
        : 'System';
  const body =
    note.kind === 'forkCreated'
      ? `Thread forked from Turn ${note.turnIndex ?? '?'}`
      : note.kind === 'forkSource'
        ? `Forked from ${note.linkedThreadTitle ?? 'source thread'} at Turn ${note.turnIndex ?? '?'}`
        : note.text ?? '';

  return (
    <div className="timeline-activity-card w-full rounded-2xl border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="timeline-meta-text text-[11px] uppercase tracking-[0.2em]">
          {title}
        </p>
        <time
          dateTime={note.createdAt}
          title={formatLongTimestamp(note.createdAt)}
          className="timeline-meta-text text-[10px]"
        >
          {formatShortTimestamp(note.createdAt)}
        </time>
      </div>
      <p className="timeline-primary-text mt-1 text-[13px] leading-5">{body}</p>
      {note.linkedThreadId ? (
        <button
          type="button"
          onClick={() => {
            const linkedThreadId = note.linkedThreadId;
            if (!linkedThreadId) {
              return;
            }
            onOpenLinkedThread?.(linkedThreadId);
            onOpenThread?.(linkedThreadId);
          }}
          className="relative z-10 mt-2 inline-flex cursor-pointer rounded-full border border-amber-300/30 px-3 py-1.5 text-xs text-amber-100 transition hover:bg-amber-300/10"
        >
          {note.kind === 'forkCreated' ? 'Open fork' : 'Back to source'}
        </button>
      ) : null}
    </div>
  );
}

const ThreadTurnRow = memo(function ThreadTurnRow({
  threadId,
  adapter,
  turn,
  absoluteIndex,
  isCollapsed,
  livePlan,
  liveItems,
  liveOutput,
  forceActive = false,
  onToggleCollapse,
  onOpenExpandedText,
  onOpenCommandDetail,
  onOpenToolCallDetail,
  onOpenDeferredHistoryItemDetail,
  onSelectArtifact,
  scrollRootRef,
  articleRef,
  isLatestVisibleTurn = false,
}: {
  threadId: string | undefined;
  adapter?: ThreadTimelineAdapter | undefined;
  turn: TimelineTurn;
  absoluteIndex: number;
  isCollapsed: boolean;
  livePlan:
    | {
        turnId: string;
        explanation: string | null;
        plan: Array<{ step: string; status: string }>;
      }
    | null;
  liveItems: ThreadHistoryItemDto[] | null;
  liveOutput: string;
  forceActive?: boolean;
  onToggleCollapse: (turnId: string) => void;
  onOpenExpandedText: (title: string, text: string) => void;
  onOpenCommandDetail: (
    item: ThreadHistoryItemDto & { kind: 'commandExecution' },
    title: string,
  ) => void;
  onOpenToolCallDetail: (
    item: ThreadHistoryItemDto & {
      kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
    },
    title: string,
  ) => void;
  onOpenDeferredHistoryItemDetail: (
    item: ThreadHistoryItemDto,
    title: string,
    fallbackText: string,
    loadingText: string,
    errorText: string,
  ) => void;
  onSelectArtifact?: ThreadTimelineProps['onSelectArtifact'];
  scrollRootRef: RefObject<HTMLDivElement | null>;
  articleRef?: RefCallback<HTMLElement> | undefined;
  isLatestVisibleTurn?: boolean;
}) {
  const hasLiveActivity =
    Boolean(livePlan) ||
    Boolean(liveOutput) ||
    Boolean(liveItems && liveItems.length > 0);
  const activeForRendering =
    forceActive || isActiveTurnStatus(turn.status) || hasLiveActivity || isLatestVisibleTurn;
  const activeFooterTurn: TimelineTurn =
    activeForRendering && !isActiveTurnStatus(turn.status)
      ? {
          ...turn,
          status: 'inProgress',
        }
      : turn;
  const mergedItems = useMemo(
    () => mergeLiveTurnItems(turn.items, liveItems),
    [liveItems, turn.items],
  );
  const displayedLivePlan = useMemo(
    () => deriveDisplayedLivePlan(livePlan, mergedItems, turn.status),
    [livePlan, mergedItems, turn.status],
  );
  const visibleLiveOutput = useMemo(
    () => getLiveOutputTailForTurn(liveOutput, mergedItems),
    [liveOutput, mergedItems],
  );
  const preparedItems = useMemo(
    () => prepareTurnItemsForRendering(mergedItems, activeForRendering),
    [activeForRendering, mergedItems],
  );
  const groupedItems = useMemo(() => groupTimelineHistoryItems(preparedItems), [preparedItems]);
  const turnTimeLabel = formatShortTimestamp(turn.startedAt);
  const turnTimeTitle = formatLongTimestamp(turn.startedAt);
  const visibleLiveHookPrompt = useMemo(
    () => parseHookPromptText(visibleLiveOutput),
    [visibleLiveOutput],
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );

  const toggleGroupedItem = useCallback((groupKey: string) => {
    setExpandedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  }, []);

  const historyNode = (
    <TimelineHistoryEntries
        entries={groupedItems}
        expandedGroups={expandedGroups}
        onToggleGroupedItem={toggleGroupedItem}
        threadId={threadId}
        scrollRootRef={scrollRootRef}
        onOpenExpandedText={onOpenExpandedText}
        onOpenCommandDetail={onOpenCommandDetail}
        onOpenToolCallDetail={onOpenToolCallDetail}
        onOpenDeferredHistoryItemDetail={onOpenDeferredHistoryItemDetail}
        timeLabel={turnTimeLabel}
        timeTitle={turnTimeTitle}
        {...(onSelectArtifact ? { onSelectArtifact } : {})}
        {...(adapter ? { adapter } : {})}
      />
  );
  const liveHookPromptNode = visibleLiveHookPrompt ? (
    <HistoryItemRow
      threadId={threadId}
      item={visibleLiveHookPrompt}
      scrollRootRef={scrollRootRef}
      onOpenExpandedText={onOpenExpandedText}
      onOpenCommandDetail={onOpenCommandDetail}
      onOpenToolCallDetail={onOpenToolCallDetail}
      onOpenDeferredHistoryItemDetail={onOpenDeferredHistoryItemDetail}
      timeLabel={turnTimeLabel}
      timeTitle={turnTimeTitle}
      {...(onSelectArtifact ? { onSelectArtifact } : {})}
      {...(adapter ? { adapter } : {})}
    />
  ) : null;
  const liveOutputNode =
    !visibleLiveHookPrompt && visibleLiveOutput ? (
      <CompactMessageItem
        item={{
          id: 'live-agent-message',
          kind: 'agentMessage',
          text: visibleLiveOutput,
        }}
        scrollRootRef={scrollRootRef}
        timeLabel={turnTimeLabel}
        timeTitle={turnTimeTitle}
        streaming
      />
    ) : null;
  const footerNode = activeForRendering ? (
    <TurnStatusBar turn={activeFooterTurn} variant="footer" />
  ) : null;
  const turnBody = (
    <GraphChatTurnBody
      footer={footerNode}
      history={historyNode}
      liveHookPrompt={liveHookPromptNode}
      liveOutput={liveOutputNode}
      livePlan={displayedLivePlan}
    />
  );

  return (
    <GraphChatTurnFrame
      absoluteIndex={absoluteIndex}
      body={turnBody}
      collapsed={isCollapsed}
      error={turn.error}
      headerStatus={<TurnStatusBar turn={turn} />}
      isActive={activeForRendering}
      onToggleCollapse={() => onToggleCollapse(turn.id)}
      refCallback={articleRef}
      startedAt={turn.startedAt}
      timeLabel={turnTimeLabel}
      timeTitle={turnTimeTitle}
      tokenSummary={<TurnTokenSummary turn={turn} />}
    />
  );
});

function TimelineHistoryEntries({
  entries,
  expandedGroups,
  onToggleGroupedItem,
  threadId,
  scrollRootRef,
  onOpenExpandedText,
  onOpenCommandDetail,
  onOpenToolCallDetail,
  onOpenDeferredHistoryItemDetail,
  onSelectArtifact,
  adapter,
  timeLabel,
  timeTitle,
}: {
  entries: TimelineHistoryEntry[];
  expandedGroups: Record<string, boolean>;
  onToggleGroupedItem: (groupKey: string) => void;
  threadId: string | undefined;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  timeLabel?: string | null | undefined;
  timeTitle?: string | null | undefined;
  onOpenExpandedText: (title: string, text: string) => void;
  onOpenCommandDetail: (
    item: ThreadHistoryItemDto & { kind: 'commandExecution' },
    title: string,
  ) => void;
  onOpenToolCallDetail: (
    item: ThreadHistoryItemDto & {
      kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
    },
    title: string,
  ) => void;
  onOpenDeferredHistoryItemDetail: (
    item: ThreadHistoryItemDto,
    title: string,
    fallbackText: string,
    loadingText: string,
    errorText: string,
  ) => void;
  onSelectArtifact?: ThreadTimelineProps['onSelectArtifact'];
  adapter?: ThreadTimelineAdapter | undefined;
}) {
  return (
    <GraphChatHistoryEntries<TimelineHistoryEntry>
      entries={entries}
      expandedGroups={expandedGroups}
      onToggleGroupedItem={onToggleGroupedItem}
      renderCommandGroup={(entry, expanded, onToggleExpanded) => (
        <CommandGroupItem
          key={entry.key}
          items={entry.items}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          onOpen={onOpenCommandDetail}
        />
      )}
      renderFileChangeGroup={(entry, expanded, onToggleExpanded) => (
        <FileChangeGroupItem
          key={entry.key}
          items={entry.items}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          onOpen={onOpenExpandedText}
        />
      )}
      renderSearchGroup={(entry, expanded, onToggleExpanded) => (
        <SearchGroupItem
          key={entry.key}
          items={entry.items}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          onOpen={onOpenExpandedText}
        />
      )}
      renderFileReadGroup={(entry, expanded, onToggleExpanded) => (
        <FileReadGroupItem
          key={entry.key}
          items={entry.items}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          onOpen={onOpenExpandedText}
        />
      )}
      renderItem={(entry) => (
        <HistoryItemRow
          key={entry.key}
          threadId={threadId}
          item={entry.item}
          scrollRootRef={scrollRootRef}
          timeLabel={timeLabel}
          timeTitle={timeTitle}
          onOpenExpandedText={onOpenExpandedText}
          onOpenCommandDetail={onOpenCommandDetail}
          onOpenToolCallDetail={onOpenToolCallDetail}
          onOpenDeferredHistoryItemDetail={onOpenDeferredHistoryItemDetail}
          {...(onSelectArtifact ? { onSelectArtifact } : {})}
          {...(adapter ? { adapter } : {})}
        />
      )}
    />
  );
}

function ThreadTimelineComponent({
  threadId,
  turns,
  totalTurnCount,
  pendingRequests = [],
  activeTurnId = null,
  threadRunning = false,
  pendingSteers = [],
  livePlan = null,
  liveItems = null,
  respondingRequestId = null,
  onRespondToRequest,
  liveOutput,
  scrollRequestKey = 0,
  bottomSpacer = 0,
  className = '',
  onTailVisibilityChange,
  loadingEarlier = false,
  onLoadEarlier,
  ephemeralUserNote = null,
  answeredRequestNotes = [],
  activityNotes = [],
  optimisticSteers = [],
  optimisticTurn = null,
  onLoadHistoryItemDetail,
  onOpenThread,
  onSelectArtifact,
  onSelectHistoryItemDetail,
  adapter,
}: ThreadTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  const lastHandledScrollRequestKeyRef = useRef(scrollRequestKey);
  const previousContentRevisionRef = useRef<number | null>(null);
  const previousBottomSpacerRef = useRef(bottomSpacer);
  const lastObservedScrollHeightRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const tailSentinelRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const isTailVisibleRef = useRef(true);
  const shouldStickToBottomRef = useRef(true);
  const userScrolledAwayFromTailRef = useRef(false);
  const userScrolledHistoryRef = useRef(false);
  const autoLoadedEarlierRef = useRef(false);
  const expandedTextRequestIdRef = useRef(0);
  const deferredDetailCacheRef = useRef<Map<string, ThreadHistoryItemDetailDto>>(
    new Map(),
  );
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_TURNS);
  const [loadMoreClicks, setLoadMoreClicks] = useState(0);
  const [expandedText, setExpandedText] = useState<ExpandedTextState | null>(null);
  const [collapsedTurns, setCollapsedTurns] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedLooseGroups, setExpandedLooseGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [isTailVisible, setIsTailVisible] = useState(true);
  const loadHistoryItemDetail =
    adapter?.onLoadHistoryItemDetail ?? onLoadHistoryItemDetail;
  const openLinkedThread = adapter?.onOpenLinkedThread;
  const contentRevision = useChangeRevision([
    turns,
    pendingRequests,
    pendingSteers,
    optimisticSteers,
    liveOutput,
    livePlan,
    liveItems,
    optimisticTurn,
    answeredRequestNotes,
    activityNotes,
    ephemeralUserNote,
    bottomSpacer,
  ]);
  const serverManagedHistory =
    typeof onLoadEarlier === 'function' ||
    totalTurnCount !== undefined;

  const handleToggleCollapse = useCallback((turnId: string) => {
    setCollapsedTurns((current) => ({
      ...current,
      [turnId]: !current[turnId],
    }));
  }, []);

  const handleToggleLooseGroup = useCallback((groupKey: string) => {
    setExpandedLooseGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  }, []);

  const handleOpenExpandedText = useCallback((title: string, text: string) => {
    setExpandedText({ title, text });
  }, []);

  const handleResolvedHistoryItemDetail = useCallback(
    (item: ThreadHistoryItemDto, detail: ThreadHistoryItemDetailDto) => {
      if (onSelectHistoryItemDetail) {
        onSelectHistoryItemDetail({ item, detail });
        return;
      }
      setExpandedText({ title: detail.title, text: detail.text });
    },
    [onSelectHistoryItemDetail],
  );

  const handleOpenCommandDetail = useCallback(
    async (
      item: ThreadHistoryItemDto & { kind: 'commandExecution' },
      fallbackTitle: string,
    ) => {
      const inlineText = item.detailText?.trim() || item.text || 'Command output';
      if (!item.hasDeferredDetail || !loadHistoryItemDetail) {
        handleResolvedHistoryItemDetail(item, {
          id: item.id,
          kind: item.kind,
          title: fallbackTitle,
          text: inlineText,
        });
        return;
      }

      const cached = deferredDetailCacheRef.current.get(item.id);
      if (cached) {
        handleResolvedHistoryItemDetail(item, cached);
        return;
      }

      const requestId = expandedTextRequestIdRef.current + 1;
      expandedTextRequestIdRef.current = requestId;
      if (!onSelectHistoryItemDetail) {
        setExpandedText({ title: fallbackTitle, text: 'Loading full command output...' });
      }

      try {
        const detail = await loadHistoryItemDetail(item.id);
        deferredDetailCacheRef.current.set(item.id, detail);
        if (expandedTextRequestIdRef.current !== requestId) {
          return;
        }
        handleResolvedHistoryItemDetail(item, detail);
      } catch (caught) {
        if (expandedTextRequestIdRef.current !== requestId) {
          return;
        }
        const text =
          caught instanceof Error
            ? caught.message
            : 'Unable to load full command output.';
        handleResolvedHistoryItemDetail(item, {
          id: item.id,
          kind: item.kind,
          title: fallbackTitle,
          text,
        });
      }
    },
    [handleResolvedHistoryItemDetail, loadHistoryItemDetail, onSelectHistoryItemDetail],
  );

  const handleOpenToolCallDetail = useCallback(
    async (
      item: ThreadHistoryItemDto & {
        kind: 'toolCall' | 'agentToolCall' | 'skillToolCall';
      },
      fallbackTitle: string,
    ) => {
      const inlineText = item.detailText?.trim() || item.text || 'Tool call';
      if (!item.hasDeferredDetail || !loadHistoryItemDetail) {
        handleResolvedHistoryItemDetail(item, {
          id: item.id,
          kind: item.kind,
          title: fallbackTitle,
          text: inlineText,
        });
        return;
      }

      const cached = deferredDetailCacheRef.current.get(item.id);
      if (cached) {
        handleResolvedHistoryItemDetail(item, cached);
        return;
      }

      const requestId = expandedTextRequestIdRef.current + 1;
      expandedTextRequestIdRef.current = requestId;
      if (!onSelectHistoryItemDetail) {
        setExpandedText({ title: fallbackTitle, text: 'Loading full tool call details...' });
      }

      try {
        const detail = await loadHistoryItemDetail(item.id);
        deferredDetailCacheRef.current.set(item.id, detail);
        if (expandedTextRequestIdRef.current !== requestId) {
          return;
        }
        handleResolvedHistoryItemDetail(item, detail);
      } catch (caught) {
        if (expandedTextRequestIdRef.current !== requestId) {
          return;
        }
        const text =
          caught instanceof Error
            ? caught.message
            : 'Unable to load full tool call details.';
        handleResolvedHistoryItemDetail(item, {
          id: item.id,
          kind: item.kind,
          title: fallbackTitle,
          text,
        });
      }
    },
    [handleResolvedHistoryItemDetail, loadHistoryItemDetail, onSelectHistoryItemDetail],
  );

  const handleOpenDeferredHistoryItemDetail = useCallback(
    async (
      item: ThreadHistoryItemDto,
      fallbackTitle: string,
      fallbackText: string,
      loadingText: string,
      errorText: string,
    ) => {
      if (!item.hasDeferredDetail || !loadHistoryItemDetail) {
        setExpandedText({ title: fallbackTitle, text: fallbackText });
        return;
      }

      const cached = deferredDetailCacheRef.current.get(item.id);
      if (cached) {
        setExpandedText({ title: cached.title, text: cached.text });
        return;
      }

      const requestId = expandedTextRequestIdRef.current + 1;
      expandedTextRequestIdRef.current = requestId;
      setExpandedText({ title: fallbackTitle, text: loadingText });

      try {
        const detail = await loadHistoryItemDetail(item.id);
        deferredDetailCacheRef.current.set(item.id, detail);
        if (expandedTextRequestIdRef.current !== requestId) {
          return;
        }
        setExpandedText({ title: detail.title, text: detail.text });
      } catch (caught) {
        if (expandedTextRequestIdRef.current !== requestId) {
          return;
        }
        setExpandedText({
          title: fallbackTitle,
          text: caught instanceof Error ? caught.message : errorText,
        });
      }
    },
    [loadHistoryItemDetail],
  );

  const recomputeTailVisibility = useCallback(() => {
    const container = scrollContainerRef.current;
    const tailSentinel = tailSentinelRef.current;
    if (!container) {
      return;
    }

    const nextIsTailVisible =
      tailSentinel
        ? isElementVisible(container, tailSentinel)
        : isNearBottom(container);
    isTailVisibleRef.current = nextIsTailVisible;
    setIsTailVisible((current) =>
      current === nextIsTailVisible ? current : nextIsTailVisible,
    );
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      userScrolledHistoryRef.current = true;
      const nextScrollTop = container.scrollTop;
      const previousScrollTop = lastScrollTopRef.current;
      const delta = nextScrollTop - previousScrollTop;
      lastScrollTopRef.current = nextScrollTop;

      if (isNearBottom(container, 1)) {
        userScrolledAwayFromTailRef.current = false;
        shouldStickToBottomRef.current = true;
      } else if (delta < -1) {
        userScrolledAwayFromTailRef.current = true;
        shouldStickToBottomRef.current = false;
      } else if (delta > 1) {
        shouldStickToBottomRef.current =
          !userScrolledAwayFromTailRef.current &&
          isNearBottom(container, FOLLOW_TAIL_THRESHOLD_PX);
      }
    }
    recomputeTailVisibility();
  }, [recomputeTailVisibility]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
    lastScrollTopRef.current = container.scrollTop;
    lastObservedScrollHeightRef.current = container.scrollHeight;
    isTailVisibleRef.current = true;
    setIsTailVisible((current) => (current ? current : true));
    userScrolledAwayFromTailRef.current = false;
    shouldStickToBottomRef.current = true;
  }, []);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [threadId, scrollToBottom]);

  useEffect(() => {
    autoLoadedEarlierRef.current = false;
    userScrolledHistoryRef.current = false;
  }, [threadId]);

  useEffect(() => {
    setVisibleCount((current) => {
      if (current >= turns.length - 1) {
        return turns.length;
      }

      return Math.max(current, INITIAL_VISIBLE_TURNS);
    });
  }, [turns.length]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      lastObservedScrollHeightRef.current = container.scrollHeight;
      lastScrollTopRef.current = container.scrollTop;
      if (isNearBottom(container, 1)) {
        userScrolledAwayFromTailRef.current = false;
        shouldStickToBottomRef.current = true;
      } else if (
        userScrolledAwayFromTailRef.current ||
        !isNearBottom(container, FOLLOW_TAIL_THRESHOLD_PX)
      ) {
        shouldStickToBottomRef.current = false;
      }
    }
    recomputeTailVisibility();
  }, [
    bottomSpacer,
    answeredRequestNotes,
    ephemeralUserNote,
    liveOutput,
    liveItems,
    livePlan,
    pendingRequests.length,
    recomputeTailVisibility,
    turns.length,
    visibleCount,
  ]);

  useEffect(() => {
    const shouldForceScroll =
      scrollRequestKey !== lastHandledScrollRequestKeyRef.current;
    const contentChanged = previousContentRevisionRef.current !== contentRevision;
    previousContentRevisionRef.current = contentRevision;
    const shouldAutoScroll =
      shouldForceScroll ||
      (
        contentChanged &&
        shouldStickToBottomRef.current &&
        !userScrolledAwayFromTailRef.current
      );

    if (!shouldAutoScroll) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
    });

    if (scrollRequestKey !== lastHandledScrollRequestKeyRef.current) {
      lastHandledScrollRequestKeyRef.current = scrollRequestKey;
    }

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    contentRevision,
    isTailVisible,
    scrollToBottom,
    scrollRequestKey,
  ]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = scrollContentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') {
      return;
    }

    lastObservedScrollHeightRef.current = container.scrollHeight;
    const observer = new ResizeObserver(() => {
      const nextScrollHeight = container.scrollHeight;
      const previousScrollHeight = lastObservedScrollHeightRef.current;
      lastObservedScrollHeightRef.current = nextScrollHeight;

      if (nextScrollHeight <= previousScrollHeight) {
        return;
      }

      const wasAtBottomBeforeResize =
        previousScrollHeight > 0 &&
        previousScrollHeight - container.scrollTop - container.clientHeight <= 1;
      if (
        userScrolledAwayFromTailRef.current ||
        !(
          shouldStickToBottomRef.current ||
          wasAtBottomBeforeResize ||
          isTailVisibleRef.current
        )
      ) {
        return;
      }

      window.requestAnimationFrame(() => {
        scrollToBottom();
      });
    });

    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [scrollToBottom]);

  useEffect(() => {
    if (!shouldStickToBottomRef.current || userScrolledAwayFromTailRef.current) {
      previousBottomSpacerRef.current = bottomSpacer;
      return;
    }

    if (bottomSpacer === previousBottomSpacerRef.current) {
      return;
    }

    previousBottomSpacerRef.current = bottomSpacer;
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [bottomSpacer, scrollToBottom]);

  useEffect(() => {
    onTailVisibilityChange?.(isTailVisible);
  }, [isTailVisible, onTailVisibilityChange]);

  const effectiveTotalTurnCount = totalTurnCount ?? turns.length;
  const startIndex = serverManagedHistory
    ? 0
    : Math.max(0, turns.length - visibleCount);
  const loadedTurnAbsoluteOffset = serverManagedHistory
    ? Math.max(0, effectiveTotalTurnCount - turns.length)
    : 0;
  const visibleTurns = serverManagedHistory ? turns : turns.slice(startIndex);
  const visibleTurnAbsoluteOffset = loadedTurnAbsoluteOffset + startIndex;
  const optimisticAbsoluteIndex = effectiveTotalTurnCount + 1;
  const loadedHiddenCount = serverManagedHistory
    ? 0
    : turns.length - visibleTurns.length;
  const unloadedHiddenCount = serverManagedHistory
    ? Math.max(0, effectiveTotalTurnCount - turns.length)
    : 0;
  const hiddenCount = serverManagedHistory
    ? unloadedHiddenCount + loadedHiddenCount
    : loadedHiddenCount;
  const showLoadAll = !serverManagedHistory && hiddenCount > 0 && loadMoreClicks >= 2;
  const canLoadEarlierFromServer =
    serverManagedHistory &&
    unloadedHiddenCount > 0 &&
    loadedHiddenCount === 0 &&
    typeof onLoadEarlier === 'function';

  useEffect(() => {
    const container = scrollContainerRef.current;
    const topSentinel = topSentinelRef.current;
    if (
      !container ||
      !topSentinel ||
      !canLoadEarlierFromServer ||
      loadingEarlier ||
      autoLoadedEarlierRef.current ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          !userScrolledHistoryRef.current ||
          loadingEarlier ||
          autoLoadedEarlierRef.current ||
          !entries.some((entry) => entry.isIntersecting)
        ) {
          return;
        }

        autoLoadedEarlierRef.current = true;
        onLoadEarlier?.();
      },
      {
        root: container,
        threshold: 0.01,
      },
    );

    observer.observe(topSentinel);
    return () => {
      observer.disconnect();
    };
  }, [canLoadEarlierFromServer, loadingEarlier, onLoadEarlier]);
  const forceLatestTurnActive =
    threadRunning &&
    (
      !activeTurnId ||
      (
        !visibleTurns.some((turn) => turn.id === activeTurnId) &&
        optimisticTurn?.id !== activeTurnId
      )
    );
  const latestVisibleTurnId =
    optimisticTurn?.id ?? visibleTurns.at(-1)?.id ?? null;
  const shouldForceLatestVisibleTurnActive =
    forceLatestTurnActive && latestVisibleTurnId !== null;
  const liveItemsAttachedToVisibleTurn =
    !!liveItems &&
    (visibleTurns.some((turn) => turn.id === liveItems.turnId) ||
      optimisticTurn?.id === liveItems.turnId);
  const liveItemsTargetTurnId =
    liveItems && liveItemsAttachedToVisibleTurn
      ? liveItems.turnId
      : liveItems && shouldForceLatestVisibleTurnActive
        ? latestVisibleTurnId
        : null;
  const optimisticLiveItems =
    optimisticTurn && liveItemsTargetTurnId === optimisticTurn.id
      ? liveItems?.items ?? null
      : null;
  const hasStructuredLiveItems = (liveItems?.items.length ?? 0) > 0;
  const unattachedLiveItems =
    liveItems && liveItemsTargetTurnId === null ? liveItems.items : null;
  const unattachedLiveEntries = useMemo(
    () => groupTimelineHistoryItems(unattachedLiveItems ?? []),
    [unattachedLiveItems],
  );
  const liveOutputAttachedToOptimisticTurn =
    !!liveOutput &&
    !!optimisticTurn &&
    optimisticTurn.status !== 'failed' &&
    !optimisticLiveItems;
  const liveOutputTargetTurnId =
    liveOutput && visibleTurns.length > 0
      ? (
          activeTurnId && visibleTurns.some((turn) => turn.id === activeTurnId)
            ? activeTurnId
            : visibleTurns.findLast((turn) => isRunningHistoryStatus(turn.status))?.id ??
              (shouldForceLatestVisibleTurnActive ? latestVisibleTurnId : null)
        )
      : null;
  const liveOutputAttachedToVisibleTurn = Boolean(liveOutputTargetTurnId);
  const visibleTurnIds = new Set(visibleTurns.map((turn) => turn.id));
  const notesByTurnId = answeredRequestNotes.reduce<Map<string, typeof answeredRequestNotes>>(
    (map, note) => {
      if (!note.turnId || !visibleTurnIds.has(note.turnId)) {
        return map;
      }
      const current = map.get(note.turnId) ?? [];
      current.push(note);
      map.set(note.turnId, current);
      return map;
    },
    new Map(),
  );
  const pendingRequestsByTurnId = pendingRequests.reduce<Map<string, typeof pendingRequests>>(
    (map, request) => {
      if (!request.turnId || !visibleTurnIds.has(request.turnId)) {
        return map;
      }
      const current = map.get(request.turnId) ?? [];
      current.push(request);
      map.set(request.turnId, current);
      return map;
    },
    new Map(),
  );
  const queuedSteers = [
    ...pendingSteers.map((steer) => ({
      id: steer.id,
      prompt: steer.prompt,
      status: 'Accepted',
      createdAt: steer.createdAt,
    })),
    ...optimisticSteers.map((steer) => ({
      id: steer.id,
      prompt: steer.prompt,
      status: steer.status === 'steering' ? 'Steering' : null,
      createdAt: steer.createdAt,
    })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const unanchoredAnsweredNotes = answeredRequestNotes.filter(
    (note) => !note.turnId || !visibleTurnIds.has(note.turnId),
  );
  const unanchoredPendingRequests = pendingRequests.filter(
    (request) => !request.turnId || !visibleTurnIds.has(request.turnId),
  );
  const requestEntryAnchors = useMemo(() => {
    const turnSequence = [
      ...visibleTurns.map((turn) => ({
        id: turn.id,
        startedAt: turn.startedAt ?? '',
      })),
      ...(optimisticTurn
        ? [
            {
              id: optimisticTurn.id,
              startedAt: optimisticTurn.startedAt ?? '',
            },
          ]
        : []),
    ];
    const beforeTurnId = new Map<
      string,
      Array<
        | {
            kind: 'note';
            id: string;
            createdAt: string;
            note: (typeof answeredRequestNotes)[number];
          }
        | {
            kind: 'request';
            id: string;
            createdAt: string;
            request: (typeof pendingRequests)[number];
          }
      >
    >();
    const trailing: Array<
      | {
          kind: 'note';
          id: string;
          createdAt: string;
          note: (typeof answeredRequestNotes)[number];
        }
      | {
          kind: 'request';
          id: string;
          createdAt: string;
          request: (typeof pendingRequests)[number];
        }
    > = [];

    const entries = [
      ...unanchoredAnsweredNotes.map((note) => ({
        kind: 'note' as const,
        id: note.id,
        createdAt: note.createdAt ?? '',
        note,
      })),
      ...unanchoredPendingRequests.map((request) => ({
        kind: 'request' as const,
        id: request.id,
        createdAt: request.createdAt,
        request,
      })),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    for (const entry of entries) {
      const anchor = turnSequence.find(
        (turn) =>
          entry.createdAt &&
          turn.startedAt &&
          entry.createdAt.localeCompare(turn.startedAt) <= 0,
      );
      if (!anchor) {
        trailing.push(entry);
        continue;
      }

      const current = beforeTurnId.get(anchor.id) ?? [];
      current.push(entry);
      beforeTurnId.set(anchor.id, current);
    }

    return {
      beforeTurnId,
      trailing,
    };
  }, [
    optimisticTurn,
    unanchoredAnsweredNotes,
    unanchoredPendingRequests,
    visibleTurns,
  ]);
  const activityNoteAnchors = useMemo(() => {
    const sortedNotes = [...activityNotes].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
    const turnSequence = [
      ...visibleTurns.map((turn) => ({
        id: turn.id,
        startedAt: turn.startedAt ?? '',
      })),
      ...(optimisticTurn
        ? [
            {
              id: optimisticTurn.id,
              startedAt: optimisticTurn.startedAt ?? '',
            },
          ]
        : []),
    ];
    const leading: ThreadActivityNoteDto[] = [];
    const beforeTurnId = new Map<string, ThreadActivityNoteDto[]>();
    const afterTurnId = new Map<string, ThreadActivityNoteDto[]>();
    const trailing: ThreadActivityNoteDto[] = [];
    const knownTurnTimes = turnSequence
      .map((turn) => turn.startedAt)
      .filter((startedAt): startedAt is string => Boolean(startedAt))
      .sort();
    const latestKnownTurnTime = knownTurnTimes.at(-1) ?? null;

    for (const note of sortedNotes) {
      if (note.anchorTurnId === '__leading__') {
        leading.push(note);
        continue;
      }
      if (note.anchorTurnId) {
        if (turnSequence.some((turn) => turn.id === note.anchorTurnId)) {
          const current = afterTurnId.get(note.anchorTurnId) ?? [];
          current.push(note);
          afterTurnId.set(note.anchorTurnId, current);
        } else {
          leading.push(note);
        }
        continue;
      }
      const anchor = turnSequence.find(
        (turn) => turn.startedAt && note.createdAt.localeCompare(turn.startedAt) <= 0,
      );
      if (!anchor) {
        if (!latestKnownTurnTime || note.createdAt.localeCompare(latestKnownTurnTime) <= 0) {
          leading.push(note);
        } else {
          trailing.push(note);
        }
        continue;
      }
      const current = beforeTurnId.get(anchor.id) ?? [];
      current.push(note);
      beforeTurnId.set(anchor.id, current);
    }

    return {
      leading,
      beforeTurnId,
      afterTurnId,
      trailing,
    };
  }, [activityNotes, optimisticTurn, visibleTurns]);

  return (
    <>
      <section className={`flex min-h-0 flex-1 flex-col ${className}`.trim()}>
        <div
          ref={scrollContainerRef}
          data-testid="chat-scroll-container"
          onScroll={handleScroll}
          className="thread-graph-scroll-container min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={bottomSpacer > 0 ? { paddingBottom: bottomSpacer } : undefined}
        >
          <div ref={scrollContentRef} className="thread-graph-scroll-content">
          <div ref={topSentinelRef} aria-hidden="true" className="h-px" />
          {turns.length > 0 && (
            <div className="thread-graph-history-control px-3 pb-1 pt-2 sm:px-5 sm:pb-1.5 sm:pt-3">
              <div className="flex flex-wrap items-center gap-2.5 text-xs sm:text-sm">
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (serverManagedHistory && loadedHiddenCount === 0) {
                        onLoadEarlier?.();
                        return;
                      }

                      setVisibleCount((current) =>
                        Math.min(turns.length, current + LOAD_STEP),
                      );
                      setLoadMoreClicks((current) => current + 1);
                    }}
                    disabled={loadingEarlier}
                    className="thread-graph-history-button rounded-full border px-2.5 py-1.5 transition"
                  >
                    {loadingEarlier ? 'Loading earlier...' : 'Load 10 earlier'}
                  </button>
                )}
                {showLoadAll && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount(turns.length)}
                    className="rounded-full border border-amber-300/40 px-2.5 py-1.5 text-amber-200 transition hover:bg-amber-300/10"
                  >
                    Load full history
                  </button>
                )}
                <p className="timeline-meta-text">
                  Showing {visibleTurns.length} of {effectiveTotalTurnCount} turns
                  {hiddenCount > 0
                    ? ` · ${hiddenCount} earlier hidden${
                        loadedHiddenCount > 0 && unloadedHiddenCount > 0
                          ? ` (${loadedHiddenCount} loaded)`
                          : ''
                      }`
                    : ''}
                </p>
              </div>
            </div>
          )}

          {turns.length === 0 && !liveOutput && !optimisticTurn && (
            <div className="thread-graph-empty-state px-3 py-8 text-sm sm:px-5">
              Send the first prompt to start the thread.
            </div>
          )}

          {(visibleTurns.length > 0 ||
            optimisticTurn ||
            activityNoteAnchors.leading.length > 0 ||
            activityNoteAnchors.trailing.length > 0) && (
            <div className="thread-graph-message-list">
              {activityNoteAnchors.leading.length > 0 ? (
                <div className="thread-graph-message-section space-y-3 px-3 py-4 sm:px-5">
                  {activityNoteAnchors.leading.map((note) => (
                    <ActivityNoteCard key={note.id} note={note} onOpenThread={onOpenThread} onOpenLinkedThread={openLinkedThread} />
                  ))}
                </div>
              ) : null}
              {visibleTurns.map((turn, visibleIndex) => (
                <div key={turn.id}>
                  {(activityNoteAnchors.beforeTurnId.get(turn.id)?.length ?? 0) > 0 ? (
                    <div className="thread-graph-message-section space-y-3 px-3 py-4 sm:px-5">
                      {(activityNoteAnchors.beforeTurnId.get(turn.id) ?? []).map((note) => (
                        <ActivityNoteCard key={note.id} note={note} onOpenThread={onOpenThread} onOpenLinkedThread={openLinkedThread} />
                      ))}
                    </div>
                  ) : null}
                  {(requestEntryAnchors.beforeTurnId.get(turn.id)?.length ?? 0) > 0 ? (
                    <div className="thread-graph-message-section space-y-3 px-3 py-4 sm:px-5">
                      {(requestEntryAnchors.beforeTurnId.get(turn.id) ?? []).map((entry) =>
                        entry.kind === 'note' ? (
                          <AnsweredRequestNote key={entry.id} note={entry.note} />
                        ) : (
                          <PendingRequestCard
                            key={entry.id}
                            request={entry.request}
                            busy={respondingRequestId === entry.request.id}
                            onRespond={onRespondToRequest ?? undefined}
                          />
                        ),
                      )}
                    </div>
                  ) : null}
                  <ThreadTurnRow
                    threadId={threadId}
                    {...(adapter ? { adapter } : {})}
                    turn={turn}
                    absoluteIndex={visibleTurnAbsoluteOffset + visibleIndex + 1}
                    isCollapsed={collapsedTurns[turn.id] ?? false}
                    livePlan={livePlan?.turnId === turn.id ? livePlan : null}
                    liveItems={liveItemsTargetTurnId === turn.id ? liveItems?.items ?? null : null}
                    liveOutput={liveOutputTargetTurnId === turn.id ? liveOutput : ''}
                    forceActive={
                      activeTurnId === turn.id ||
                      (
                        shouldForceLatestVisibleTurnActive &&
                        latestVisibleTurnId === turn.id
                      )
                    }
                    onToggleCollapse={handleToggleCollapse}
                    onOpenExpandedText={handleOpenExpandedText}
                    onOpenCommandDetail={handleOpenCommandDetail}
                    onOpenToolCallDetail={handleOpenToolCallDetail}
                    onOpenDeferredHistoryItemDetail={handleOpenDeferredHistoryItemDetail}
                    {...(onSelectArtifact ? { onSelectArtifact } : {})}
                    scrollRootRef={scrollContainerRef}
                    articleRef={undefined}
                  />
                  {(activityNoteAnchors.afterTurnId.get(turn.id)?.length ?? 0) > 0 ? (
                    <div className="thread-graph-message-section space-y-3 px-3 py-4 sm:px-5">
                      {(activityNoteAnchors.afterTurnId.get(turn.id) ?? []).map((note) => (
                        <ActivityNoteCard key={note.id} note={note} onOpenThread={onOpenThread} onOpenLinkedThread={openLinkedThread} />
                      ))}
                    </div>
                  ) : null}
                  {(notesByTurnId.get(turn.id)?.length || pendingRequestsByTurnId.get(turn.id)?.length) ? (
                    <div className="thread-graph-message-section space-y-3 px-3 py-4 sm:px-5">
                      {[
                        ...(notesByTurnId.get(turn.id) ?? []).map((note) => ({
                          kind: 'note' as const,
                          id: note.id,
                          createdAt: note.createdAt ?? '',
                          note,
                        })),
                        ...(pendingRequestsByTurnId.get(turn.id) ?? []).map((request) => ({
                          kind: 'request' as const,
                          id: request.id,
                          createdAt: request.createdAt,
                          request,
                        })),
                      ]
                        .sort((left, right) =>
                          left.createdAt.localeCompare(right.createdAt),
                        )
                        .map((entry) =>
                          entry.kind === 'note' ? (
                            <AnsweredRequestNote key={entry.id} note={entry.note} />
                          ) : (
                            <PendingRequestCard
                              key={entry.id}
                              request={entry.request}
                              busy={respondingRequestId === entry.request.id}
                              onRespond={onRespondToRequest ?? undefined}
                            />
                          ),
                        )}
                    </div>
                  ) : null}
                </div>
              ))}
              {optimisticTurn && visibleTurns.every((turn) => turn.id !== optimisticTurn.id) && (
                <>
                  {(activityNoteAnchors.beforeTurnId.get(optimisticTurn.id)?.length ?? 0) > 0 ? (
                    <div className="thread-graph-message-section space-y-3 px-3 py-4 sm:px-5">
                      {(activityNoteAnchors.beforeTurnId.get(optimisticTurn.id) ?? []).map(
                        (note) => (
                          <ActivityNoteCard key={note.id} note={note} onOpenThread={onOpenThread} onOpenLinkedThread={openLinkedThread} />
                        ),
                      )}
                    </div>
                  ) : null}
                  {(requestEntryAnchors.beforeTurnId.get(optimisticTurn.id)?.length ?? 0) > 0 ? (
                    <div className="thread-graph-message-section space-y-3 px-3 py-4 sm:px-5">
                      {(requestEntryAnchors.beforeTurnId.get(optimisticTurn.id) ?? []).map(
                        (entry) =>
                          entry.kind === 'note' ? (
                            <AnsweredRequestNote key={entry.id} note={entry.note} />
                          ) : (
                            <PendingRequestCard
                              key={entry.id}
                              request={entry.request}
                              busy={respondingRequestId === entry.request.id}
                              onRespond={onRespondToRequest ?? undefined}
                            />
                          ),
                      )}
                    </div>
                  ) : null}
                  <ThreadTurnRow
                    threadId={threadId}
                    {...(adapter ? { adapter } : {})}
                    turn={optimisticTurn}
                    absoluteIndex={optimisticAbsoluteIndex}
                    isCollapsed={collapsedTurns[optimisticTurn.id] ?? false}
                    livePlan={null}
                    liveItems={optimisticLiveItems}
                    liveOutput={liveOutputAttachedToOptimisticTurn ? liveOutput : ''}
                    forceActive={
                      activeTurnId === optimisticTurn.id ||
                      (
                        shouldForceLatestVisibleTurnActive &&
                        latestVisibleTurnId === optimisticTurn.id
                      )
                    }
                    onToggleCollapse={handleToggleCollapse}
                    onOpenExpandedText={handleOpenExpandedText}
                    onOpenCommandDetail={handleOpenCommandDetail}
                    onOpenToolCallDetail={handleOpenToolCallDetail}
                    onOpenDeferredHistoryItemDetail={handleOpenDeferredHistoryItemDetail}
                    {...(onSelectArtifact ? { onSelectArtifact } : {})}
                    scrollRootRef={scrollContainerRef}
                  />
                  {(activityNoteAnchors.afterTurnId.get(optimisticTurn.id)?.length ?? 0) > 0 ? (
                    <div className="thread-graph-message-section space-y-3 px-3 py-4 sm:px-5">
                      {(activityNoteAnchors.afterTurnId.get(optimisticTurn.id) ?? []).map(
                        (note) => (
                          <ActivityNoteCard key={note.id} note={note} onOpenThread={onOpenThread} onOpenLinkedThread={openLinkedThread} />
                        ),
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {queuedSteers.length > 0 && (
            <div className="thread-graph-message-section space-y-3 px-3 py-4 sm:px-5">
              {queuedSteers.map((steer) => (
                <CompactMessageItem
                  key={steer.id}
                  threadId={threadId}
                  item={{
                    id: steer.id,
                    kind: 'userMessage',
                    text: steer.prompt,
                    status: steer.status,
                  }}
                  scrollRootRef={scrollContainerRef}
                  {...(adapter ? { adapter } : {})}
                />
              ))}
            </div>
          )}

          {(requestEntryAnchors.trailing.length > 0 ||
            activityNoteAnchors.trailing.length > 0) && (
            <div className="thread-graph-message-section space-y-3 px-3 py-4 sm:px-5">
              {[
                ...activityNoteAnchors.trailing.map((note) => ({
                  kind: 'activity' as const,
                  id: note.id,
                  createdAt: note.createdAt,
                  note,
                })),
                ...requestEntryAnchors.trailing,
              ]
                .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
                .map((entry) =>
                  entry.kind === 'activity' ? (
                    <ActivityNoteCard key={entry.id} note={entry.note} onOpenThread={onOpenThread} onOpenLinkedThread={openLinkedThread} />
                  ) : entry.kind === 'note' ? (
                    <AnsweredRequestNote key={entry.id} note={entry.note} />
                  ) : (
                    <PendingRequestCard
                      key={entry.id}
                      request={entry.request}
                      busy={respondingRequestId === entry.request.id}
                      onRespond={onRespondToRequest ?? undefined}
                    />
                  ),
                )}
            </div>
          )}

          {ephemeralUserNote && (
            <div className="thread-graph-message-section px-3 py-2.5 sm:px-5">
              <CompactMessageItem
                threadId={threadId}
                item={{
                  id: 'ephemeral-plan-decision-note',
                  kind: 'userMessage',
                  text: ephemeralUserNote,
                }}
                scrollRootRef={scrollContainerRef}
              />
            </div>
          )}

          {unattachedLiveItems && unattachedLiveItems.length > 0 && (
            <div className="thread-graph-message-section space-y-3 px-3 py-2.5 sm:px-5">
              <TimelineHistoryEntries
                entries={unattachedLiveEntries}
                expandedGroups={expandedLooseGroups}
                onToggleGroupedItem={handleToggleLooseGroup}
                threadId={threadId}
                scrollRootRef={scrollContainerRef}
                onOpenExpandedText={handleOpenExpandedText}
                onOpenCommandDetail={handleOpenCommandDetail}
                onOpenToolCallDetail={handleOpenToolCallDetail}
                onOpenDeferredHistoryItemDetail={handleOpenDeferredHistoryItemDetail}
                {...(onSelectArtifact ? { onSelectArtifact } : {})}
                {...(adapter ? { adapter } : {})}
              />
            </div>
          )}

          {liveOutput &&
            !liveOutputAttachedToVisibleTurn &&
            !liveOutputAttachedToOptimisticTurn &&
            !hasStructuredLiveItems && (
            <div className="thread-graph-message-section px-3 py-2.5 sm:px-5">
              {parseHookPromptText(liveOutput) ? (
                <HistoryItemRow
                  threadId={threadId}
                  item={parseHookPromptText(liveOutput)!}
                  scrollRootRef={scrollContainerRef}
                  onOpenExpandedText={handleOpenExpandedText}
                  onOpenCommandDetail={handleOpenCommandDetail}
                  onOpenToolCallDetail={handleOpenToolCallDetail}
                  onOpenDeferredHistoryItemDetail={handleOpenDeferredHistoryItemDetail}
                  {...(onSelectArtifact ? { onSelectArtifact } : {})}
                  {...(adapter ? { adapter } : {})}
                />
              ) : (
                <CompactMessageItem
                  threadId={threadId}
                  item={{
                    id: 'live-agent-message-fallback',
                    kind: 'agentMessage',
                    text: liveOutput,
                  }}
                  scrollRootRef={scrollContainerRef}
                  streaming
                  {...(adapter ? { adapter } : {})}
                />
              )}
            </div>
          )}

          <div
            ref={tailSentinelRef}
            aria-hidden="true"
            className="h-px w-full"
          />
          </div>
        </div>
      </section>

      <LongTextDialog
        open={expandedText !== null}
        title={expandedText?.title ?? 'Full text'}
        text={expandedText?.text ?? ''}
        onClose={() => {
          expandedTextRequestIdRef.current += 1;
          setExpandedText(null);
        }}
      />
    </>
  );
}

export const ThreadTimeline = memo(ThreadTimelineComponent);
