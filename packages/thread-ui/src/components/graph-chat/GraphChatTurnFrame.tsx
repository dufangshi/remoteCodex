import { type ReactNode, type RefCallback } from 'react';

export interface GraphChatTurnFrameProps {
  absoluteIndex: number;
  body: ReactNode;
  collapsed: boolean;
  error?: string | null;
  footer?: ReactNode;
  headerStatus?: ReactNode;
  isActive?: boolean;
  onToggleCollapse: () => void;
  refCallback?: RefCallback<HTMLElement> | undefined;
  startedAt?: string | null;
  timeLabel: string;
  timeTitle: string;
  tokenSummary?: ReactNode;
}

export function GraphChatTurnFrame({
  absoluteIndex,
  body,
  collapsed,
  error,
  footer,
  headerStatus,
  isActive = false,
  onToggleCollapse,
  refCallback,
  startedAt,
  timeLabel,
  timeTitle,
  tokenSummary,
}: GraphChatTurnFrameProps) {
  return (
    <article
      ref={refCallback}
      data-testid="chat-turn"
      data-turn-active={isActive ? 'true' : 'false'}
      className="thread-graph-turn px-3 py-2 sm:px-5 sm:py-3"
    >
      <div className="thread-graph-turn-header flex items-start justify-between gap-2">
        <div className="min-w-0 flex flex-1 items-start gap-1.5">
          <div className="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
            <span className="thread-graph-turn-index rounded-[0.6rem] border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em]">
              Turn {absoluteIndex}
            </span>
            <time
              dateTime={startedAt ?? undefined}
              title={timeTitle}
              className="thread-graph-turn-time shrink-0 text-[10px] sm:text-[11px]"
            >
              {timeLabel}
            </time>
            {headerStatus}
            {error ? (
              <p className="hidden truncate text-[11px] text-rose-200 sm:block">
                {error}
              </p>
            ) : null}
          </div>
          {tokenSummary}
        </div>
        <button
          type="button"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} turn ${absoluteIndex}`}
          title={collapsed ? 'Expand turn' : 'Collapse turn'}
          onClick={onToggleCollapse}
          className="thread-graph-turn-collapse inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5 fill-none stroke-current"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {collapsed ? (
              <path d="m4.5 10 3.5-3.5L11.5 10" />
            ) : (
              <path d="m4.5 6 3.5 3.5L11.5 6" />
            )}
          </svg>
        </button>
      </div>

      {error ? (
        <p className="mt-1 text-[11px] text-rose-200 sm:hidden">{error}</p>
      ) : null}

      {!collapsed ? (
        <div className="thread-graph-turn-body mt-2 space-y-2">
          {body}
          {footer}
        </div>
      ) : null}
    </article>
  );
}
