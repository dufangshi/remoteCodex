import type { ReactNode } from 'react';

interface GraphChatHistoryGroupFrameProps {
  children: ReactNode;
  className: string;
  count: number;
  countBadgeClassName: string;
  desktopIconClassName: string;
  expanded: boolean;
  expandedListClassName: string;
  icon: ReactNode;
  onToggleExpanded: () => void;
  runningIndicator?: ReactNode;
  summary: ReactNode;
  toggleAriaLabel: string;
  trailingSummary?: ReactNode;
}

export function GraphChatHistoryGroupFrame({
  children,
  className,
  count,
  countBadgeClassName,
  desktopIconClassName,
  expanded,
  expandedListClassName,
  icon,
  onToggleExpanded,
  runningIndicator,
  summary,
  toggleAriaLabel,
  trailingSummary,
}: GraphChatHistoryGroupFrameProps) {
  return (
    <div
      className={`thread-graph-history-group ${className} relative min-w-0 w-full overflow-hidden rounded-[0.9rem] border px-3 py-2.5`}
    >
      <div className="flex items-start gap-2.5">
        <div className="thread-graph-history-group-icon mt-0.5 flex shrink-0 items-center">
          <span
            className={`relative inline-flex h-8 w-8 items-center justify-center rounded-[0.9rem] border shadow-sm shadow-stone-950/20 ${desktopIconClassName}`}
          >
            {icon}
            <span
              className={`absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full border bg-stone-950/90 px-1 text-[9px] font-semibold leading-4 ${countBadgeClassName}`}
            >
              {count}
            </span>
          </span>
          {runningIndicator}
        </div>
        <div className="thread-graph-history-group-card min-w-0 flex-1 rounded-[0.85rem] border px-3 py-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={toggleAriaLabel}
            onClick={onToggleExpanded}
            className="thread-graph-history-group-toggle flex w-full min-w-0 items-center justify-between gap-3 text-left"
          >
            <div className="thread-graph-history-group-summary min-w-0 flex flex-1 flex-wrap items-center gap-2 pr-1">
              {summary}
            </div>
            {trailingSummary}
          </button>

          {expanded ? (
            <div
              className={`thread-graph-history-group-list mt-3 space-y-2 border-t pt-3 ${expandedListClassName}`}
            >
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
