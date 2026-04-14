import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
  type RefObject,
} from 'react';
import { code } from '@streamdown/code';
import { Streamdown } from 'streamdown';

import type {
  RespondThreadActionRequestInput,
  ThreadActionRequestDto,
  ThreadActivityNoteDto,
  ThreadHistoryItemDetailDto,
  ThreadHistoryItemDto,
  ThreadPendingSteerDto,
  ThreadTurnDto,
} from '../../../../packages/shared/src/index';
import { LongTextDialog } from './LongTextDialog';
import { hasLikelyMarkdownSyntax } from './markdownHeuristics';
import {
  formatLongTimestamp,
  formatShortTimestamp,
  historyItemAccentClassName,
  historyItemLabel,
  isScrollableHistoryItem,
  turnStatusLabel,
} from './threadPresentation';

interface ThreadTimelineProps {
  threadId?: string | undefined;
  turns: ThreadTurnDto[];
  totalTurnCount?: number;
  pendingRequests?: ThreadActionRequestDto[];
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

interface ContextCompactionHistoryItem extends ThreadHistoryItemDto {
  kind: 'contextCompaction';
}

type UserMessageSegment =
  | { type: 'text'; key: string; text: string }
  | { type: 'photo'; key: string; path: string }
  | { type: 'file'; key: string; path: string };

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
    };

type TimelineTurn = Omit<ThreadTurnDto, 'status'> & {
  status: ThreadTurnDto['status'] | 'sending';
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

function itemSurfaceClassName(kind: ThreadHistoryItemDto['kind']) {
  switch (kind) {
    case 'userMessage':
      return 'timeline-user';
    case 'agentMessage':
      return 'timeline-agent';
    case 'image':
      return 'timeline-action';
    case 'contextCompaction':
      return 'timeline-action';
    case 'commandExecution':
      return 'timeline-command';
    case 'webSearch':
      return 'timeline-search';
    case 'reasoning':
      return 'timeline-reasoning';
    case 'toolCall':
      return 'timeline-action';
    case 'plan':
      return 'timeline-plan';
    case 'fileChange':
      return 'timeline-file-change';
    case 'other':
      return 'timeline-other';
  }
}

function overlayBadgeClassName(
  tone: 'user' | 'agent' | 'command' | 'search' | 'action',
) {
  switch (tone) {
    case 'user':
      return 'timeline-overlay-badge timeline-overlay-badge-user';
    case 'agent':
      return 'timeline-overlay-badge timeline-overlay-badge-agent';
    case 'command':
      return 'timeline-overlay-badge timeline-overlay-badge-command';
    case 'search':
      return 'timeline-overlay-badge timeline-overlay-badge-search';
    case 'action':
      return 'timeline-overlay-badge timeline-overlay-badge-action';
  }
}

function ContextCompactionIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 5.25h9" />
      <path d="M5 8h6" />
      <path d="M6.5 10.75h3" />
    </svg>
  );
}

function normalizeLines(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  while (lines.length > 1 && lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  return lines;
}

function summarizeInlinePreviewText(text: string) {
  const lines = normalizeLines(text);

  if (lines.length === 1) {
    return {
      firstLine: lines[0] ?? '',
      showGap: false,
      isTruncated: false,
    };
  }

  return {
    firstLine: lines[0] ?? '',
    showGap: true,
    isTruncated: true,
  };
}

function basenameFromAssetPath(value: string) {
  const normalized = value.replace(/[\\/]+$/, '').trim();
  if (!normalized) {
    return '';
  }
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function tokenizeUserMessageText(text: string): UserMessageSegment[] {
  if (!text) {
    return [];
  }

  const matcher = /\[(PHOTO|FILE)\s+([^\]]+)\]/g;
  const segments: UserMessageSegment[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of text.matchAll(matcher)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({
        type: 'text',
        key: `text-${index}`,
        text: text.slice(cursor, start),
      });
      index += 1;
    }

    const kind = match[1];
    const path = match[2]?.trim() ?? '';
    if (kind === 'PHOTO' && path) {
      segments.push({ type: 'photo', key: `photo-${index}`, path });
    } else if (kind === 'FILE' && path) {
      segments.push({ type: 'file', key: `file-${index}`, path });
    } else {
      segments.push({
        type: 'text',
        key: `text-${index}`,
        text: match[0],
      });
    }
    index += 1;
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({
      type: 'text',
      key: `text-${index}`,
      text: text.slice(cursor),
    });
  }

  return segments;
}

function formatTrailingPathLabel(label: string, maxLength = 42) {
  const normalized = label.trim();
  if (!normalized) {
    return '';
  }

  const suffixMatch = normalized.match(/(, \+\d+ more.*)$/);
  const suffix = suffixMatch?.[1] ?? '';
  const base = suffix ? normalized.slice(0, -suffix.length) : normalized;
  if (base.length <= maxLength) {
    return `${base}${suffix}`;
  }

  const normalizedSeparators = base.replace(/\\/g, '/');
  const segments = normalizedSeparators.split('/').filter(Boolean);
  if (segments.length > 1) {
    const keptSegments: string[] = [];
    let currentLength = suffix.length + 4;

    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const candidate = segments[index]!;
      const nextLength = currentLength + candidate.length + (keptSegments.length > 0 ? 1 : 0);
      if (keptSegments.length > 0 && nextLength > maxLength) {
        break;
      }
      keptSegments.unshift(candidate);
      currentLength = nextLength;
    }

    if (keptSegments.length > 0) {
      return `.../${keptSegments.join('/')}${suffix}`;
    }
  }

  return `...${base.slice(-(maxLength - suffix.length - 3))}${suffix}`;
}

function fileChangeSummarySegments(item: ThreadHistoryItemDto & { kind: 'fileChange' }) {
  const segments: string[] = [];

  if (typeof item.changedFiles === 'number' && item.changedFiles > 0) {
    segments.push(`${item.changedFiles} ${item.changedFiles === 1 ? 'file' : 'files'}`);
  }
  if (typeof item.addedLines === 'number' && item.addedLines > 0) {
    segments.push(`+${item.addedLines}`);
  }
  if (typeof item.removedLines === 'number' && item.removedLines > 0) {
    segments.push(`-${item.removedLines}`);
  }

  if (segments.length > 0) {
    return segments;
  }

  const fallback = item.previewText?.trim();
  if (!fallback) {
    return [];
  }

  return fallback
    .replace(/\bfiles changed\b/gi, 'files')
    .replace(/\bfile changed\b/gi, 'file')
    .split('·')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isCompactChatItem(kind: ThreadHistoryItemDto['kind']) {
  return kind === 'userMessage' || kind === 'agentMessage';
}

function isSteerTailHistoryItem(kind: ThreadHistoryItemDto['kind']) {
  return (
    kind === 'commandExecution' ||
    kind === 'webSearch' ||
    kind === 'fileChange' ||
    kind === 'image' ||
    kind === 'contextCompaction'
  );
}

function isSteerConsumptionHistoryItem(kind: ThreadHistoryItemDto['kind']) {
  return (
    kind === 'agentMessage' ||
    kind === 'reasoning' ||
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

function mergeLiveTurnItems(
  items: ThreadHistoryItemDto[],
  liveItems: ThreadHistoryItemDto[] | null | undefined,
) {
  if (!liveItems || liveItems.length === 0) {
    return items;
  }

  const existingIds = new Set(items.map((item) => item.id));
  const uniqueLiveItems = liveItems.filter((item) => !existingIds.has(item.id));
  if (uniqueLiveItems.length === 0) {
    return items;
  }

  return [...items, ...uniqueLiveItems];
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

  while (index < items.length) {
    const current = items[index];
    if (!current) {
      break;
    }

    if (
      current.kind !== 'commandExecution' &&
      current.kind !== 'fileChange' &&
      current.kind !== 'webSearch'
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

    entries.push({
      kind: 'searchGroup',
      key: groupKey,
      items: groupedItems as SearchHistoryItem[],
    });
  }

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

function CommandIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 5 2 2-2 2" />
      <path d="M7.75 9.5h4.25" />
    </svg>
  );
}

function ToolCallIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.25 4.25 3.5 7l2.75 2.75" />
      <path d="M9.75 4.25 12.5 7 9.75 9.75" />
      <path d="M8.9 3.5 7.1 10.5" />
      <path d="M3 12.25h10" />
    </svg>
  );
}

function CommandBatchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.75" y="3" width="8.5" height="3" rx="1.1" />
      <rect x="4.25" y="6.5" width="8.5" height="3" rx="1.1" />
      <rect x="5.75" y="10" width="7.5" height="3" rx="1.1" />
      <path d="m6.25 4.5 1 1-1 1" />
      <path d="M7.9 5.5h1.7" />
      <path d="m7.75 8 1 1-1 1" />
      <path d="M9.4 9h1.7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="7" r="3.75" />
      <path d="m10.25 10.25 3 3" />
    </svg>
  );
}

function SearchBatchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="2.3" />
      <path d="m8 8 1.6 1.6" />
      <circle cx="9.3" cy="8.8" r="2" />
      <path d="m10.75 10.25 1.65 1.65" />
      <circle cx="11.2" cy="4.75" r="1.8" />
      <path d="m12.45 6 1.1 1.1" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.75" y="3" width="10.5" height="9.5" rx="1.5" />
      <circle cx="6.1" cy="6.1" r="1.1" />
      <path d="m4.5 10 2.2-2.2 1.9 1.9 1.1-1.1 1.8 1.8" />
    </svg>
  );
}

function FileChangeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 2.75h4l2 2v6.5a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 4 11.25v-7A1.5 1.5 0 0 1 5.5 2.75Z" />
      <path d="M9 2.75v2h2" />
      <path d="M6.2 8h3.6" />
      <path d="M6.2 10h1.7" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5 fill-current"
    >
      <path d="m13.28 7.78 3.22-3.22v2.69a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.69l-3.22 3.22a.75.75 0 0 0 1.06 1.06ZM2 17.25v-4.5a.75.75 0 0 1 1.5 0v2.69l3.22-3.22a.75.75 0 0 1 1.06 1.06L4.56 16.5h2.69a.75.75 0 0 1 0 1.5h-4.5a.747.747 0 0 1-.75-.75ZM12.22 13.28l3.22 3.22h-2.69a.75.75 0 0 0 0 1.5h4.5a.747.747 0 0 0 .75-.75v-4.5a.75.75 0 0 0-1.5 0v2.69l-3.22-3.22a.75.75 0 1 0-1.06 1.06ZM3.5 4.56l3.22 3.22a.75.75 0 0 0 1.06-1.06L4.56 3.5h2.69a.75.75 0 0 0 0-1.5h-4.5a.75.75 0 0 0-.75.75v4.5a.75.75 0 0 0 1.5 0V4.56Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5.25" y="3.25" width="7.5" height="9" rx="1.5" />
      <path d="M10.75 12.75H4.5a1.25 1.25 0 0 1-1.25-1.25V4.75A1.25 1.25 0 0 1 4.5 3.5h.75" />
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

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="4.75" />
      <path d="M8 5.25v2.9l2.05 1.2" />
    </svg>
  );
}

