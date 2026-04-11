import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefCallback,
  type RefObject,
} from 'react';
import { code } from '@streamdown/code';
import { Streamdown } from 'streamdown';

import type {
  RespondThreadActionRequestInput,
  ThreadActionRequestDto,
  ThreadHistoryItemDto,
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
  threadId?: string;
  turns: ThreadTurnDto[];
  totalTurnCount?: number;
  pendingRequests?: ThreadActionRequestDto[];
  livePlan?: {
    turnId: string;
    explanation: string | null;
    plan: Array<{ step: string; status: string }>;
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
    title: string;
    summaryLines: string[];
  }>;
  optimisticTurn?: TimelineTurn | null;
}

interface ExpandedTextState {
  title: string;
  text: string;
}

type TimelineTurn = Omit<ThreadTurnDto, 'status'> & {
  status: ThreadTurnDto['status'] | 'sending';
};

const INITIAL_VISIBLE_TURNS = 10;
const LOAD_STEP = 10;
const FOLLOW_TAIL_THRESHOLD_PX = 80;

function itemSurfaceClassName(kind: ThreadHistoryItemDto['kind']) {
  switch (kind) {
    case 'userMessage':
      return 'bg-cyan-500/[0.045] text-stone-300';
    case 'agentMessage':
      return 'bg-slate-400/[0.11] text-stone-100 shadow-lg shadow-stone-950/10';
    case 'image':
      return 'bg-indigo-400/[0.07] text-stone-100';
    case 'commandExecution':
      return 'bg-amber-500/[0.06] text-stone-200';
    case 'webSearch':
      return 'bg-sky-400/[0.07] text-stone-100';
    case 'reasoning':
      return 'bg-violet-500/[0.05] text-stone-300';
    case 'toolCall':
      return 'bg-fuchsia-500/[0.05] text-stone-300';
    case 'plan':
      return 'bg-sky-500/[0.05] text-stone-300';
    case 'fileChange':
      return 'bg-lime-500/[0.05] text-stone-300';
    case 'other':
      return 'bg-stone-950 text-stone-300';
  }
}

function overlayBadgeClassName(
  tone: 'user' | 'agent' | 'command' | 'search' | 'action',
) {
  switch (tone) {
    case 'user':
      return 'border-cyan-400/30 bg-cyan-400/12 text-cyan-200';
    case 'agent':
      return 'border-slate-300/35 bg-slate-200/14 text-slate-100';
    case 'command':
      return 'border-amber-300/30 bg-amber-300/12 text-amber-200';
    case 'search':
      return 'border-sky-300/35 bg-sky-300/14 text-sky-100';
    case 'action':
      return 'border-stone-700/90 bg-stone-900/75 text-stone-300';
  }
}

