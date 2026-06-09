import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

import type { ThreadDetailDto } from '@remote-codex/shared';
import type {
  ThreadDetailUiAdapter,
  ThreadTimelineAdapter,
} from '../../adapters';
import { ThreadComposer, type ThreadComposerProps } from '../ThreadComposer';
import {
  ThreadTimeline,
  type ThreadTimelineProps,
} from '../ThreadTimeline';

export interface GraphChatThreadUsageSummary {
  input: number;
  output: number;
  cache: number;
  turns: number;
}

interface GraphChatThreadChatPanelProps {
  detail: ThreadDetailDto;
  adapter: ThreadDetailUiAdapter;
  timelineAdapter: ThreadTimelineAdapter;
  TimelineComponent?: ComponentType<ThreadTimelineProps>;
  liveOutput?: string;
  beforeTimelineContent?: ReactNode;
  composerProps?: Omit<ThreadComposerProps, 'activeView' | 'onSubmit'>;
  timelineProps?: Partial<
    Omit<ThreadTimelineProps, 'threadId' | 'turns' | 'liveOutput' | 'adapter'>
  >;
  threadUsageSummary: GraphChatThreadUsageSummary | null;
  transcriptItemCount: number;
  useFloatingMobileComposer?: boolean;
  floatingMobileComposerBottomOffset?: number;
  composerHostRef?: RefObject<HTMLDivElement | null>;
}

function formatTokenCount(value: number | undefined) {
  if (value === undefined) {
    return '-';
  }
  if (Math.abs(value) > 10_000) {
    const maximumFractionDigits = Math.abs(value) >= 100_000 ? 0 : 1;
    return `${(value / 1_000).toLocaleString(undefined, {
      maximumFractionDigits,
    })}k`;
  }
  return value.toLocaleString();
}

function formatThreadUsageParts(usage: GraphChatThreadUsageSummary) {
  return `in ${formatTokenCount(usage.input)} / out ${formatTokenCount(
    usage.output,
  )} / cache ${formatTokenCount(usage.cache)}`;
}

function buildChatContentRevision(detail: ThreadDetailDto, liveOutput: string) {
  const latestTurn = detail.turns.at(-1);
  const latestLiveItem = detail.liveItems?.items.at(-1);
  const latestPendingRequest = detail.pendingRequests.at(-1);
  return [
    detail.thread.id,
    detail.turns.length,
    latestTurn?.id ?? '',
    latestTurn?.items.length ?? 0,
    detail.liveItems?.items.length ?? 0,
    latestLiveItem?.id ?? '',
    detail.pendingRequests.length,
    latestPendingRequest?.id ?? '',
    liveOutput ? liveOutput.length : 0,
  ].join(':');
}

