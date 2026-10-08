/** The device Supervisor is the sole owner of definitions and execution state. */
export type AutomationTrigger =
  | { kind: 'interval'; everySeconds: number; anchorAt?: string | null }
  | { kind: 'at'; at: string }
  | { kind: 'threadEnded'; sourceThreadId: string }
  | { kind: 'turnEnded'; sourceThreadId: string; turnId: string }
  | { kind: 'taskEnded'; rootThreadId: string; taskNumber: number }
  | {
      kind: 'commandEnded';
      sourceThreadId: string;
      commandId?: string | null;
      commandKey?: string | null;
    };
export type AutomationCondition =
  | { kind: 'all' | 'any'; conditions: AutomationCondition[] }
  | { kind: 'not'; condition: AutomationCondition }
  | { kind: 'statusIn'; values: string[] }
  | { kind: 'exitCodeEquals'; value: number }
  | { kind: 'workspaceId' | 'commandId'; value: string };
export interface AutomationCommandSpec {
  argv?: string[];
  shell?: string | null;
  cwd: string;
  timeoutSeconds?: number;
}
export type AutomationAction =
  | { kind: 'prompt'; text: string }
  | {
      kind: 'notifyInbox';
      subject: string;
      text: string;
      messageKind?: 'result' | 'status';
      includeClosingMessage?: boolean;
    }
  | ({ kind: 'runScript' } & AutomationCommandSpec);
export interface AutomationDefinition {
  name: string;
  trigger: AutomationTrigger;
  condition?: AutomationCondition;
  action: AutomationAction;
  enabled?: boolean;
  maxLatenessSeconds?: number;
  missedRunPolicy?: 'coalesceLatest' | 'skip';
  replayExisting?: boolean;
}
export interface AutomationDto {
  id: string;
  threadId: string;
  sourceKind: 'supervisor';
  definition: AutomationDefinition;
  state: 'enabled' | 'paused' | 'cancelled';
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  pendingCount: number;
  missedCount: number;
  error: string | null;
}
export interface AutomationRunDto {
  id: string;
  automationId: string;
  occurrenceKey: string;
  state: string;
  scheduledAt: string;
  observedAt: string;
  missedCount: number;
  pendingSteerId: string | null;
  turnId: string | null;
  commandId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  deliveryReceipt: Record<string, unknown> | null;
  error: string | null;
  attemptCount: number;
}
