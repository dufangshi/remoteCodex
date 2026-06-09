import { type ReactNode } from 'react';
import { CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react';

import { Badge } from '../graph-ui/Badge';

export interface GraphChatLivePlan {
  turnId: string;
  explanation: string | null;
  plan: Array<{ step: string; status: string }>;
}

function normalizeGraphChatPlanStepStatus(status: string) {
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
    normalized === 'in-progress' ||
    normalized === 'running' ||
    normalized === 'active'
  ) {
    return 'in_progress' as const;
  }

  if (
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'cancelled'
  ) {
    return 'failed' as const;
  }

  if (normalized === 'pending' || normalized === 'todo') {
    return 'pending' as const;
  }

  return 'unknown' as const;
}

function GraphChatPlanStepStatusIcon({ status }: { status: string }) {
  const normalized = normalizeGraphChatPlanStepStatus(status);
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

  const badgeClassName =
    normalized === 'completed'
      ? 'thread-graph-plan-status is-completed'
      : normalized === 'in_progress'
        ? 'thread-graph-plan-status is-running'
        : normalized === 'pending'
          ? 'thread-graph-plan-status is-pending'
          : normalized === 'failed'
            ? 'thread-graph-plan-status is-failed'
            : 'thread-graph-plan-status is-unknown';

  return (
    <Badge
      aria-label={label}
      title={label.replace('Plan step status: ', '')}
      className={badgeClassName}
    >
      {normalized === 'completed' ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : normalized === 'in_progress' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : normalized === 'pending' ? (
        <Clock3 className="h-3.5 w-3.5" />
      ) : normalized === 'failed' ? (
        <XCircle className="h-3.5 w-3.5" />
      ) : (
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
          ?
        </span>
      )}
    </Badge>
  );
}

export function GraphChatLivePlanCard({ livePlan }: { livePlan: GraphChatLivePlan }) {
  return (
    <div className="thread-graph-plan-card rounded-xl border px-3 py-3">
      <div className="thread-graph-plan-header flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Plan update</p>
        <Badge className="thread-graph-plan-badge">
          Live
        </Badge>
      </div>
      {livePlan.explanation ? (
        <p className="thread-graph-plan-explanation mt-3 text-sm">
          {livePlan.explanation}
        </p>
      ) : null}
      <div className="mt-3 space-y-2">
        {livePlan.plan.map((step, index) => (
          <div
            key={`${livePlan.turnId}-${index}`}
            className="thread-graph-plan-step flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
          >
            <span className="thread-graph-plan-step-text min-w-0 flex-1">
              {step.step}
            </span>
            <GraphChatPlanStepStatusIcon status={step.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GraphChatTurnBody({
  footer,
  history,
  liveHookPrompt,
  liveOutput,
  livePlan,
}: {
  footer?: ReactNode;
  history: ReactNode;
  liveHookPrompt?: ReactNode;
  liveOutput?: ReactNode;
  livePlan?: GraphChatLivePlan | null;
}) {
  return (
    <>
      {history}
      {livePlan ? <GraphChatLivePlanCard livePlan={livePlan} /> : null}
      {liveHookPrompt ?? liveOutput ?? null}
      {footer}
    </>
  );
}