function PlanStepStatusIcon({
  status,
}: {
  status: string;
}) {
  const normalized = normalizePlanStepStatus(status);
  const label =
    normalized === 'completed'
      ? 'Plan step status: Completed'
      : normalized === 'in_progress'
        ? 'Plan step status: In progress'
        : normalized === 'pending'
          ? 'Plan step status: Pending'
          : normalized === 'failed'
            ? 'Plan step status: Failed'
            : `Plan step status: ${status}`;

  const className =
    normalized === 'completed'
      ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
      : normalized === 'in_progress'
        ? 'border-sky-300/30 bg-sky-300/10 text-sky-100'
        : normalized === 'pending'
          ? 'border-stone-700/90 bg-stone-900/80 text-stone-300'
          : normalized === 'failed'
            ? 'border-rose-300/30 bg-rose-300/10 text-rose-100'
            : 'border-stone-700/90 bg-stone-900/80 text-stone-300';

  return (
    <span
      aria-label={label}
      title={label.replace('Plan step status: ', '')}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${className}`}
    >
      {normalized === 'completed' ? (
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
      ) : normalized === 'in_progress' ? (
        <RunningDots tone="sky" />
      ) : normalized === 'pending' ? (
        <ClockIcon />
      ) : normalized === 'failed' ? (
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
      ) : (
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
          ?
        </span>
      )}
    </span>
  );
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
            <span className="min-w-0 truncate text-stone-300">{runtimeSummary}</span>
          </div>
          {turn.startedAt && (
            <time
              dateTime={turn.startedAt}
              title={formatLongTimestamp(turn.startedAt)}
              className="shrink-0 text-[11px] text-stone-400"
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
      <span className="min-w-0 truncate text-stone-400">{runtimeSummary}</span>
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const desktopPriceRef = useRef<HTMLDivElement | null>(null);

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
          <div className="absolute left-1/2 top-full z-30 mt-1.5 -translate-x-1/2">
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

function MarkdownContent({
  text,
  className = 'agent-markdown',
}: {
  text: string;
  className?: string;
}) {
  return (
    <Streamdown
      mode="static"
      plugins={{ code }}
      controls={false}
      lineNumbers={false}
      className={className}
    >
      {text}
    </Streamdown>
  );
}

function MarkdownAwareBody({
  text,
  scrollRootRef,
  streaming = false,
  containerClassName = '',
  plainTextClassName = 'whitespace-pre-wrap break-words text-[15px] leading-6 text-stone-100',
  markdownClassName = 'agent-markdown',
}: {
  text: string;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  streaming?: boolean;
  containerClassName?: string;
  plainTextClassName?: string;
  markdownClassName?: string;
}) {
  const messageRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderMarkdown = hasLikelyMarkdownSyntax(text);
  const [isActivated, setIsActivated] = useState(
    streaming || typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    if (streaming || typeof IntersectionObserver === 'undefined') {
      setIsActivated(true);
      return;
    }

    if (isActivated || !messageRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsActivated(true);
            observer.disconnect();
            break;
          }
        }
      },
      {
        root: scrollRootRef.current,
        threshold: 0,
      },
    );

    observer.observe(messageRef.current);
    return () => {
      observer.disconnect();
    };
  }, [isActivated, scrollRootRef, streaming]);

  return (
    <div ref={messageRef} className={containerClassName}>
      {isActivated && shouldRenderMarkdown ? (
        <MarkdownContent text={text} className={markdownClassName} />
      ) : (
        <p className={plainTextClassName}>{text}</p>
      )}
    </div>
  );
}

function AgentMessageBody({
  text,
  scrollRootRef,
  streaming = false,
}: {
  text: string;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  streaming?: boolean;
}) {
  return (
    <MarkdownAwareBody
      text={text}
      scrollRootRef={scrollRootRef}
      streaming={streaming}
      containerClassName="pb-7"
    />
  );
}

function UserMessageBody({
  threadId,
  text,
}: {
  threadId?: string | undefined;
  text: string;
}) {
  const segments = useMemo(() => tokenizeUserMessageText(text), [text]);

  return (
    <div className="whitespace-pre-wrap break-words text-[15px] leading-6 text-stone-300">
      {segments.map((segment) => {
        if (segment.type === 'text') {
          return <span key={segment.key}>{segment.text}</span>;
        }

        if (segment.type === 'photo') {
          const imageUrl =
            threadId
              ? `/api/threads/${threadId}/assets/image?path=${encodeURIComponent(segment.path)}`
              : null;
          const label = basenameFromAssetPath(segment.path) || 'Attached image';

          return (
            <span key={segment.key} className="mx-[0.14rem] inline-flex align-middle">
              <span className="inline-flex max-w-full flex-col rounded-[1rem] border border-sky-300/28 bg-sky-300/[0.08] p-1.5 shadow-sm shadow-stone-950/20">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={label}
                    className="h-[4.5rem] w-[6rem] rounded-[0.75rem] bg-stone-950 object-contain"
                    loading="lazy"
                  />
                ) : (
                  <span className="inline-flex h-[4.5rem] w-[6rem] items-center justify-center rounded-[0.75rem] bg-stone-950 text-[10px] text-sky-100">
                    PHOTO
                  </span>
                )}
                <span
                  className="mt-1 max-w-[7rem] truncate text-[10px] font-medium tracking-[0.08em] text-sky-50"
                  title={segment.path}
                >
                  {label}
                </span>
              </span>
            </span>
          );
        }

        const fileName = basenameFromAssetPath(segment.path) || 'Attached file';
        return (
          <span key={segment.key} className="mx-[0.14rem] inline-flex align-middle">
            <span
              className="inline-flex max-w-[12rem] items-center gap-2 rounded-[0.95rem] border border-emerald-300/28 bg-emerald-300/[0.08] px-2.5 py-2 text-[10px] font-medium tracking-[0.08em] text-emerald-50 shadow-sm shadow-stone-950/20"
              title={segment.path}
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-200/20 bg-emerald-300/12 text-[9px]">
                FILE
              </span>
              <span className="min-w-0 truncate">{fileName}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

function commandStatusBadgeClassName(status: ThreadHistoryItemDto['status']) {
  if (status === 'completed') {
    return 'border-emerald-300/35 bg-emerald-300/12 text-emerald-100';
  }

  if (status === 'failed') {
    return 'border-rose-300/35 bg-rose-300/12 text-rose-100';
  }

  if (status === 'interrupted') {
    return 'border-amber-300/35 bg-amber-300/12 text-amber-100';
  }

  return 'border-sky-300/35 bg-sky-300/12 text-sky-100';
}

function CommandStatusIcon({
  status,
}: {
  status: ThreadHistoryItemDto['status'];
}) {
  if (status === 'completed') {
    return (
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
    );
  }

  if (status === 'failed') {
    return (
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
    );
  }

  if (status === 'interrupted') {
    return (
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
    );
  }

  return <RunningDots tone="emerald" />;
}

const CompactMessageItem = memo(function CompactMessageItem({
  threadId,
  item,
  scrollRootRef,
  streaming = false,
}: {
  threadId?: string | undefined;
  item: ThreadHistoryItemDto & {
    kind: Extract<ThreadHistoryItemDto['kind'], 'userMessage' | 'agentMessage'>;
  };
  scrollRootRef: RefObject<HTMLDivElement | null>;
  streaming?: boolean;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimerRef = useRef<number | null>(null);
  const iconToneClassName =
    item.kind === 'userMessage'
      ? 'thread-message-icon thread-message-icon-user'
      : 'thread-message-icon thread-message-icon-agent';
  const queuedLikeStatus =
    item.kind === 'userMessage' &&
    (
      item.status === 'Steering' ||
      item.status === 'Accepted' ||
      item.status === 'Awaiting response'
    );
  const queuedBadgeClassName =
    item.status === 'Steering'
      ? 'border-amber-300/30 bg-amber-300/10 text-amber-100'
      : item.status === 'Accepted'
        ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
        : 'border-sky-300/30 bg-sky-300/10 text-sky-100';

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(item.text);
      setCopyState('copied');
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => setCopyState('idle'), 1200);
    } catch {
      setCopyState('failed');
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => setCopyState('idle'), 1600);
    }
  }

  return (
    <div
      className={`timeline-item-frame relative min-w-0 w-full overflow-hidden rounded-[1rem] border ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2.5 sm:rounded-[1.2rem] sm:px-3`}
    >
      {queuedLikeStatus && (
        <span className={`absolute right-2.5 top-2.5 z-[1] inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium tracking-[0.12em] shadow-sm shadow-stone-950/20 ${queuedBadgeClassName}`}>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5 fill-none stroke-current"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.25 8A4.75 4.75 0 0 1 8 3.25h2.75" />
            <path d="m9.5 1.75 1.75 1.5-1.75 1.5" />
            <path d="M12.75 8A4.75 4.75 0 0 1 8 12.75H5.25" />
            <path d="m6.5 14.25-1.75-1.5 1.75-1.5" />
          </svg>
          <span>{item.status}</span>
        </span>
      )}
      <span
        className={`absolute left-0 top-0 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-br-[0.7rem] rounded-tl-[0.95rem] border text-[10px] shadow-sm shadow-stone-950/20 sm:hidden ${iconToneClassName}`}
      >
        <span className="scale-[0.78]">
          <CompactMessageIcon kind={item.kind} />
        </span>
      </span>
      <div className="flex min-w-0 items-start gap-0 pt-2 sm:gap-2.5 sm:pt-0">
        <div className="mt-0.5 flex shrink-0 items-center">
          <span
            className={`hidden h-6 w-6 items-center justify-center rounded-full border sm:inline-flex ${iconToneClassName}`}
          >
            <CompactMessageIcon kind={item.kind} />
          </span>
          {streaming && item.kind === 'agentMessage' && (
            <span className="hidden sm:inline-flex">
              <RunningDots tone="emerald" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {item.kind === 'agentMessage' ? (
            <AgentMessageBody
              text={item.text}
              scrollRootRef={scrollRootRef}
              streaming={streaming}
            />
          ) : (
            <UserMessageBody threadId={threadId} text={item.text} />
          )}
          {item.status && !queuedLikeStatus && (
            <p className="mt-1 text-xs text-stone-500">{item.status}</p>
          )}
        </div>
      </div>
      {streaming && item.kind === 'agentMessage' && (
        <span className="absolute left-5 top-0 inline-flex sm:hidden">
          <RunningDots tone="emerald" />
        </span>
      )}
      {item.kind === 'agentMessage' && (
        <button
          type="button"
          aria-label="Copy agent reply"
          title={
            copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Copy failed'
                : 'Copy agent reply'
          }
          onClick={() => void handleCopy()}
          className={`absolute bottom-0 right-0 inline-flex h-5 w-5 items-center justify-center rounded-tl-[0.7rem] rounded-br-[0.95rem] border shadow-sm shadow-stone-950/25 backdrop-blur transition sm:bottom-2.5 sm:right-2.5 sm:h-7 sm:w-7 sm:rounded-full ${
            copyState === 'copied'
              ? 'border-sky-300/40 bg-sky-300/16 text-sky-100'
              : copyState === 'failed'
                ? 'border-rose-300/35 bg-rose-300/12 text-rose-100'
                : 'border-stone-700/90 bg-stone-900/60 text-stone-300 hover:bg-stone-800/92'
          }`}
        >
          <span className="scale-[0.72] sm:scale-100">
            <CopyIcon />
          </span>
        </button>
      )}
    </div>
  );
});

const CommandItem = memo(function CommandItem({
  item,
  onOpen,
}: {
  item: ThreadHistoryItemDto & { kind: 'commandExecution' };
  onOpen: (
    item: ThreadHistoryItemDto & { kind: 'commandExecution' },
    title: string,
  ) => void;
}) {
  const summary = summarizeInlinePreviewText(item.text);

  return (
    <div
      className={`timeline-item-frame relative min-w-0 w-full overflow-hidden rounded-[1rem] border ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2.5 sm:rounded-[1.2rem] sm:px-3`}
    >
      <span
        className={`absolute left-0 top-0 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-br-[0.7rem] rounded-tl-[0.95rem] border text-[10px] shadow-sm shadow-stone-950/20 sm:hidden ${overlayBadgeClassName('command')}`}
      >
        <span className="scale-[0.78]">
          <CommandIcon />
        </span>
      </span>
      {isRunningHistoryStatus(item.status) && (
        <span className="absolute left-5 top-0 inline-flex sm:hidden">
          <RunningDots />
        </span>
      )}
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 hidden shrink-0 items-center sm:flex">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-300/25 bg-amber-300/10 text-amber-200">
            <CommandIcon />
          </span>
          {isRunningHistoryStatus(item.status) && <RunningDots />}
        </div>
        <div className="timeline-item-inner relative min-w-0 w-full flex-1 rounded-[0.9rem] border px-2.5 py-2.5 pt-6 sm:rounded-xl sm:px-3 sm:py-2">
            <button
              type="button"
              aria-label={item.status ? `Command status: ${item.status}` : 'Command status'}
              title={item.status ?? 'Command status'}
              onClick={() => onOpen(item, 'Command Output')}
              className={`absolute right-0 top-0 inline-flex h-5 w-5 items-center justify-center rounded-bl-[0.7rem] rounded-tr-[0.9rem] border shadow-sm shadow-stone-950/25 transition sm:right-2 sm:top-2 sm:h-7 sm:w-7 sm:rounded-full ${commandStatusBadgeClassName(item.status)} hover:brightness-110`}
            >
              <span className="scale-[0.72] sm:scale-100">
                <CommandStatusIcon status={item.status} />
              </span>
            </button>
            <button
              type="button"
              aria-label="Open full command"
              onClick={() => onOpen(item, 'Command Output')}
              className="block w-full text-left"
            >
              <div className="flex min-w-0 items-center gap-2 text-sm leading-6">
                <p className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-stone-200">
                  {summary.firstLine}
                </p>
                {summary.showGap ? (
                  <span className="shrink-0 text-[11px] font-medium tracking-[0.28em] text-stone-400">
                    ...
                  </span>
                ) : null}
              </div>
            </button>
        </div>
      </div>
    </div>
  );
});

const ToolCallItem = memo(function ToolCallItem({
  item,
  onOpen,
}: {
  item: ThreadHistoryItemDto & { kind: 'toolCall' };
  onOpen: (
    item: ThreadHistoryItemDto & { kind: 'toolCall' },
    title: string,
  ) => void;
}) {
  const summary = summarizeInlinePreviewText(item.text);

  return (
    <div
      className={`timeline-item-frame relative min-w-0 w-full overflow-hidden rounded-[1rem] border ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2.5 sm:rounded-[1.2rem] sm:px-3`}
    >
      <span
        className={`absolute left-0 top-0 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-br-[0.7rem] rounded-tl-[0.95rem] border text-[10px] shadow-sm shadow-stone-950/20 sm:hidden ${overlayBadgeClassName('action')}`}
      >
        <span className="scale-[0.78]">
          <ToolCallIcon />
        </span>
      </span>
      {isRunningHistoryStatus(item.status) && (
        <span className="absolute left-5 top-0 inline-flex sm:hidden">
          <RunningDots />
        </span>
      )}
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 hidden shrink-0 items-center sm:flex">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-100">
            <ToolCallIcon />
          </span>
          {isRunningHistoryStatus(item.status) && <RunningDots />}
        </div>
        <div className="timeline-item-inner relative min-w-0 w-full flex-1 rounded-[0.9rem] border px-2.5 py-2.5 pt-6 sm:rounded-xl sm:px-3 sm:py-2">
          <button
            type="button"
            aria-label={item.status ? `Tool status: ${item.status}` : 'Tool status'}
            title={item.status ?? 'Tool status'}
            onClick={() => onOpen(item, 'Tool Call Details')}
            className={`absolute right-0 top-0 inline-flex h-5 w-5 items-center justify-center rounded-bl-[0.7rem] rounded-tr-[0.9rem] border shadow-sm shadow-stone-950/25 transition sm:right-2 sm:top-2 sm:h-7 sm:w-7 sm:rounded-full ${commandStatusBadgeClassName(item.status)} hover:brightness-110`}
          >
            <span className="scale-[0.72] sm:scale-100">
              <CommandStatusIcon status={item.status} />
            </span>
          </button>
          <button
            type="button"
            aria-label="Open full tool call"
            onClick={() => onOpen(item, 'Tool Call Details')}
            className="block w-full text-left"
          >
            <div className="flex min-w-0 items-center gap-2 text-sm leading-6">
              <p className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-stone-200">
                {summary.firstLine}
              </p>
              {summary.showGap ? (
                <span className="shrink-0 text-[11px] font-medium tracking-[0.28em] text-stone-400">
                  ...
                </span>
              ) : null}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
});

const CommandGroupItem = memo(function CommandGroupItem({
  items,
  expanded,
  onToggleExpanded,
  onOpen,
}: {
  items: CommandHistoryItem[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpen: (item: CommandHistoryItem, title: string) => void;
}) {
  const runningCount = items.filter((item) => isRunningHistoryStatus(item.status)).length;
  const countLabel = items.length === 1 ? '1 command' : `${items.length} commands`;

  return (
    <div className="relative min-w-0 w-full overflow-hidden rounded-[1rem] border border-stone-800/80 border-l-2 border-l-amber-200/35 bg-[linear-gradient(135deg,rgba(251,191,36,0.12),rgba(245,158,11,0.03)_46%,rgba(28,25,23,0.18)_100%)] px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(251,191,36,0.06)] sm:rounded-[1.2rem] sm:px-3">
      <span
        className={`absolute left-0 top-0 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-br-[0.7rem] rounded-tl-[0.95rem] border text-[10px] shadow-sm shadow-stone-950/20 sm:hidden ${overlayBadgeClassName('command')}`}
      >
        <span className="scale-[0.78]">
          <CommandBatchIcon />
        </span>
      </span>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 hidden shrink-0 items-center sm:flex">
          <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-[0.9rem] border border-amber-300/30 bg-amber-300/[0.14] text-amber-100 shadow-sm shadow-stone-950/20">
            <CommandBatchIcon />
            <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full border border-amber-200/35 bg-stone-950/90 px-1 text-[9px] font-semibold leading-4 text-amber-100">
              {items.length}
            </span>
          </span>
          {runningCount > 0 && <RunningDots />}
        </div>
        <div className="min-w-0 flex-1 rounded-[0.9rem] border border-amber-300/14 bg-stone-950/55 px-2 py-1.5 sm:rounded-xl sm:px-3 sm:py-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${items.length} command entries`}
            onClick={onToggleExpanded}
            className="flex w-full min-w-0 items-center justify-between gap-3 text-left"
          >
            <div className="min-w-0 flex flex-1 flex-wrap items-center gap-2 pr-1">
              <span className="rounded-full border border-amber-300/28 bg-amber-300/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.24em] text-amber-100">
                Batch
              </span>
              <span className="rounded-full border border-stone-700/90 bg-stone-900/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-stone-300">
                {countLabel}
              </span>
              {runningCount > 0 && (
                <span className="inline-flex items-center text-xs text-amber-100/90">
                  <RunningDots />
                </span>
              )}
            </div>
            <span className="inline-flex shrink-0 items-center rounded-full border border-amber-300/18 bg-stone-900/85 p-1 text-[11px] font-medium text-stone-200">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-stone-700/90 bg-stone-950/80 text-stone-300">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5 fill-none stroke-current"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {expanded ? (
                    <path d="m4.5 10 3.5-3.5L11.5 10" />
                  ) : (
                    <path d="m4.5 6 3.5 3.5L11.5 6" />
                  )}
                </svg>
              </span>
            </span>
          </button>

          {expanded && (
            <div className="mt-3 space-y-2 border-t border-amber-300/12 pt-3">
              {items.map((item, index) => {
                const summary = summarizeInlinePreviewText(item.text);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Open grouped command ${index + 1}`}
                    onClick={() => onOpen(item, `Command Output ${index + 1}`)}
                    className="block w-full rounded-xl border border-stone-800/80 bg-stone-950/55 px-3 py-2 text-left transition hover:bg-stone-900"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-amber-300/18 bg-amber-300/[0.07] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-amber-100">
                        Step {index + 1}
                      </span>
                      {item.status && (
                        <span className="text-xs text-stone-500">{item.status}</span>
                      )}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-sm leading-6">
                      <p className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-stone-200">
                        {summary.firstLine}
                      </p>
                      {summary.showGap ? (
                        <span className="shrink-0 text-[11px] font-medium tracking-[0.28em] text-stone-400">
                          ...
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const SearchGroupItem = memo(function SearchGroupItem({
  items,
  expanded,
  onToggleExpanded,
  onOpen,
}: {
  items: SearchHistoryItem[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpen: (title: string, text: string) => void;
}) {
  const countLabel = items.length === 1 ? '1 search' : `${items.length} searches`;

  return (
    <div className="relative min-w-0 w-full overflow-hidden rounded-[1rem] border border-stone-800/80 border-l-2 border-l-sky-300/35 bg-[linear-gradient(135deg,rgba(56,189,248,0.12),rgba(14,165,233,0.03)_46%,rgba(28,25,23,0.18)_100%)] px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(125,211,252,0.06)] sm:rounded-[1.2rem] sm:px-3">
      <span
        className={`absolute left-0 top-0 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-br-[0.7rem] rounded-tl-[0.95rem] border text-[10px] shadow-sm shadow-stone-950/20 sm:hidden ${overlayBadgeClassName('search')}`}
      >
        <span className="scale-[0.78]">
          <SearchBatchIcon />
        </span>
      </span>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 hidden shrink-0 items-center sm:flex">
          <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-[0.9rem] border border-sky-300/30 bg-sky-300/[0.14] text-sky-100 shadow-sm shadow-stone-950/20">
            <SearchBatchIcon />
            <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full border border-sky-200/35 bg-stone-950/90 px-1 text-[9px] font-semibold leading-4 text-sky-100">
              {items.length}
            </span>
          </span>
        </div>
        <div className="min-w-0 flex-1 rounded-[0.9rem] border border-sky-300/14 bg-stone-950/55 px-2 py-1.5 sm:rounded-xl sm:px-3 sm:py-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${items.length} web search entries`}
            onClick={onToggleExpanded}
            className="flex w-full min-w-0 items-center justify-between gap-3 text-left"
          >
            <div className="min-w-0 flex flex-1 flex-wrap items-center gap-2 pr-1">
              <span className="rounded-full border border-sky-300/28 bg-sky-300/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.24em] text-sky-100">
                Batch
              </span>
              <span className="rounded-full border border-stone-700/90 bg-stone-900/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-stone-300">
                {countLabel}
              </span>
            </div>
            <span className="inline-flex shrink-0 items-center rounded-full border border-sky-300/18 bg-stone-900/85 p-1 text-[11px] font-medium text-stone-200">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-stone-700/90 bg-stone-950/80 text-stone-300">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5 fill-none stroke-current"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {expanded ? (
                    <path d="m4.5 10 3.5-3.5L11.5 10" />
                  ) : (
                    <path d="m4.5 6 3.5 3.5L11.5 6" />
                  )}
                </svg>
              </span>
            </span>
          </button>

          {expanded && (
            <div className="mt-3 space-y-2 border-t border-sky-300/12 pt-3">
              {items.map((item, index) => {
                const previewText = item.previewText?.trim() || item.text || 'Web search';
                const summary = summarizeInlinePreviewText(previewText);
                const detailText = item.detailText?.trim() || item.text || 'Web search';

                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Open grouped web search ${index + 1}`}
                    onClick={() => onOpen(`Web Search ${index + 1}`, detailText)}
                    className="block w-full rounded-xl border border-stone-800/80 bg-stone-950/55 px-3 py-2 text-left transition hover:bg-stone-900"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-sky-300/18 bg-sky-300/[0.07] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-sky-100">
                        Search {index + 1}
                      </span>
                      {item.status && (
                        <span className="text-xs text-stone-500">{item.status}</span>
                      )}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-sm leading-6">
                      <p className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-stone-200">
                        {summary.firstLine}
                      </p>
                      {summary.showGap ? (
                        <span className="shrink-0 text-[11px] font-medium tracking-[0.28em] text-stone-400">
                          ...
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const PlanHistoryItem = memo(function PlanHistoryItem({
  item,
  scrollRootRef,
}: {
  item: ThreadHistoryItemDto & { kind: 'plan' };
  scrollRootRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      className={`min-w-0 w-full rounded-[1rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2.5 sm:rounded-[1.2rem] sm:px-3`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.2em] text-stone-500">
          {historyItemLabel(item.kind)}
        </span>
        {item.status && (
          <span className="text-xs text-stone-500">{item.status}</span>
        )}
      </div>
      <div className="mt-1.5">
        <MarkdownAwareBody
          text={item.text}
          scrollRootRef={scrollRootRef}
          plainTextClassName="whitespace-pre-wrap break-words text-sm leading-6 text-stone-300"
          markdownClassName="agent-markdown text-sm"
        />
      </div>
    </div>
  );
});

const ContextCompactionItem = memo(function ContextCompactionItem({
  item,
}: {
  item: ContextCompactionHistoryItem;
}) {
  const isRunning = isRunningHistoryStatus(item.status) || item.text === 'Compacting context';
  const primaryText = isRunning ? 'Compacting context' : 'Context compacted';
  const secondaryText =
    item.detailText && item.detailText !== primaryText ? item.detailText : null;

  return (
    <div
      className={`relative min-w-0 w-full overflow-hidden rounded-[1rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2 sm:rounded-[1.2rem] sm:px-3`}
    >
      <span
        className="absolute left-0 top-0 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-br-[0.7rem] rounded-tl-[0.95rem] border border-teal-300/30 bg-teal-300/12 text-[10px] text-teal-100 shadow-sm shadow-stone-950/20 sm:hidden"
      >
        <span className="scale-[0.78]">
          <ContextCompactionIcon />
        </span>
      </span>
      <div className="flex min-w-0 items-center gap-2 pt-2 sm:pt-0">
        <div className="mt-0.5 hidden shrink-0 sm:flex">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-teal-300/25 bg-teal-300/10 text-teal-100">
            <ContextCompactionIcon />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[13px] font-medium text-stone-200 sm:text-sm">
              {primaryText}
            </p>
            {isRunning ? <RunningDots tone="emerald" /> : null}
          </div>
          {secondaryText ? (
            <p
              className="mt-0.5 truncate text-[11px] text-stone-500 sm:text-xs"
              title={secondaryText}
            >
              {secondaryText}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
});

const WebSearchItem = memo(function WebSearchItem({
  item,
  onOpen,
}: {
  item: ThreadHistoryItemDto & { kind: 'webSearch' };
  onOpen: (title: string, text: string) => void;
}) {
  const previewText = item.previewText?.trim() || item.text || 'Web search';
  const detailText = item.detailText?.trim() || item.text || 'Web search';
  const summary = summarizeInlinePreviewText(previewText);

  return (
    <div
      className={`relative min-w-0 w-full overflow-hidden rounded-[1rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2.5 sm:rounded-[1.2rem] sm:px-3`}
    >
      <span
        className={`absolute left-0 top-0 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-br-[0.7rem] rounded-tl-[0.95rem] border text-[10px] shadow-sm shadow-stone-950/20 sm:hidden ${overlayBadgeClassName('search')}`}
      >
        <span className="scale-[0.78]">
          <SearchIcon />
        </span>
      </span>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 hidden shrink-0 items-center sm:flex">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-sky-300/25 bg-sky-300/10 text-sky-100">
            <SearchIcon />
          </span>
        </div>
        <div className="relative min-w-0 w-full flex-1 rounded-[0.9rem] border border-stone-800/80 bg-stone-950/45 px-2.5 py-2.5 pt-6 sm:rounded-xl sm:px-3 sm:py-2">
          <button
            type="button"
            aria-label="Expand web search"
            title="Expand web search"
            onClick={() => onOpen('Web Search Details', detailText)}
            className={`absolute right-0 top-0 inline-flex h-5 w-5 items-center justify-center rounded-bl-[0.7rem] rounded-tr-[0.9rem] border shadow-sm shadow-stone-950/25 transition sm:right-2 sm:top-2 sm:h-7 sm:w-7 sm:rounded-full ${overlayBadgeClassName('action')} hover:bg-stone-800`}
          >
            <span className="scale-[0.72] sm:scale-100">
              <ExpandIcon />
            </span>
          </button>
          {item.status && (
            <p className="pr-8 text-xs text-stone-500 sm:pr-10">{item.status}</p>
          )}
          <button
            type="button"
            aria-label="Open full web search"
            onClick={() => onOpen('Web Search Details', detailText)}
            className="block w-full text-left"
          >
            <div className="flex min-w-0 items-center gap-2 text-sm leading-6">
              <p className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-stone-200">
                {summary.firstLine}
              </p>
              {summary.showGap ? (
                <span className="shrink-0 text-[11px] font-medium tracking-[0.28em] text-stone-400">
                  ...
                </span>
              ) : null}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
});

const ImageItem = memo(function ImageItem({
  threadId,
  item,
  onOpen,
}: {
  threadId: string | undefined;
  item: ThreadHistoryItemDto & { kind: 'image' };
  onOpen: (title: string, text: string) => void;
}) {
  const assetPath = item.assetPath ?? item.detailText ?? null;
  const imageUrl =
    threadId && assetPath
      ? `/api/threads/${threadId}/assets/image?path=${encodeURIComponent(assetPath)}`
      : null;

  return (
    <div
      className={`relative min-w-0 w-full overflow-hidden rounded-[1rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2.5 sm:rounded-[1.2rem] sm:px-3`}
    >
      <span
        className={`absolute left-0 top-0 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-br-[0.7rem] rounded-tl-[0.95rem] border text-[10px] shadow-sm shadow-stone-950/20 sm:hidden ${overlayBadgeClassName('search')}`}
      >
        <span className="scale-[0.78]">
          <ImageIcon />
        </span>
      </span>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 hidden shrink-0 items-center sm:flex">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-indigo-300/25 bg-indigo-300/10 text-indigo-100">
            <ImageIcon />
          </span>
        </div>
        <div className="min-w-0 w-full flex-1">
          {imageUrl ? (
            <button
              type="button"
              onClick={() => onOpen('Image Path', assetPath ?? item.text)}
              className="block w-full text-left"
            >
              <img
                src={imageUrl}
                alt={item.text || 'Image preview'}
                className="max-h-[24rem] w-full rounded-xl border border-stone-700/80 bg-stone-950 object-contain"
                loading="lazy"
              />
            </button>
          ) : (
            <div className="rounded-xl border border-stone-700/80 bg-stone-950/45 px-3 py-3 text-sm text-stone-300">
              {item.text}
            </div>
          )}
          {assetPath && (
            <button
              type="button"
              onClick={() => onOpen('Image Path', assetPath)}
              className="mt-2 block max-w-full truncate text-left text-xs text-stone-400 hover:text-stone-200"
              title={assetPath}
            >
              {assetPath}
            </button>
          )}
          {item.status && (
            <p className="mt-1 text-xs text-stone-500">{item.status}</p>
          )}
        </div>
      </div>
    </div>
  );
});

const FileChangeItem = memo(function FileChangeItem({
  item,
  onOpen,
}: {
  item: ThreadHistoryItemDto & { kind: 'fileChange' };
  onOpen: (title: string, text: string) => void;
}) {
  const pathSummary =
    item.previewText?.trim() && item.text.trim() !== item.previewText.trim()
      ? item.text.trim()
      : null;
  const detailText = item.detailText?.trim() || null;
  const displayedPath = formatTrailingPathLabel(
    pathSummary ?? item.previewText?.trim() ?? item.text,
    48,
  );
  const summarySegments = fileChangeSummarySegments(item);
  const ContainerTag = detailText ? 'button' : 'div';

  return (
    <div
      className={`relative min-w-0 w-full overflow-hidden rounded-[1rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2.5 sm:rounded-[1.2rem] sm:px-3`}
    >
      <span
        className={`absolute left-0 top-0 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-br-[0.7rem] rounded-tl-[0.95rem] border text-[10px] shadow-sm shadow-stone-950/20 sm:hidden ${overlayBadgeClassName('action')}`}
      >
        <span className="scale-[0.78]">
          <FileChangeIcon />
        </span>
      </span>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 hidden shrink-0 items-center sm:flex">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-lime-300/25 bg-lime-300/10 text-lime-100">
            <FileChangeIcon />
          </span>
        </div>
        <ContainerTag
          {...(detailText
            ? {
                type: 'button' as const,
                'aria-label': 'Open file change details',
                onClick: () => onOpen('File Change Details', detailText),
              }
            : {})}
          className={`min-w-0 flex-1 rounded-[0.9rem] border border-stone-800/80 bg-stone-950/45 px-2.5 py-2 text-left sm:rounded-xl sm:px-3 ${
            detailText ? 'transition hover:bg-stone-950/60 hover:text-stone-100' : ''
          }`}
        >
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.2em] text-stone-500">
                  {historyItemLabel(item.kind)}
                </span>
                {item.status && (
                  <span className="text-xs text-stone-500">{item.status}</span>
                )}
              </div>
            </div>
            {summarySegments.length > 0 && (
              <div className="ml-auto inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 text-xs">
                {summarySegments.map((segment) => (
                  <span
                    key={segment}
                    className={`whitespace-nowrap ${
                      segment.startsWith('+')
                        ? 'text-emerald-300'
                        : segment.startsWith('-')
                          ? 'text-rose-300'
                          : 'text-stone-300'
                    }`}
                  >
                    {segment}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="mt-1 flex w-full min-w-0 items-center gap-2 text-left">
            <span
              className="min-w-0 flex-[2] text-xs text-stone-500"
              title={pathSummary ?? undefined}
            >
              {displayedPath}
            </span>
          </div>
        </ContainerTag>
      </div>
    </div>
  );
});

const FileChangeGroupItem = memo(function FileChangeGroupItem({
  items,
  expanded,
  onToggleExpanded,
  onOpen,
}: {
  items: FileChangeHistoryItem[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpen: (title: string, text: string) => void;
}) {
  const changedFiles = items.reduce(
    (sum, item) => sum + (item.changedFiles ?? 0),
    0,
  );
  const addedLines = items.reduce((sum, item) => sum + (item.addedLines ?? 0), 0);
  const removedLines = items.reduce((sum, item) => sum + (item.removedLines ?? 0), 0);
  const batchLabel =
    items.length === 1 ? '1 file change' : `${items.length} file changes`;

  return (
    <div className="relative min-w-0 w-full overflow-hidden rounded-[1rem] border border-stone-800/80 border-l-2 border-l-lime-300/35 bg-[linear-gradient(135deg,rgba(163,230,53,0.12),rgba(132,204,22,0.03)_46%,rgba(28,25,23,0.18)_100%)] px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(163,230,53,0.06)] sm:rounded-[1.2rem] sm:px-3">
      <span
        className={`absolute left-0 top-0 z-[1] inline-flex h-5 w-5 items-center justify-center rounded-br-[0.7rem] rounded-tl-[0.95rem] border text-[10px] shadow-sm shadow-stone-950/20 sm:hidden ${overlayBadgeClassName('action')}`}
      >
        <span className="scale-[0.78]">
          <FileChangeIcon />
        </span>
      </span>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 hidden shrink-0 items-center sm:flex">
          <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-[0.9rem] border border-lime-300/30 bg-lime-300/[0.14] text-lime-100 shadow-sm shadow-stone-950/20">
            <FileChangeIcon />
            <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full border border-lime-200/35 bg-stone-950/90 px-1 text-[9px] font-semibold leading-4 text-lime-100">
              {items.length}
            </span>
          </span>
        </div>
        <div className="min-w-0 flex-1 rounded-[0.9rem] border border-lime-300/14 bg-stone-950/55 px-2 py-1.5 sm:rounded-xl sm:px-3 sm:py-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${items.length} file change entries`}
            onClick={onToggleExpanded}
            className="flex w-full min-w-0 items-center justify-between gap-3 text-left"
          >
            <div className="min-w-0 flex flex-1 flex-wrap items-center gap-2 pr-1">
              <span className="rounded-full border border-lime-300/28 bg-lime-300/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.24em] text-lime-100">
                Batch
              </span>
              <span className="rounded-full border border-stone-700/90 bg-stone-900/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-stone-300">
                {batchLabel}
              </span>
              {changedFiles > 0 && (
                <span className="text-xs text-stone-400">{changedFiles} files</span>
              )}
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5">
              {addedLines > 0 && (
                <span className="timeline-delta-badge timeline-delta-badge-add rounded-full border px-1.5 py-0.5 text-[11px] font-medium">
                  +{addedLines}
                </span>
              )}
              {removedLines > 0 && (
                <span className="timeline-delta-badge timeline-delta-badge-remove rounded-full border px-1.5 py-0.5 text-[11px] font-medium">
                  -{removedLines}
                </span>
              )}
              <span className="inline-flex items-center rounded-full border border-lime-300/18 bg-stone-900/85 p-1 text-[11px] font-medium text-stone-200">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-stone-700/90 bg-stone-950/80 text-stone-300">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5 fill-none stroke-current"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {expanded ? (
                      <path d="m4.5 10 3.5-3.5L11.5 10" />
                    ) : (
                      <path d="m4.5 6 3.5 3.5L11.5 6" />
                    )}
                  </svg>
                </span>
              </span>
            </span>
          </button>

          {expanded && (
            <div className="mt-3 space-y-2 border-t border-lime-300/12 pt-3">
              {items.map((item, index) => {
                const detailText = item.detailText?.trim() || item.previewText?.trim() || item.text;
                const pathSummary =
                  item.previewText?.trim() && item.text.trim() !== item.previewText.trim()
                    ? item.text.trim()
                    : item.previewText?.trim() || item.text;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Open grouped file change ${index + 1}`}
                    onClick={() => onOpen(`File Change ${index + 1}`, detailText)}
                    className="block w-full rounded-xl border border-stone-800/80 bg-stone-950/55 px-3 py-2 text-left transition hover:bg-stone-900"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm leading-6 text-stone-200" title={pathSummary}>
                        {formatTrailingPathLabel(pathSummary, 34)}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1.5">
                        {(item.addedLines ?? 0) > 0 && (
                          <span className="timeline-delta-badge timeline-delta-badge-add rounded-full border px-1.5 py-0.5 text-[11px] font-medium">
                            +{item.addedLines}
                          </span>
                        )}
                        {(item.removedLines ?? 0) > 0 && (
                          <span className="timeline-delta-badge timeline-delta-badge-remove rounded-full border px-1.5 py-0.5 text-[11px] font-medium">
                            -{item.removedLines}
                          </span>
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const GenericHistoryItem = memo(function GenericHistoryItem({
  item,
}: {
  item: ThreadHistoryItemDto;
}) {
  return (
    <div
      className={`min-w-0 w-full rounded-[1rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2.5 sm:rounded-[1.2rem] sm:px-3`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.2em] text-stone-500">
          {historyItemLabel(item.kind)}
        </span>
        {item.status && (
          <span className="text-xs text-stone-500">{item.status}</span>
        )}
      </div>
      <pre
        className={`mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-stone-300 ${
          isScrollableHistoryItem(item.kind) ? 'max-h-56 overflow-auto' : ''
        }`}
      >
        {item.text}
      </pre>
    </div>
  );
});

const HistoryItemRow = memo(function HistoryItemRow({
  threadId,
  item,
  scrollRootRef,
  onOpenExpandedText,
  onOpenCommandDetail,
  onOpenToolCallDetail,
}: {
  threadId: string | undefined;
  item: ThreadHistoryItemDto;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  onOpenExpandedText: (title: string, text: string) => void;
  onOpenCommandDetail: (
    item: ThreadHistoryItemDto & { kind: 'commandExecution' },
    title: string,
  ) => void;
  onOpenToolCallDetail: (
    item: ThreadHistoryItemDto & { kind: 'toolCall' },
    title: string,
  ) => void;
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

  if (item.kind === 'webSearch') {
    return (
      <WebSearchItem
        item={
          item as ThreadHistoryItemDto & {
            kind: 'webSearch';
          }
        }
        onOpen={onOpenExpandedText}
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
    return (
      <FileChangeItem
        item={
          item as ThreadHistoryItemDto & {
            kind: 'fileChange';
          }
        }
        onOpen={onOpenExpandedText}
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
  const [answers, setAnswers] = useState<Record<string, string>>({});
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
    if (selected === OTHER_SENTINEL) {
      return (customAnswers[question.id] ?? '').trim();
    }

    return selected.trim();
  }

  return (
    <div className="w-full rounded-[1rem] border border-sky-300/20 bg-sky-300/[0.06] px-3 py-3 sm:rounded-[1.2rem] sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-sky-100">{cardTitle}</p>
          {request.kind !== 'planDecision' && request.description && (
            <p className="mt-1 text-[13px] leading-5 text-stone-300">{request.description}</p>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {request.questions.map((question) => (
          <div
            key={question.id}
            className="rounded-xl border border-stone-800/80 bg-stone-950/45 p-2.5 sm:p-3"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-stone-500">
              {question.header}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-stone-100 sm:text-sm">
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
                          ? 'border-sky-300/45 bg-sky-300/90 text-slate-950 hover:bg-sky-200'
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
                    return (
                      <button
                        key={option.label}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: option.label,
                          }))
                        }
                        className={`relative rounded-2xl border px-3 py-1.5 pr-6 text-[12px] leading-4 transition sm:text-[13px] ${
                          answers[question.id] === option.label
                            ? 'border-amber-300/50 bg-amber-300/12 text-amber-100'
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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: OTHER_SENTINEL,
                        }))
                      }
                      className={`rounded-2xl border px-3 py-1.5 text-[12px] leading-4 transition sm:text-[13px] ${
                        answers[question.id] === OTHER_SENTINEL
                          ? 'border-sky-300/50 bg-sky-300/12 text-sky-100'
                          : 'border-stone-700 text-stone-300 hover:bg-stone-800'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      Not from above
                    </button>
                  )}
                </div>
                {question.isOther && answers[question.id] === OTHER_SENTINEL && (
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
                )}
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
                      answers: [currentAnswerForQuestion(question)],
                    },
                  ]),
                ),
              })
            }
            className="rounded-full bg-sky-300 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
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
    <div className="w-full rounded-2xl border border-cyan-400/18 bg-cyan-400/[0.05] px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-200/80">
        {note.title}
      </p>
      <div className="mt-1 space-y-1">
        {note.summaryLines.map((line, index) => (
          <p
            key={`${note.id}-${index}`}
            className="text-[13px] leading-5 text-stone-200"
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
}: {
  note: ThreadActivityNoteDto;
  onOpenThread?: ((threadId: string) => void) | undefined;
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
    <div className="w-full rounded-2xl border border-amber-300/18 bg-amber-300/[0.05] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200/80">
          {title}
        </p>
        <time
          dateTime={note.createdAt}
          title={formatLongTimestamp(note.createdAt)}
          className="text-[10px] text-stone-500"
        >
          {formatShortTimestamp(note.createdAt)}
        </time>
      </div>
      <p className="mt-1 text-[13px] leading-5 text-stone-200">{body}</p>
      {note.linkedThreadId ? (
        <button
          type="button"
          onClick={() => {
            if (onOpenThread) {
              onOpenThread(note.linkedThreadId!);
              return;
            }

            if (typeof window !== 'undefined') {
              window.location.assign(`/threads/${note.linkedThreadId}`);
            }
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
  turn,
  absoluteIndex,
  isCollapsed,
  livePlan,
  liveItems,
  liveOutput,
  onToggleCollapse,
  onOpenExpandedText,
  onOpenCommandDetail,
  onOpenToolCallDetail,
  scrollRootRef,
  articleRef,
}: {
  threadId: string | undefined;
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
  onToggleCollapse: (turnId: string) => void;
  onOpenExpandedText: (title: string, text: string) => void;
  onOpenCommandDetail: (
    item: ThreadHistoryItemDto & { kind: 'commandExecution' },
    title: string,
  ) => void;
  onOpenToolCallDetail: (
    item: ThreadHistoryItemDto & { kind: 'toolCall' },
    title: string,
  ) => void;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  articleRef?: RefCallback<HTMLElement> | undefined;
}) {
  const mergedItems = useMemo(
    () => mergeLiveTurnItems(turn.items, liveItems),
    [liveItems, turn.items],
  );
  const displayedLivePlan = useMemo(
    () => deriveDisplayedLivePlan(livePlan, mergedItems, turn.status),
    [livePlan, mergedItems, turn.status],
  );
  const preparedItems = useMemo(
    () => prepareTurnItemsForRendering(mergedItems, isActiveTurnStatus(turn.status)),
    [mergedItems, turn.status],
  );
  const groupedItems = useMemo(() => groupTimelineHistoryItems(preparedItems), [preparedItems]);
  const visibleLiveOutput = useMemo(
    () => getLiveOutputTailForTurn(liveOutput, mergedItems),
    [liveOutput, mergedItems],
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

  return (
    <article ref={articleRef} className="px-2 py-1.5 sm:px-6 sm:py-2">
        <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex flex-1 items-start gap-1.5">
          <div className="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
            <span className="rounded-[0.6rem] border border-stone-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-stone-400">
              Turn {absoluteIndex}
            </span>
            <time
              dateTime={turn.startedAt ?? undefined}
              title={formatLongTimestamp(turn.startedAt)}
              className="shrink-0 text-[10px] text-stone-400 sm:text-[11px]"
            >
              {formatShortTimestamp(turn.startedAt)}
            </time>
            <TurnStatusBar turn={turn} />
            {turn.error && (
              <p className="hidden truncate text-[11px] text-rose-200 sm:block">
                {turn.error}
              </p>
            )}
          </div>
          <TurnTokenSummary turn={turn} />
        </div>
        <button
          type="button"
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} turn ${absoluteIndex}`}
          title={isCollapsed ? 'Expand turn' : 'Collapse turn'}
          onClick={() => onToggleCollapse(turn.id)}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-stone-400 transition hover:text-stone-100"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5 fill-none stroke-current"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {isCollapsed ? (
              <path d="m4.5 10 3.5-3.5L11.5 10" />
            ) : (
              <path d="m4.5 6 3.5 3.5L11.5 6" />
            )}
          </svg>
        </button>
      </div>

      {turn.error && (
        <p className="mt-1 text-[11px] text-rose-200 sm:hidden">{turn.error}</p>
      )}

      {!isCollapsed && (
        <div className="mt-1.5 space-y-1.5">
          {groupedItems.map((entry) =>
            entry.kind === 'commandGroup' ? (
              <CommandGroupItem
                key={entry.key}
                items={entry.items}
                expanded={expandedGroups[entry.key] ?? false}
                onToggleExpanded={() => toggleGroupedItem(entry.key)}
                onOpen={onOpenCommandDetail}
              />
            ) : entry.kind === 'fileChangeGroup' ? (
              <FileChangeGroupItem
                key={entry.key}
                items={entry.items}
                expanded={expandedGroups[entry.key] ?? false}
                onToggleExpanded={() => toggleGroupedItem(entry.key)}
                onOpen={onOpenExpandedText}
              />
            ) : entry.kind === 'searchGroup' ? (
              <SearchGroupItem
                key={entry.key}
                items={entry.items}
                expanded={expandedGroups[entry.key] ?? false}
                onToggleExpanded={() => toggleGroupedItem(entry.key)}
                onOpen={onOpenExpandedText}
              />
            ) : (
              <HistoryItemRow
                key={entry.key}
                threadId={threadId}
                item={entry.item}
                scrollRootRef={scrollRootRef}
                onOpenExpandedText={onOpenExpandedText}
                onOpenCommandDetail={onOpenCommandDetail}
                onOpenToolCallDetail={onOpenToolCallDetail}
              />
            ),
          )}
          {displayedLivePlan && (
            <div className="rounded-[1rem] border border-sky-300/15 bg-sky-300/5 px-3 py-3 sm:rounded-[1.2rem]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-sky-100">Plan update</p>
                <span className="rounded-full border border-sky-300/40 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-sky-200">
                  Live
                </span>
              </div>
              {displayedLivePlan.explanation && (
                <p className="mt-3 text-sm text-stone-300">{displayedLivePlan.explanation}</p>
              )}
              <div className="mt-3 space-y-2">
                {displayedLivePlan.plan.map((step, index) => (
                  <div
                    key={`${displayedLivePlan.turnId}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-stone-800/80 bg-stone-950/45 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 text-stone-200">{step.step}</span>
                    <PlanStepStatusIcon status={step.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {visibleLiveOutput && (
            <CompactMessageItem
              item={{
                id: 'live-agent-message',
                kind: 'agentMessage',
                text: visibleLiveOutput,
              }}
              scrollRootRef={scrollRootRef}
              streaming
            />
          )}
          {isActiveTurnStatus(turn.status) && (
            <TurnStatusBar turn={turn} variant="footer" />
          )}
        </div>
      )}
    </article>
  );
});

export function ThreadTimeline({
  threadId,
  turns,
  totalTurnCount,
  pendingRequests = [],
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
}: ThreadTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  const lastHandledScrollRequestKeyRef = useRef(scrollRequestKey);
  const previousContentSignatureRef = useRef<string | null>(null);
  const previousBottomSpacerRef = useRef(bottomSpacer);
  const lastObservedScrollHeightRef = useRef(0);
  const tailSentinelRef = useRef<HTMLDivElement | null>(null);
  const isTailVisibleRef = useRef(true);
  const shouldStickToBottomRef = useRef(true);
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
  const [isTailVisible, setIsTailVisible] = useState(true);
  const contentSignature = useMemo(
    () =>
      JSON.stringify({
        turns: turns.map((turn) => ({
          id: turn.id,
          status: turn.status,
          startedAt: turn.startedAt,
          error: turn.error,
          items: turn.items.map((item) => ({
            id: item.id,
            kind: item.kind,
            status: item.status,
            textLength: item.text.length,
          })),
        })),
        pendingRequests: pendingRequests.map((request) => ({
          id: request.id,
          turnId: request.turnId,
          title: request.title,
        })),
        pendingSteers: pendingSteers.map((steer) => ({
          id: steer.id,
          turnId: steer.turnId,
          prompt: steer.prompt,
          clientRequestId: steer.clientRequestId,
        })),
        optimisticSteers: optimisticSteers.map((steer) => ({
          id: steer.id,
          turnId: steer.turnId,
          prompt: steer.prompt,
          status: steer.status,
        })),
        liveOutputLength: liveOutput.length,
        livePlan:
          livePlan === null
            ? null
            : {
                turnId: livePlan.turnId,
                explanation: livePlan.explanation,
                steps: livePlan.plan.map((step) => `${step.status}:${step.step}`),
              },
        liveItems:
          liveItems === null
            ? null
            : {
                turnId: liveItems.turnId,
                items: liveItems.items.map((item) => ({
                  id: item.id,
                  kind: item.kind,
                  status: item.status,
                  textLength: item.text.length,
                })),
              },
        optimisticTurn:
          optimisticTurn === null
            ? null
            : {
                id: optimisticTurn.id,
                status: optimisticTurn.status,
                error: optimisticTurn.error,
                items: optimisticTurn.items.map((item) => ({
                  id: item.id,
                  kind: item.kind,
                  textLength: item.text.length,
                })),
              },
        answeredRequestNotes: answeredRequestNotes.map((note) => ({
          id: note.id,
          turnId: note.turnId ?? null,
          title: note.title,
          createdAt: note.createdAt ?? '',
          summaryLines: note.summaryLines,
        })),
        activityNotes: activityNotes.map((note) => ({
          id: note.id,
          kind: note.kind,
          text: note.text,
          createdAt: note.createdAt,
        })),
        ephemeralUserNote,
        bottomSpacer,
      }),
    [
      activityNotes,
      answeredRequestNotes,
      bottomSpacer,
      ephemeralUserNote,
      liveOutput,
      liveItems,
      livePlan,
      optimisticSteers,
      optimisticTurn,
      pendingSteers,
      pendingRequests,
      turns,
    ],
  );
  const serverManagedHistory =
    typeof onLoadEarlier === 'function' ||
    totalTurnCount !== undefined;

  const handleToggleCollapse = useCallback((turnId: string) => {
    setCollapsedTurns((current) => ({
      ...current,
      [turnId]: !current[turnId],
    }));
  }, []);

  const handleOpenExpandedText = useCallback((title: string, text: string) => {
    setExpandedText({ title, text });
  }, []);

  const handleOpenCommandDetail = useCallback(
    async (
      item: ThreadHistoryItemDto & { kind: 'commandExecution' },
      fallbackTitle: string,
    ) => {
      const inlineText = item.detailText?.trim() || item.text || 'Command output';
      if (!item.hasDeferredDetail || !onLoadHistoryItemDetail) {
        setExpandedText({ title: fallbackTitle, text: inlineText });
        return;
      }

      const cached = deferredDetailCacheRef.current.get(item.id);
      if (cached) {
        setExpandedText({ title: cached.title, text: cached.text });
        return;
      }

      const requestId = expandedTextRequestIdRef.current + 1;
      expandedTextRequestIdRef.current = requestId;
      setExpandedText({ title: fallbackTitle, text: 'Loading full command output...' });

      try {
        const detail = await onLoadHistoryItemDetail(item.id);
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
          text:
            caught instanceof Error
              ? caught.message
              : 'Unable to load full command output.',
        });
      }
    },
    [onLoadHistoryItemDetail],
  );

  const handleOpenToolCallDetail = useCallback(
    async (
      item: ThreadHistoryItemDto & { kind: 'toolCall' },
      fallbackTitle: string,
    ) => {
      const inlineText = item.detailText?.trim() || item.text || 'Tool call';
      if (!item.hasDeferredDetail || !onLoadHistoryItemDetail) {
        setExpandedText({ title: fallbackTitle, text: inlineText });
        return;
      }

      const cached = deferredDetailCacheRef.current.get(item.id);
      if (cached) {
        setExpandedText({ title: cached.title, text: cached.text });
        return;
      }

      const requestId = expandedTextRequestIdRef.current + 1;
      expandedTextRequestIdRef.current = requestId;
      setExpandedText({ title: fallbackTitle, text: 'Loading full tool call details...' });

      try {
        const detail = await onLoadHistoryItemDetail(item.id);
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
          text:
            caught instanceof Error
              ? caught.message
              : 'Unable to load full tool call details.',
        });
      }
    },
    [onLoadHistoryItemDetail],
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
    setIsTailVisible(nextIsTailVisible);
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      shouldStickToBottomRef.current = isNearBottom(container, FOLLOW_TAIL_THRESHOLD_PX);
    }
    recomputeTailVisibility();
  }, [recomputeTailVisibility]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
    lastObservedScrollHeightRef.current = container.scrollHeight;
    isTailVisibleRef.current = true;
    setIsTailVisible(true);
    shouldStickToBottomRef.current = true;
  }, []);

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
      shouldStickToBottomRef.current = isNearBottom(container, FOLLOW_TAIL_THRESHOLD_PX);
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
    const contentChanged = previousContentSignatureRef.current !== contentSignature;
    previousContentSignatureRef.current = contentSignature;
    const shouldAutoScroll =
      shouldForceScroll ||
      (contentChanged && (isTailVisible || shouldStickToBottomRef.current));

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
    contentSignature,
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

      if (!(shouldStickToBottomRef.current || isTailVisibleRef.current)) {
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
    if (!isTailVisible) {
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
  }, [bottomSpacer, isTailVisible, scrollToBottom]);

  useEffect(() => {
    onTailVisibilityChange?.(isTailVisible);
  }, [isTailVisible, onTailVisibilityChange]);

  const effectiveTotalTurnCount = totalTurnCount ?? turns.length;
  const startIndex = Math.max(0, turns.length - visibleCount);
  const visibleTurns = serverManagedHistory ? turns : turns.slice(startIndex);
  const visibleTurnAbsoluteOffset = serverManagedHistory
    ? Math.max(0, effectiveTotalTurnCount - turns.length)
    : startIndex;
  const optimisticAbsoluteIndex = effectiveTotalTurnCount + 1;
  const hiddenCount = serverManagedHistory
    ? Math.max(0, effectiveTotalTurnCount - turns.length)
    : turns.length - visibleTurns.length;
  const showLoadAll = !serverManagedHistory && hiddenCount > 0 && loadMoreClicks >= 2;
  const liveOutputTurnIndex =
    liveOutput && visibleTurns.length > 0
      ? visibleTurns.findLastIndex((turn) => isRunningHistoryStatus(turn.status))
      : -1;
  const liveOutputAttachedToOptimisticTurn =
    liveOutputTurnIndex < 0 &&
    !!liveOutput &&
    !!optimisticTurn &&
    optimisticTurn.status !== 'failed';
  const liveOutputAttachedToTurn =
    liveOutputTurnIndex >= 0 || liveOutputAttachedToOptimisticTurn;
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

    for (const note of sortedNotes) {
      if (note.anchorTurnId === '__leading__') {
        leading.push(note);
        continue;
      }
      if (note.anchorTurnId) {
        const current = afterTurnId.get(note.anchorTurnId) ?? [];
        current.push(note);
        afterTurnId.set(note.anchorTurnId, current);
        continue;
      }
      const anchor = turnSequence.find(
        (turn) => turn.startedAt && note.createdAt.localeCompare(turn.startedAt) <= 0,
      );
      if (!anchor) {
        trailing.push(note);
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
          data-testid="thread-scroll-container"
          onScroll={handleScroll}
          className="thread-scroll-container min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={bottomSpacer > 0 ? { paddingBottom: bottomSpacer } : undefined}
        >
          <div ref={scrollContentRef}>
          {turns.length > 0 && (
            <div className="px-2.5 pb-1 pt-2 sm:px-6 sm:pb-1.5 sm:pt-3">
              <div className="flex flex-wrap items-center gap-2.5 text-xs sm:text-sm">
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (serverManagedHistory) {
                        onLoadEarlier?.();
                        return;
                      }

                      setVisibleCount((current) =>
                        Math.min(turns.length, current + LOAD_STEP),
                      );
                      setLoadMoreClicks((current) => current + 1);
                    }}
                    disabled={loadingEarlier}
                    className="rounded-full border border-stone-700 px-2.5 py-1.5 text-stone-300 transition hover:bg-stone-800"
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
                <p className="text-stone-500">
                  Showing {visibleTurns.length} of {effectiveTotalTurnCount} turns
                  {hiddenCount > 0 ? ` · ${hiddenCount} earlier hidden` : ''}
                </p>
              </div>
            </div>
          )}

          {turns.length === 0 && !liveOutput && !optimisticTurn && (
            <div className="px-2.5 py-8 text-sm text-stone-500 sm:px-6">
              Send the first prompt to start the thread.
            </div>
          )}

          {(visibleTurns.length > 0 || optimisticTurn) && (
            <div className="divide-y divide-stone-800/80">
              {activityNoteAnchors.leading.length > 0 ? (
                <div className="space-y-3 border-b border-stone-800/80 px-2.5 py-4 sm:px-6">
                  {activityNoteAnchors.leading.map((note) => (
                    <ActivityNoteCard key={note.id} note={note} onOpenThread={onOpenThread} />
                  ))}
                </div>
              ) : null}
              {visibleTurns.map((turn, visibleIndex) => (
                <div key={turn.id}>
                  {(activityNoteAnchors.beforeTurnId.get(turn.id)?.length ?? 0) > 0 ? (
                    <div className="space-y-3 border-b border-stone-800/80 px-2.5 py-4 sm:px-6">
                      {(activityNoteAnchors.beforeTurnId.get(turn.id) ?? []).map((note) => (
                        <ActivityNoteCard key={note.id} note={note} onOpenThread={onOpenThread} />
                      ))}
                    </div>
                  ) : null}
                  <ThreadTurnRow
                    threadId={threadId}
                  turn={turn}
                  absoluteIndex={visibleTurnAbsoluteOffset + visibleIndex + 1}
                  isCollapsed={collapsedTurns[turn.id] ?? false}
                  livePlan={livePlan?.turnId === turn.id ? livePlan : null}
                  liveItems={liveItems?.turnId === turn.id ? liveItems.items : null}
                  liveOutput={visibleIndex === liveOutputTurnIndex ? liveOutput : ''}
                  onToggleCollapse={handleToggleCollapse}
                  onOpenExpandedText={handleOpenExpandedText}
                  onOpenCommandDetail={handleOpenCommandDetail}
                  onOpenToolCallDetail={handleOpenToolCallDetail}
                  scrollRootRef={scrollContainerRef}
                  articleRef={undefined}
                  />
                  {(activityNoteAnchors.afterTurnId.get(turn.id)?.length ?? 0) > 0 ? (
                    <div className="space-y-3 border-t border-stone-800/80 px-2.5 py-4 sm:px-6">
                      {(activityNoteAnchors.afterTurnId.get(turn.id) ?? []).map((note) => (
                        <ActivityNoteCard key={note.id} note={note} />
                      ))}
                    </div>
                  ) : null}
                  {(notesByTurnId.get(turn.id)?.length || pendingRequestsByTurnId.get(turn.id)?.length) ? (
                    <div className="space-y-3 border-t border-stone-800/80 px-2.5 py-4 sm:px-6">
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
              {optimisticTurn && (
                <>
                  {(activityNoteAnchors.beforeTurnId.get(optimisticTurn.id)?.length ?? 0) > 0 ? (
                    <div className="space-y-3 border-b border-stone-800/80 px-2.5 py-4 sm:px-6">
                      {(activityNoteAnchors.beforeTurnId.get(optimisticTurn.id) ?? []).map(
                        (note) => (
                          <ActivityNoteCard key={note.id} note={note} onOpenThread={onOpenThread} />
                        ),
                      )}
                    </div>
                  ) : null}
                  <ThreadTurnRow
                    threadId={threadId}
                    turn={optimisticTurn}
                    absoluteIndex={optimisticAbsoluteIndex}
                    isCollapsed={collapsedTurns[optimisticTurn.id] ?? false}
                    livePlan={null}
                    liveItems={null}
                    liveOutput={liveOutputAttachedToOptimisticTurn ? liveOutput : ''}
                    onToggleCollapse={handleToggleCollapse}
                    onOpenExpandedText={handleOpenExpandedText}
                    onOpenCommandDetail={handleOpenCommandDetail}
                    onOpenToolCallDetail={handleOpenToolCallDetail}
                    scrollRootRef={scrollContainerRef}
                  />
                  {(activityNoteAnchors.afterTurnId.get(optimisticTurn.id)?.length ?? 0) > 0 ? (
                    <div className="space-y-3 border-t border-stone-800/80 px-2.5 py-4 sm:px-6">
                      {(activityNoteAnchors.afterTurnId.get(optimisticTurn.id) ?? []).map(
                        (note) => (
                          <ActivityNoteCard key={note.id} note={note} onOpenThread={onOpenThread} />
                        ),
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {queuedSteers.length > 0 && (
            <div className="space-y-3 border-t border-stone-800/80 px-2.5 py-4 sm:px-6">
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
                />
              ))}
            </div>
          )}

          {(unanchoredPendingRequests.length > 0 ||
            unanchoredAnsweredNotes.length > 0 ||
            activityNoteAnchors.trailing.length > 0) && (
            <div className="space-y-3 border-t border-stone-800/80 px-2.5 py-4 sm:px-6">
              {[
                ...activityNoteAnchors.trailing.map((note) => ({
                  kind: 'activity' as const,
                  id: note.id,
                  createdAt: note.createdAt,
                  note,
                })),
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
              ]
                .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
                .map((entry) =>
                  entry.kind === 'activity' ? (
                    <ActivityNoteCard key={entry.id} note={entry.note} onOpenThread={onOpenThread} />
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
            <div className="border-t border-stone-800/80 px-2.5 py-2.5 sm:px-6">
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

          {liveOutput && !liveOutputAttachedToTurn && (
            <div className="border-t border-stone-800/80 px-2.5 py-2.5 sm:px-6">
              <CompactMessageItem
                threadId={threadId}
                item={{
                  id: 'live-agent-message-fallback',
                  kind: 'agentMessage',
                  text: liveOutput,
                }}
                scrollRootRef={scrollContainerRef}
                streaming
              />
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
