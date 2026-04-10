import { useEffect, useRef, useState } from 'react';
import { code } from '@streamdown/code';
import { Streamdown } from 'streamdown';

import type {
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../../../packages/shared/src/index';
import { LongTextDialog } from './LongTextDialog';
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

function itemSurfaceClassName(kind: ThreadHistoryItemDto['kind']) {
  switch (kind) {
    case 'userMessage':
      return 'bg-cyan-500/[0.045] text-stone-300';
    case 'agentMessage':
      return 'bg-emerald-500/[0.09] text-stone-100 shadow-lg shadow-stone-950/10';
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

function RunningDots() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 rounded-full bg-amber-200/90 animate-pulse"
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

function CompactMessageItem({
  item,
}: {
  item: ThreadHistoryItemDto & {
    kind: Extract<ThreadHistoryItemDto['kind'], 'userMessage' | 'agentMessage'>;
  };
}) {
  const iconToneClassName =
    item.kind === 'userMessage'
      ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200'
      : 'border-emerald-300/25 bg-emerald-300/12 text-emerald-100';

  const textToneClassName =
    item.kind === 'userMessage' ? 'text-stone-300' : 'text-stone-100';

  return (
    <div
      className={`rounded-[1.2rem] border border-stone-800/80 ${historyItemAccentClassName(item.kind)} border-l-2 ${itemSurfaceClassName(item.kind)} px-3 py-2.5`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${iconToneClassName}`}
        >
          <CompactMessageIcon kind={item.kind} />
        </span>
        <div className="min-w-0 flex-1">
          {item.kind === 'agentMessage' ? (
            <AgentMarkdown text={item.text} />
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
    </div>
  );
}

function CommandItem({
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
}

function GenericHistoryItem({ item }: { item: ThreadHistoryItemDto }) {
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
}

export function ThreadTimeline({
  turns,
  liveOutput,
  followTail = false,
  scrollRequestKey = 0,
  className = '',
}: ThreadTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_TURNS);
  const [loadMoreClicks, setLoadMoreClicks] = useState(0);
  const [expandedText, setExpandedText] = useState<ExpandedTextState | null>(
    null,
  );
  const [collapsedTurns, setCollapsedTurns] = useState<Record<string, boolean>>(
    {},
  );

  useEffect(() => {
    setVisibleCount((current) => {
      if (current >= turns.length - 1) {
        return turns.length;
      }

      return Math.max(current, INITIAL_VISIBLE_TURNS);
    });
  }, [turns.length]);

  useEffect(() => {
    if (!followTail) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }

      container.scrollTop = container.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [followTail, liveOutput, scrollRequestKey, turns]);

  const startIndex = Math.max(0, turns.length - visibleCount);
  const visibleTurns = turns.slice(startIndex);
  const hiddenCount = turns.length - visibleTurns.length;
  const showLoadAll = hiddenCount > 0 && loadMoreClicks >= 2;

  return (
    <>
      <section className={`flex min-h-0 flex-1 flex-col ${className}`.trim()}>
        <div
          ref={scrollContainerRef}
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
              {visibleTurns.map((turn, visibleIndex) => {
                const absoluteIndex = startIndex + visibleIndex + 1;
                const isCollapsed = collapsedTurns[turn.id] ?? false;

                return (
                  <article key={turn.id} className="px-4 py-2.5 sm:px-6">
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
                          <p className="text-xs text-rose-200 sm:text-sm">
                            {turn.error}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} turn ${absoluteIndex}`}
                        onClick={() =>
                          setCollapsedTurns((current) => ({
                            ...current,
                            [turn.id]: !isCollapsed,
                          }))
                        }
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
                        {turn.items.map((item) => {
                          if (isCompactChatItem(item.kind)) {
                            return (
                              <CompactMessageItem
                                key={item.id}
                                item={
                                  item as ThreadHistoryItemDto & {
                                    kind: 'userMessage' | 'agentMessage';
                                  }
                                }
                              />
                            );
                          }

                          if (item.kind === 'commandExecution') {
                            return (
                              <CommandItem
                                key={item.id}
                                item={
                                  item as ThreadHistoryItemDto & {
                                    kind: 'commandExecution';
                                  }
                                }
                                onOpen={(title, text) =>
                                  setExpandedText({ title, text })
                                }
                              />
                            );
                          }

                          return (
                            <GenericHistoryItem key={item.id} item={item} />
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {liveOutput && (
            <div className="border-t border-amber-300/15 bg-amber-300/5 px-4 py-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-amber-100">
                  Streaming output
                </p>
                <span className="rounded-full border border-amber-300/40 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-amber-200">
                  Live
                </span>
              </div>
              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-stone-200">
                {liveOutput}
              </pre>
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
