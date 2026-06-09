import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import type { ThreadTimelineAdapter } from '../../adapters';
import { hasLikelyMarkdownSyntax } from '../markdownHeuristics';
import { GraphChatMessageContent } from './GraphChatMessageContent';

const LARGE_MESSAGE_PREVIEW_CHARS = 4_000;
const PLAIN_URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING_URL_PUNCTUATION_PATTERN = /[),.;:!?]+$/;

type UserMessageSegment =
  | { type: 'text'; key: string; text: string }
  | { type: 'photo'; key: string; path: string }
  | { type: 'file'; key: string; path: string };

function normalizeHref(value: string) {
  return value.startsWith('www.') ? `https://${value}` : value;
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

export function GraphChatLinkifiedPlainText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(PLAIN_URL_PATTERN)) {
    const rawMatch = match[0];
    const index = match.index ?? 0;
    const trailingPunctuation =
      rawMatch.match(TRAILING_URL_PUNCTUATION_PATTERN)?.[0] ?? '';
    const urlText = trailingPunctuation
      ? rawMatch.slice(0, -trailingPunctuation.length)
      : rawMatch;

    if (!urlText) {
      continue;
    }

    if (index > cursor) {
      parts.push(text.slice(cursor, index));
    }

    parts.push(
      <a
        key={`${index}-${urlText}`}
        href={normalizeHref(urlText)}
        target="_blank"
        rel="noreferrer"
        className="thread-inline-link"
      >
        {urlText}
      </a>,
    );

    if (trailingPunctuation) {
      parts.push(trailingPunctuation);
    }

    cursor = index + rawMatch.length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <>{parts.length > 0 ? parts : text}</>;
}

export const GraphChatMarkdownAwareBody = memo(
  function GraphChatMarkdownAwareBody({
    text,
    scrollRootRef,
    streaming = false,
    containerClassName = '',
    plainTextClassName = 'thread-graph-plain-text whitespace-pre-wrap break-words text-[15px] leading-6',
    markdownClassName = 'thread-graph-markdown',
  }: {
    text: string;
    scrollRootRef: RefObject<HTMLDivElement | null>;
    streaming?: boolean;
    containerClassName?: string;
    plainTextClassName?: string;
    markdownClassName?: string;
  }) {
    const messageRef = useRef<HTMLDivElement | null>(null);
    const [expanded, setExpanded] = useState(false);
    const shouldRenderMarkdown = hasLikelyMarkdownSyntax(text);
    const isLargeText = !streaming && text.length > LARGE_MESSAGE_PREVIEW_CHARS;
    const displayText =
      isLargeText && !expanded
        ? `${text.slice(0, LARGE_MESSAGE_PREVIEW_CHARS).trimEnd()}\n\n...`
        : text;
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
          <GraphChatMessageContent
            content={displayText}
            className={markdownClassName}
          />
        ) : (
          <p className={plainTextClassName}>
            <GraphChatLinkifiedPlainText text={displayText} />
          </p>
        )}
        {isLargeText ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="timeline-meta-text mt-2 inline-flex rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs transition hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)]"
          >
            {expanded
              ? 'Show less'
              : `Show full message (${text.length.toLocaleString()} chars)`}
          </button>
        ) : null}
      </div>
    );
  },
);

export const GraphChatAgentMessageBody = memo(
  function GraphChatAgentMessageBody({
    text,
    scrollRootRef,
    streaming = false,
  }: {
    text: string;
    scrollRootRef: RefObject<HTMLDivElement | null>;
    streaming?: boolean;
  }) {
    return (
      <GraphChatMarkdownAwareBody
        text={text}
        scrollRootRef={scrollRootRef}
        streaming={streaming}
        containerClassName="thread-graph-message-prose"
      />
    );
  },
);

export const GraphChatUserMessageBody = memo(
  function GraphChatUserMessageBody({
    threadId,
    text,
    getImageAssetUrl,
  }: {
    threadId?: string | undefined;
    text: string;
    getImageAssetUrl?: ThreadTimelineAdapter['getImageAssetUrl'] | undefined;
  }) {
    const segments = useMemo(() => tokenizeUserMessageText(text), [text]);

    return (
      <div className="thread-graph-message-prose whitespace-pre-wrap break-words text-[15px] leading-6">
        {segments.map((segment) => {
          if (segment.type === 'text') {
            return <span key={segment.key}>{segment.text}</span>;
          }

          if (segment.type === 'photo') {
            const imageUrl =
              threadId
                ? getImageAssetUrl?.({ threadId, path: segment.path }) ?? null
                : null;
            const label = basenameFromAssetPath(segment.path) || 'Attached image';

            return (
              <span
                key={segment.key}
                className="mx-[0.14rem] inline-flex align-middle"
              >
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
            <span
              key={segment.key}
              className="mx-[0.14rem] inline-flex align-middle"
            >
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
  },
);
