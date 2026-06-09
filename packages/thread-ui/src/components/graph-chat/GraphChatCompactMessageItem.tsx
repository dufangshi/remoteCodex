import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import { Brain, Copy } from 'lucide-react';

import type { ThreadHistoryItemDto } from '@remote-codex/shared';
import type { ThreadTimelineAdapter } from '../../adapters';
import {
  GraphChatAgentMessageBody,
  GraphChatLinkifiedPlainText,
  GraphChatUserMessageBody,
} from './GraphChatMessageBody';
import { GraphChatMessageFrame } from './GraphChatMessageFrame';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../graph-workspace/GraphAccordion';

type GraphChatCompactMessageKind = Extract<
  ThreadHistoryItemDto['kind'],
  'userMessage' | 'agentMessage'
>;

type GraphChatReasoningItem = ThreadHistoryItemDto & { kind: 'reasoning' };

type GraphChatCompactMessage = ThreadHistoryItemDto & {
  kind: GraphChatCompactMessageKind;
  reasoningItems?: GraphChatReasoningItem[] | undefined;
};

function isGraphChatRunningStatus(status?: string | null) {
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

function GraphChatRunningDots({
  tone = 'amber',
}: {
  tone?: 'amber' | 'sky';
}) {
  const dotClassName = tone === 'sky' ? 'bg-sky-300/90' : 'bg-amber-200/90';

  return (
    <span className="ml-1.5 inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`h-1.5 w-1.5 animate-pulse rounded-full ${dotClassName}`}
          style={{ animationDelay: `${index * 180}ms` }}
        />
      ))}
    </span>
  );
}

export const GraphChatCompactMessageItem = memo(
  function GraphChatCompactMessageItem({
    threadId,
    item,
    scrollRootRef,
    streaming = false,
    adapter,
    timeLabel,
    timeTitle,
  }: {
    threadId?: string | undefined;
    item: GraphChatCompactMessage;
    scrollRootRef: RefObject<HTMLDivElement | null>;
    streaming?: boolean;
    adapter?: ThreadTimelineAdapter;
    timeLabel?: string | null | undefined;
    timeTitle?: string | null | undefined;
  }) {
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
      'idle',
    );
    const [reasoningOpen, setReasoningOpen] = useState(false);
    const resetTimerRef = useRef<number | null>(null);
    const reasoningItems = item.kind === 'agentMessage' ? item.reasoningItems ?? [] : [];
    const reasoningText = reasoningItems
      .map((entry) => entry.text.trim())
      .filter(Boolean)
      .join('\n\n');
    const queuedLikeStatus =
      item.kind === 'userMessage' &&
      (item.status === 'Steering' ||
        item.status === 'Accepted' ||
        item.status === 'Awaiting response');

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
        resetTimerRef.current = window.setTimeout(
          () => setCopyState('idle'),
          1200,
        );
      } catch {
        setCopyState('failed');
        if (resetTimerRef.current !== null) {
          window.clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = window.setTimeout(
          () => setCopyState('idle'),
          1600,
        );
      }
    }

    const copyButton =
      item.kind === 'agentMessage' ? (
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
          className={`thread-graph-message-copy inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition ${
            copyState === 'copied'
              ? 'ui-status-info'
              : copyState === 'failed'
                ? 'ui-status-danger'
                : ''
          }`}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      ) : null;

    const reasoning =
      item.kind === 'agentMessage' && reasoningText ? (
        <div className="thread-graph-message-thinking mb-3 mt-2">
          <Accordion
            type="single"
            collapsible
            className="thread-graph-thinking-accordion w-full border-none"
            onValueChange={(value) => setReasoningOpen(Boolean(value))}
            {...(reasoningOpen ? { value: 'thoughts' } : {})}
          >
            <AccordionItem value="thoughts" className="border-b-0">
              <AccordionTrigger className="thread-graph-thinking-trigger py-2 hover:no-underline">
                <div className="thread-graph-thinking-label flex items-center gap-2 text-sm font-medium transition-colors">
                  <Brain
                    className={`h-4 w-4 ${
                      reasoningItems.some((entry) =>
                        isGraphChatRunningStatus(entry.status),
                      )
                        ? 'animate-pulse'
                        : ''
                    }`}
                  />
                  <span>
                    {reasoningItems.some((entry) =>
                      isGraphChatRunningStatus(entry.status),
                    )
                      ? 'Thinking...'
                      : 'Thought Process'}
                  </span>
                  {reasoningItems.some((entry) =>
                    isGraphChatRunningStatus(entry.status),
                  ) ? (
                    <GraphChatRunningDots tone="sky" />
                  ) : null}
                </div>
              </AccordionTrigger>
              <AccordionContent className="thread-graph-thinking-content pb-0">
                <pre className="thread-graph-thinking-body my-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border p-3 text-[12px] leading-5">
                  <GraphChatLinkifiedPlainText text={reasoningText} />
                </pre>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      ) : null;

    return (
      <GraphChatMessageFrame
        kind={item.kind}
        status={
          queuedLikeStatus
            ? item.status
            : item.kind === 'agentMessage'
              ? item.status
              : null
        }
        copyButton={copyButton}
        reasoning={reasoning}
        timeLabel={timeLabel}
        timeTitle={timeTitle}
      >
        {item.kind === 'agentMessage' ? (
          <GraphChatAgentMessageBody
            text={item.text}
            scrollRootRef={scrollRootRef}
            streaming={streaming}
          />
        ) : (
          <GraphChatUserMessageBody
            threadId={threadId}
            text={item.text}
            getImageAssetUrl={adapter?.getImageAssetUrl}
          />
        )}
      </GraphChatMessageFrame>
    );
  },
);