function normalizeLines(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  while (lines.length > 1 && lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  return lines;
}

function summarizeCommandText(text: string) {
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

function isCompactChatItem(kind: ThreadHistoryItemDto['kind']) {
  return kind === 'userMessage' || kind === 'agentMessage';
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

function isNearBottom(container: HTMLDivElement) {
  const distanceFromBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight;
  return distanceFromBottom <= FOLLOW_TAIL_THRESHOLD_PX;
}

function isElementVisible(container: HTMLDivElement, element: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const visibleTop = Math.max(containerRect.top, elementRect.top);
  const visibleBottom = Math.min(containerRect.bottom, elementRect.bottom);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  return visibleHeight > 0;
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
  tone?: 'amber' | 'emerald';
}) {
  const dotClassName =
    tone === 'emerald' ? 'bg-sky-200/90' : 'bg-amber-200/90';

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
        className="inline-flex h-4 w-4 items-center justify-center text-emerald-200"
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
        className="inline-flex h-4 w-4 items-center justify-center text-rose-200"
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
        className="inline-flex h-4 w-4 items-center justify-center text-amber-200"
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

function formatTurnRuntimeSummary(turn: TimelineTurn) {
  const modelLabel = turn.model?.trim() ? turn.model.trim() : '--';

  if (turn.reasoningEffortAvailable === null || turn.reasoningEffortAvailable === undefined) {
    return `${modelLabel} · --`;
  }

  if (turn.reasoningEffortAvailable === false) {
    return `${modelLabel} · -`;
  }

  return `${modelLabel} · ${turn.reasoningEffort ?? '--'}`;
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

const CompactMessageItem = memo(function CompactMessageItem({
  item,
  scrollRootRef,
  streaming = false,
}: {
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
      ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200'
      : 'border-slate-300/30 bg-slate-200/12 text-slate-100';

  const textToneClassName =
    item.kind === 'userMessage' ? 'text-stone-300' : 'text-stone-100';

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
      className={`relative min-w-0 w-full overflow-hidden rounded-[1rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2.5 sm:rounded-[1.2rem] sm:px-3`}
    >
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
            <p
              className={`whitespace-pre-wrap break-words text-[15px] leading-6 ${textToneClassName}`}
            >
              {item.text}
            </p>
          )}
          {item.status && (
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
  onOpen: (title: string, text: string) => void;
}) {
  const summary = summarizeCommandText(item.text);

  return (
    <div
      className={`relative min-w-0 w-full overflow-hidden rounded-[1rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-2.5 py-2.5 sm:rounded-[1.2rem] sm:px-3`}
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
        <div className="relative min-w-0 w-full flex-1 rounded-[0.9rem] border border-stone-800/80 bg-stone-950/45 px-2.5 py-2.5 pt-6 sm:rounded-xl sm:px-3 sm:py-2">
          <button
            type="button"
            aria-label="Expand command"
            title="Expand command"
            onClick={() => onOpen('Command Output', item.text)}
            className={`absolute right-0 top-0 inline-flex h-5 w-5 items-center justify-center rounded-bl-[0.7rem] rounded-tr-[0.9rem] border shadow-sm shadow-stone-950/25 transition sm:right-2 sm:top-2 sm:h-7 sm:w-7 sm:rounded-full ${overlayBadgeClassName('action')} hover:bg-stone-800`}
          >
            <span className="scale-[0.72] sm:scale-100">
              <ExpandIcon />
            </span>
          </button>
          {item.status ? (
            <p className="absolute left-2.5 right-8 top-0 flex h-5 items-center truncate text-xs text-stone-500 sm:left-3 sm:right-10 sm:top-2 sm:h-7">
              {item.status}
            </p>
          ) : null}
          <button
            type="button"
            aria-label="Open full command"
            onClick={() => onOpen('Command Output', item.text)}
            className="block w-full text-left"
          >
            <div className="flex min-w-0 items-center gap-2 text-sm leading-6">
              <p className="min-w-0 flex-1 truncate whitespace-nowrap text-stone-200">
                {summary.firstLine}
              </p>
              {summary.showGap ? (
                <span className="shrink-0 text-[11px] font-medium tracking-[0.28em] text-stone-500/90">
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

const WebSearchItem = memo(function WebSearchItem({
  item,
  onOpen,
}: {
  item: ThreadHistoryItemDto & { kind: 'webSearch' };
  onOpen: (title: string, text: string) => void;
}) {
  const previewText = item.previewText?.trim() || item.text || 'Web search';
  const detailText = item.detailText?.trim() || item.text || 'Web search';

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
        <div className="relative min-w-0 w-full flex-1 rounded-[0.9rem] border border-stone-800/80 bg-stone-950/45 px-2.5 py-2.5 pt-6 sm:rounded-xl sm:px-3 sm:py-2 sm:pt-2">
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
            className="mt-1 block w-full text-left"
          >
            <pre className="pr-8 whitespace-pre-wrap break-words text-sm leading-6 text-stone-100 sm:pr-10">
              {previewText}
            </pre>
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
}: {
  threadId: string | undefined;
  item: ThreadHistoryItemDto;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  onOpenExpandedText: (title: string, text: string) => void;
}) {
  if (isCompactChatItem(item.kind)) {
    return (
      <CompactMessageItem
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
        onOpen={onOpenExpandedText}
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
    title: string;
    summaryLines: string[];
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

const ThreadTurnRow = memo(function ThreadTurnRow({
  threadId,
  turn,
  absoluteIndex,
  isCollapsed,
  liveOutput,
  onToggleCollapse,
  onOpenExpandedText,
  scrollRootRef,
  articleRef,
}: {
  threadId: string | undefined;
  turn: TimelineTurn;
  absoluteIndex: number;
  isCollapsed: boolean;
  liveOutput: string;
  onToggleCollapse: (turnId: string) => void;
  onOpenExpandedText: (title: string, text: string) => void;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  articleRef?: RefCallback<HTMLElement> | undefined;
}) {
  const runtimeSummary = formatTurnRuntimeSummary(turn);

  return (
    <article ref={articleRef} className="px-2 py-1.5 sm:px-6 sm:py-2">
      <div className="flex items-start justify-between gap-2">
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
          <TurnStatusIndicator status={turn.status} />
          <span
            title={runtimeSummary}
            className="min-w-0 truncate text-[10px] text-stone-500 sm:text-[11px]"
          >
            {runtimeSummary}
          </span>
          {turn.error && (
            <p className="hidden truncate text-[11px] text-rose-200 sm:block">
              {turn.error}
            </p>
          )}
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
          {turn.items.map((item) => (
            <HistoryItemRow
              key={item.id}
              threadId={threadId}
              item={item}
              scrollRootRef={scrollRootRef}
              onOpenExpandedText={onOpenExpandedText}
            />
          ))}
          {liveOutput && (
            <CompactMessageItem
              item={{
                id: 'live-agent-message',
                kind: 'agentMessage',
                text: liveOutput,
              }}
              scrollRootRef={scrollRootRef}
              streaming
            />
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
  livePlan = null,
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
  optimisticTurn = null,
}: ThreadTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastHandledScrollRequestKeyRef = useRef(scrollRequestKey);
  const previousBottomSpacerRef = useRef(bottomSpacer);
  const tailSentinelRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_TURNS);
  const [loadMoreClicks, setLoadMoreClicks] = useState(0);
  const [expandedText, setExpandedText] = useState<ExpandedTextState | null>(null);
  const [collapsedTurns, setCollapsedTurns] = useState<Record<string, boolean>>(
    {},
  );
  const [isTailVisible, setIsTailVisible] = useState(true);
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

  const recomputeTailVisibility = useCallback(() => {
    const container = scrollContainerRef.current;
    const tailSentinel = tailSentinelRef.current;
    if (!container) {
      return;
    }

    setIsTailVisible(
      tailSentinel
        ? isElementVisible(container, tailSentinel)
        : isNearBottom(container),
    );
  }, []);

  const handleScroll = useCallback(() => {
    recomputeTailVisibility();
  }, [recomputeTailVisibility]);

  useEffect(() => {
    setVisibleCount((current) => {
      if (current >= turns.length - 1) {
        return turns.length;
      }

      return Math.max(current, INITIAL_VISIBLE_TURNS);
    });
  }, [turns.length]);

  useEffect(() => {
    recomputeTailVisibility();
  }, [
    bottomSpacer,
    ephemeralUserNote,
    liveOutput,
    livePlan,
    pendingRequests.length,
    recomputeTailVisibility,
    turns.length,
    visibleCount,
  ]);

  useEffect(() => {
    const shouldForceScroll =
      scrollRequestKey !== lastHandledScrollRequestKeyRef.current;
    const shouldAutoScroll = isTailVisible || shouldForceScroll;

    if (!shouldAutoScroll) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }

      container.scrollTop = container.scrollHeight;
      setIsTailVisible(true);
    });

    if (scrollRequestKey !== lastHandledScrollRequestKeyRef.current) {
      lastHandledScrollRequestKeyRef.current = scrollRequestKey;
    }

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    bottomSpacer,
    isTailVisible,
    liveOutput,
    livePlan,
    pendingRequests,
    scrollRequestKey,
    turns,
  ]);

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
      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }

      container.scrollTop = container.scrollHeight;
      setIsTailVisible(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [bottomSpacer, isTailVisible]);

  useEffect(() => {
    onTailVisibilityChange?.(isTailVisible);
  }, [isTailVisible, onTailVisibilityChange]);

  const effectiveTotalTurnCount = totalTurnCount ?? turns.length;
  const startIndex = Math.max(0, turns.length - visibleCount);
  const visibleTurns = serverManagedHistory ? turns : turns.slice(startIndex);
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
              {visibleTurns.map((turn, visibleIndex) => (
                <ThreadTurnRow
                  key={turn.id}
                  threadId={threadId}
                  turn={turn}
                  absoluteIndex={startIndex + visibleIndex + 1}
                  isCollapsed={collapsedTurns[turn.id] ?? false}
                  liveOutput={visibleIndex === liveOutputTurnIndex ? liveOutput : ''}
                  onToggleCollapse={handleToggleCollapse}
                  onOpenExpandedText={handleOpenExpandedText}
                  scrollRootRef={scrollContainerRef}
                  articleRef={undefined}
                />
              ))}
              {optimisticTurn && (
                <ThreadTurnRow
                  threadId={threadId}
                  turn={optimisticTurn}
                  absoluteIndex={optimisticAbsoluteIndex}
                  isCollapsed={collapsedTurns[optimisticTurn.id] ?? false}
                  liveOutput={liveOutputAttachedToOptimisticTurn ? liveOutput : ''}
                  onToggleCollapse={handleToggleCollapse}
                  onOpenExpandedText={handleOpenExpandedText}
                  scrollRootRef={scrollContainerRef}
                />
              )}
            </div>
          )}

          {livePlan && (
            <div className="border-t border-sky-300/15 bg-sky-300/5 px-2.5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-sky-100">Plan update</p>
                <span className="rounded-full border border-sky-300/40 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-sky-200">
                  Live
                </span>
              </div>
              {livePlan.explanation && (
                <p className="mt-3 text-sm text-stone-300">{livePlan.explanation}</p>
              )}
              <div className="mt-3 space-y-2">
                {livePlan.plan.map((step, index) => (
                  <div
                    key={`${livePlan.turnId}-${index}`}
                    className="flex items-center gap-2 rounded-xl border border-stone-800/80 bg-stone-950/45 px-3 py-2 text-sm"
                  >
                    <span className="rounded-full border border-stone-700 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-400">
                      {step.status}
                    </span>
                    <span className="text-stone-200">{step.step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(pendingRequests.length > 0 || answeredRequestNotes.length > 0) && (
            <div className="space-y-3 border-t border-stone-800/80 px-2.5 py-4 sm:px-6">
              {answeredRequestNotes.map((note) => (
                <AnsweredRequestNote key={note.id} note={note} />
              ))}
              {pendingRequests.map((request) => (
                <PendingRequestCard
                  key={request.id}
                  request={request}
                  busy={respondingRequestId === request.id}
                  onRespond={onRespondToRequest ?? undefined}
                />
              ))}
            </div>
          )}

          {ephemeralUserNote && (
            <div className="border-t border-stone-800/80 px-2.5 py-2.5 sm:px-6">
              <CompactMessageItem
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
      </section>

      <LongTextDialog
        open={expandedText !== null}
        title={expandedText?.title ?? 'Full text'}
        text={expandedText?.text ?? ''}
        onClose={() => setExpandedText(null)}
      />
    </>
  );
}
