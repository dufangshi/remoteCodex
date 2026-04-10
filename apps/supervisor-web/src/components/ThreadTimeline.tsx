import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
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
  turnStatusClassName,
  turnStatusLabel,
} from './threadPresentation';

interface ThreadTimelineProps {
  turns: ThreadTurnDto[];
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
  followTail?: boolean;
  scrollRequestKey?: number;
  className?: string;
}

interface ExpandedTextState {
  title: string;
  text: string;
}

const INITIAL_VISIBLE_TURNS = 10;
const LOAD_STEP = 10;
const FOLLOW_TAIL_THRESHOLD_PX = 80;

function itemSurfaceClassName(kind: ThreadHistoryItemDto['kind']) {
  switch (kind) {
    case 'userMessage':
      return 'bg-cyan-500/[0.045] text-stone-300';
    case 'agentMessage':
      return 'bg-slate-400/[0.11] text-stone-100 shadow-lg shadow-stone-950/10';
    case 'commandExecution':
      return 'bg-amber-500/[0.06] text-stone-200';
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

function normalizeLines(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  while (lines.length > 1 && lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  return lines;
}

function summarizeCommandText(text: string) {
  const lines = normalizeLines(text);

  if (lines.length <= 2) {
    return {
      previewText: lines.join('\n'),
      isTruncated: false,
    };
  }

  return {
    previewText: `${lines[0]}\n...\n${lines.at(-1)}`,
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

function AgentMarkdown({ text }: { text: string }) {
  return (
    <Streamdown
      mode="static"
      plugins={{ code }}
      controls={false}
      lineNumbers={false}
      className="agent-markdown"
    >
      {text}
    </Streamdown>
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
    <div ref={messageRef} className="pb-7">
      {isActivated && shouldRenderMarkdown ? (
        <AgentMarkdown text={text} />
      ) : (
        <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-stone-100">
          {text}
        </p>
      )}
    </div>
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
      className={`relative rounded-[1.2rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-3 py-2.5`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex shrink-0 items-center">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${iconToneClassName}`}
          >
            <CompactMessageIcon kind={item.kind} />
          </span>
          {streaming && item.kind === 'agentMessage' && <RunningDots tone="emerald" />}
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
          className={`absolute bottom-2.5 right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur transition ${
            copyState === 'copied'
              ? 'border-sky-300/40 bg-sky-300/16 text-sky-100'
              : copyState === 'failed'
                ? 'border-rose-300/35 bg-rose-300/12 text-rose-100'
                : 'border-stone-700/90 bg-stone-900/60 text-stone-300 hover:bg-stone-800/92'
          }`}
        >
          <CopyIcon />
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
      className={`rounded-[1.2rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-3 py-2.5`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex shrink-0 items-center">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-300/25 bg-amber-300/10 text-amber-200">
            <CommandIcon />
          </span>
          {isRunningHistoryStatus(item.status) && <RunningDots />}
        </div>
        <div className="relative min-w-0 flex-1 rounded-xl border border-stone-800/80 bg-stone-950/45 px-3 py-2">
          <button
            type="button"
            aria-label="Expand command"
            title="Expand command"
            onClick={() => onOpen('Command Output', item.text)}
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-700/90 bg-stone-900/90 text-stone-300 transition hover:bg-stone-800"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 fill-none stroke-current"
              strokeWidth="1.45"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6.25 2.75H2.75v3.5" />
              <path d="M9.75 13.25h3.5v-3.5" />
              <path d="m2.75 6.25 3.5-3.5" />
              <path d="m9.75 9.75 3.5 3.5" />
              <path d="M9.75 2.75h3.5v3.5" />
              <path d="M6.25 13.25h-3.5v-3.5" />
              <path d="m13.25 6.25-3.5-3.5" />
              <path d="m6.25 9.75-3.5 3.5" />
            </svg>
          </button>
          {item.status && (
            <p className="pr-10 text-xs text-stone-500">{item.status}</p>
          )}
          <button
            type="button"
            aria-label="Open full command"
            onClick={() => onOpen('Command Output', item.text)}
            className="mt-1 block w-full text-left"
          >
            <pre className="pr-10 whitespace-pre-wrap break-words text-sm leading-6 text-stone-200">
              {summary.previewText}
            </pre>
          </button>
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
      className={`rounded-[1.2rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-3 py-2.5`}
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
  item,
  scrollRootRef,
  onOpenExpandedText,
}: {
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
  const primaryQuestion = request.questions[0] ?? null;
  const OTHER_SENTINEL = '__other__';

  function respondWithSingleAnswer(answer: string) {
    if (!primaryQuestion) {
      return;
    }

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
    <div className="rounded-[1.2rem] border border-sky-300/20 bg-sky-300/[0.06] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-sky-100">{request.title}</p>
          {request.description && (
            <p className="mt-1 text-sm text-stone-300">{request.description}</p>
          )}
        </div>
        <span className="rounded-full border border-sky-300/30 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-sky-200">
          Action
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {request.questions.map((question) => (
          <div
            key={question.id}
            className="rounded-xl border border-stone-800/80 bg-stone-950/45 p-3"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-stone-500">
              {question.header}
            </p>
            <p className="mt-1 text-sm text-stone-100">{question.question}</p>
            {request.kind === 'planDecision' && question.options && question.options.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {question.options.map((option, index) => (
                  <button
                    key={option.label}
                    type="button"
                    disabled={busy}
                    onClick={() => respondWithSingleAnswer(option.label)}
                    className={`rounded-full border px-3 py-2 text-sm transition ${
                      index === 0
                        ? 'border-sky-300/45 bg-sky-300/90 text-slate-950 hover:bg-sky-200'
                        : 'border-stone-700 text-stone-200 hover:bg-stone-800'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                    title={option.description}
                  >
                    {busy && index === 0 ? 'Starting...' : option.label}
                  </button>
                ))}
              </div>
            ) : question.options && question.options.length > 0 ? (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  {question.options.map((option) => (
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
                      className={`rounded-full border px-3 py-2 text-sm transition ${
                        answers[question.id] === option.label
                          ? 'border-amber-300/50 bg-amber-300/12 text-amber-100'
                          : 'border-stone-700 text-stone-300 hover:bg-stone-800'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                      title={option.description}
                    >
                      {option.label}
                    </button>
                  ))}
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
                      className={`rounded-full border px-3 py-2 text-sm transition ${
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

const ThreadTurnRow = memo(function ThreadTurnRow({
  turn,
  absoluteIndex,
  isCollapsed,
  liveOutput,
  onToggleCollapse,
  onOpenExpandedText,
  scrollRootRef,
}: {
  turn: ThreadTurnDto;
  absoluteIndex: number;
  isCollapsed: boolean;
  liveOutput: string;
  onToggleCollapse: (turnId: string) => void;
  onOpenExpandedText: (title: string, text: string) => void;
  scrollRootRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <article className="px-4 py-2.5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-stone-700 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-stone-400">
              Turn {absoluteIndex}
            </span>
            <time
              dateTime={turn.startedAt ?? undefined}
              title={formatLongTimestamp(turn.startedAt)}
              className="text-xs text-stone-400 sm:text-sm"
            >
              {formatShortTimestamp(turn.startedAt)}
            </time>
            <span
              className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${turnStatusClassName(turn.status)}`}
            >
              {turnStatusLabel(turn.status)}
            </span>
          </div>
          {turn.error && (
            <p className="text-xs text-rose-200 sm:text-sm">{turn.error}</p>
          )}
        </div>
        <button
          type="button"
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} turn ${absoluteIndex}`}
          onClick={() => onToggleCollapse(turn.id)}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-stone-700 text-stone-300 transition hover:bg-stone-800"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5 fill-none stroke-current"
            strokeWidth="1.5"
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

      {!isCollapsed && (
        <div className="mt-2 space-y-1.5">
          {turn.items.map((item) => (
            <HistoryItemRow
              key={item.id}
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
  turns,
  pendingRequests = [],
  livePlan = null,
  respondingRequestId = null,
  onRespondToRequest,
  liveOutput,
  followTail = false,
  scrollRequestKey = 0,
  className = '',
}: ThreadTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastHandledScrollRequestKeyRef = useRef(scrollRequestKey);
  const previousFollowTailRef = useRef(followTail);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_TURNS);
  const [loadMoreClicks, setLoadMoreClicks] = useState(0);
  const [expandedText, setExpandedText] = useState<ExpandedTextState | null>(null);
  const [collapsedTurns, setCollapsedTurns] = useState<Record<string, boolean>>(
    {},
  );
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

  const handleToggleCollapse = useCallback((turnId: string) => {
    setCollapsedTurns((current) => ({
      ...current,
      [turnId]: !current[turnId],
    }));
  }, []);

  const handleOpenExpandedText = useCallback((title: string, text: string) => {
    setExpandedText({ title, text });
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    setIsPinnedToBottom(isNearBottom(container));
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
    if (!container) {
      return;
    }

    setIsPinnedToBottom(isNearBottom(container));
  }, [turns.length, visibleCount]);

  useEffect(() => {
    const shouldForceScroll =
      scrollRequestKey !== lastHandledScrollRequestKeyRef.current ||
      (followTail && !previousFollowTailRef.current);
    const shouldAutoScroll = followTail && (isPinnedToBottom || shouldForceScroll);

    if (!shouldAutoScroll) {
      previousFollowTailRef.current = followTail;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }

      container.scrollTop = container.scrollHeight;
      setIsPinnedToBottom(true);
    });

    if (scrollRequestKey !== lastHandledScrollRequestKeyRef.current) {
      lastHandledScrollRequestKeyRef.current = scrollRequestKey;
    }
    previousFollowTailRef.current = followTail;

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    followTail,
    isPinnedToBottom,
    liveOutput,
    livePlan,
    pendingRequests,
    scrollRequestKey,
    turns,
  ]);

  const startIndex = Math.max(0, turns.length - visibleCount);
  const visibleTurns = turns.slice(startIndex);
  const hiddenCount = turns.length - visibleTurns.length;
  const showLoadAll = hiddenCount > 0 && loadMoreClicks >= 2;
  const liveOutputTurnIndex =
    liveOutput && visibleTurns.length > 0
      ? visibleTurns.findLastIndex((turn) => isRunningHistoryStatus(turn.status))
      : -1;
  const liveOutputAttachedToTurn = liveOutputTurnIndex >= 0;

  return (
    <>
      <section className={`flex min-h-0 flex-1 flex-col ${className}`.trim()}>
        <div
          ref={scrollContainerRef}
          data-testid="thread-scroll-container"
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="sticky top-0 z-10 border-b border-stone-800/80 bg-stone-900/95 px-4 py-3 backdrop-blur sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-stone-400">
                {turns.length === 0
                  ? 'No historical turns yet.'
                  : `Showing ${visibleTurns.length} of ${turns.length} turns.`}
              </p>
              {hiddenCount > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-stone-500">
                    {hiddenCount} earlier hidden
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setVisibleCount((current) =>
                        Math.min(turns.length, current + LOAD_STEP),
                      );
                      setLoadMoreClicks((current) => current + 1);
                    }}
                    className="rounded-full border border-stone-700 px-3 py-2 text-sm text-stone-300 transition hover:bg-stone-800"
                  >
                    Load 10 earlier
                  </button>
                  {showLoadAll && (
                    <button
                      type="button"
                      onClick={() => setVisibleCount(turns.length)}
                      className="rounded-full border border-amber-300/40 px-3 py-2 text-sm text-amber-200 transition hover:bg-amber-300/10"
                    >
                      Load full history
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {turns.length === 0 && !liveOutput && (
            <div className="px-4 py-8 text-sm text-stone-500 sm:px-6">
              Send the first prompt to start the thread.
            </div>
          )}

          {visibleTurns.length > 0 && (
            <div className="divide-y divide-stone-800/80">
              {visibleTurns.map((turn, visibleIndex) => (
                <ThreadTurnRow
                  key={turn.id}
                  turn={turn}
                  absoluteIndex={startIndex + visibleIndex + 1}
                  isCollapsed={collapsedTurns[turn.id] ?? false}
                  liveOutput={visibleIndex === liveOutputTurnIndex ? liveOutput : ''}
                  onToggleCollapse={handleToggleCollapse}
                  onOpenExpandedText={handleOpenExpandedText}
                  scrollRootRef={scrollContainerRef}
                />
              ))}
            </div>
          )}

          {livePlan && (
            <div className="border-t border-sky-300/15 bg-sky-300/5 px-4 py-4 sm:px-6">
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

          {pendingRequests.length > 0 && (
            <div className="space-y-3 border-t border-stone-800/80 px-4 py-4 sm:px-6">
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

          {liveOutput && !liveOutputAttachedToTurn && (
            <div className="border-t border-stone-800/80 px-4 py-2.5 sm:px-6">
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