export function GraphChatThreadChatPanel({
  detail,
  adapter,
  timelineAdapter,
  TimelineComponent = ThreadTimeline,
  liveOutput = '',
  beforeTimelineContent,
  composerProps,
  timelineProps,
  threadUsageSummary,
  transcriptItemCount,
  useFloatingMobileComposer = false,
  floatingMobileComposerBottomOffset = 0,
  composerHostRef,
}: GraphChatThreadChatPanelProps) {
  const [isTailVisible, setIsTailVisible] = useState(true);
  const [showNewMessageReminder, setShowNewMessageReminder] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileComposerHeight, setMobileComposerHeight] = useState(0);
  const [mobileComposerOverlap, setMobileComposerOverlap] = useState(0);
  const [mobileKeyboardInset, setMobileKeyboardInset] = useState(0);
  const [mobilePromptFocused, setMobilePromptFocused] = useState(false);
  const lastRevisionRef = useRef<string | null>(null);
  const internalComposerHostRef = useRef<HTMLDivElement | null>(null);
  const contentRevision = useMemo(
    () => buildChatContentRevision(detail, liveOutput),
    [detail, liveOutput],
  );
  const timelineTailVisibilityChange = timelineProps?.onTailVisibilityChange;
  const hasPendingRequests = detail.pendingRequests.length > 0;

  useEffect(() => {
    lastRevisionRef.current = null;
    setIsTailVisible(true);
    setShowNewMessageReminder(false);
  }, [detail.thread.id]);

  useEffect(() => {
    const previousRevision = lastRevisionRef.current;
    lastRevisionRef.current = contentRevision;
    if (previousRevision === null || previousRevision === contentRevision) {
      return;
    }

    if (isTailVisible) {
      setShowNewMessageReminder(false);
      return;
    }

    setShowNewMessageReminder(true);
  }, [contentRevision, isTailVisible]);

  useEffect(() => {
    if (isTailVisible) {
      setShowNewMessageReminder(false);
    }
  }, [isTailVisible]);

  const handleTailVisibilityChange = useCallback(
    (nextIsTailVisible: boolean) => {
      setIsTailVisible(nextIsTailVisible);
      timelineTailVisibilityChange?.(nextIsTailVisible);
    },
    [timelineTailVisibilityChange],
  );

  const handleNewMessageReminderClick = useCallback(() => {
    composerProps?.onToggleFollow?.();
    setShowNewMessageReminder(false);
  }, [composerProps]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => {
      mediaQuery.removeEventListener('change', updateViewport);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateKeyboardInset = () => {
      const viewport = window.visualViewport;
      const keyboardInset = viewport
        ? Math.max(
            0,
            Math.round(
              window.innerHeight - viewport.height - viewport.offsetTop,
            ),
          )
        : 0;
      setMobileKeyboardInset(keyboardInset);
    };

    updateKeyboardInset();
    window.visualViewport?.addEventListener('resize', updateKeyboardInset);
    window.visualViewport?.addEventListener('scroll', updateKeyboardInset);
    window.addEventListener('resize', updateKeyboardInset);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateKeyboardInset);
      window.visualViewport?.removeEventListener('scroll', updateKeyboardInset);
      window.removeEventListener('resize', updateKeyboardInset);
    };
  }, []);

  useLayoutEffect(() => {
    const node = internalComposerHostRef.current;
    if (!node || !isMobileViewport) {
      setMobileComposerHeight(0);
      return;
    }

    const updateHeight = () => {
      setMobileComposerHeight(Math.ceil(node.getBoundingClientRect().height));
    };

    updateHeight();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [isMobileViewport, composerProps, hasPendingRequests]);

  useLayoutEffect(() => {
    const node = internalComposerHostRef.current;
    if (!node || !isMobileViewport) {
      setMobileComposerOverlap(0);
      return;
    }

    const updateOverlap = () => {
      const rect = node.getBoundingClientRect();
      setMobileComposerOverlap(
        Math.max(0, Math.ceil(window.innerHeight - rect.top)),
      );
    };

    updateOverlap();
    window.addEventListener('resize', updateOverlap);
    window.visualViewport?.addEventListener('resize', updateOverlap);
    window.visualViewport?.addEventListener('scroll', updateOverlap);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateOverlap);
      observer.observe(node);
    }

    return () => {
      window.removeEventListener('resize', updateOverlap);
      window.visualViewport?.removeEventListener('resize', updateOverlap);
      window.visualViewport?.removeEventListener('scroll', updateOverlap);
      observer?.disconnect();
    };
  }, [
    isMobileViewport,
    mobileKeyboardInset,
    mobilePromptFocused,
    composerProps,
    hasPendingRequests,
  ]);

  useEffect(() => {
    if (!isMobileViewport) {
      setMobilePromptFocused(false);
      return;
    }

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        internalComposerHostRef.current?.contains(target)
      ) {
        setMobilePromptFocused(true);
      }
    };
    const handleFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof HTMLElement &&
        internalComposerHostRef.current?.contains(nextTarget)
      ) {
        return;
      }
      setMobilePromptFocused(false);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [isMobileViewport]);

  const setComposerHostRefs = useCallback(
    (node: HTMLDivElement | null) => {
      internalComposerHostRef.current = node;
      if (composerHostRef) {
        (
          composerHostRef as RefObject<HTMLDivElement | null>
        ).current = node;
      }
    },
    [composerHostRef],
  );

  const mobileComposerBottomOffset =
    isMobileViewport && mobilePromptFocused ? mobileKeyboardInset : 0;
  const effectiveMobileComposerHeight = Math.max(mobileComposerHeight, 144);
  const effectiveMobileComposerOverlap = Math.max(
    mobileComposerOverlap,
    effectiveMobileComposerHeight + mobileComposerBottomOffset,
  );
  const chatScrollBottomSpacer = isMobileViewport
    ? effectiveMobileComposerOverlap + 12
    : 0;
  const panelStyle: CSSProperties | undefined =
    chatScrollBottomSpacer > 0
      ? ({
          '--thread-graph-chat-scroll-bottom-spacer': `${chatScrollBottomSpacer}px`,
        } as CSSProperties)
      : undefined;
  const floatingComposerStyle: CSSProperties | undefined =
    useFloatingMobileComposer && isMobileViewport
      ? {
          bottom: `${
            floatingMobileComposerBottomOffset + mobileComposerBottomOffset
          }px`,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }
      : undefined;

  return (
    <div
      data-testid="chat-panel"
      className="thread-graph-chat-panel relative flex h-full min-h-0 flex-col"
      style={panelStyle}
    >
      {beforeTimelineContent}
      <TimelineComponent
        threadId={detail.thread.id}
        turns={detail.turns}
        totalTurnCount={detail.totalTurnCount ?? detail.turns.length}
        pendingRequests={detail.pendingRequests}
        activeTurnId={detail.thread.activeTurnId}
        threadRunning={
          detail.thread.status === 'running' ||
          detail.thread.activeTurnId !== null
        }
        liveOutput={liveOutput}
        className="thread-timeline-surface min-h-0 flex-1"
        {...timelineProps}
        adapter={timelineAdapter}
        onOpenThread={timelineProps?.onOpenThread ?? adapter.openThread}
        onTailVisibilityChange={handleTailVisibilityChange}
      />
      {showNewMessageReminder ? (
        <div
          className="thread-graph-new-message-reminder"
          data-testid="new-message-reminder"
        >
          <button
            type="button"
            className="thread-graph-new-message-button"
            onClick={handleNewMessageReminderClick}
          >
            <span aria-hidden="true">↓</span>
            <span>New message</span>
          </button>
        </div>
      ) : null}
      <div className="thread-chat-usage-footer hidden shrink-0 items-center justify-between gap-3 px-4 py-1 text-[10px] leading-4 sm:flex">
        <span className="min-w-0 truncate">
          {detail.turns.length} turn{detail.turns.length !== 1 ? 's' : ''}
          <span className="mx-1 text-[var(--theme-border-contrast)]">|</span>
          {transcriptItemCount} item{transcriptItemCount !== 1 ? 's' : ''}
        </span>
        <span className="shrink-0">
          Usage{' '}
          {threadUsageSummary && threadUsageSummary.turns > 0
            ? formatThreadUsageParts(threadUsageSummary)
            : 'waiting for agent usage'}
        </span>
      </div>
      {composerProps ? (
        useFloatingMobileComposer ? (
          <div
            ref={setComposerHostRefs}
            className="fixed inset-x-0 bottom-0 z-50 overflow-visible sm:hidden"
            style={
              floatingComposerStyle ?? {
                bottom: `${floatingMobileComposerBottomOffset}px`,
                paddingBottom: 'env(safe-area-inset-bottom)',
              }
            }
          >
            <ThreadComposer
              {...composerProps}
              activeView="chat"
              edgeToEdgeMobile
              onSubmit={adapter.sendPrompt}
            />
          </div>
        ) : (
          <div
            ref={setComposerHostRefs}
            className="thread-graph-composer-host shrink-0"
          >
            <ThreadComposer
              {...composerProps}
              activeView="chat"
              onSubmit={adapter.sendPrompt}
            />
          </div>
        )
      ) : null}
    </div>
  );
}
