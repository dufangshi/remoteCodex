import type {
  AgentPendingProviderRequest,
  AgentProviderRequest,
  AgentRuntime,
} from '../../../packages/agent-runtime/src/index';
import type {
  ApprovalMode,
  CollaborationModeDto,
  RespondThreadActionRequestInput,
  ThreadActionRequestDto,
  ThreadAnsweredRequestNoteDto,
  ThreadEventPayloadMap,
} from '../../../packages/shared/src/index';
import { HttpError } from './app';

const LOCAL_PLAN_DECISION_PREFIX = 'plan-decision:';
const CLAUDE_ASK_USER_QUESTION_CONTINUATION_PROMPT =
  'The user answered the clarification questions below. Continue from the same plan-mode task using these answers. If you have enough information, produce the concrete plan for approval.\n\n';

export type PendingThreadRequestRecord =
  | {
      source: 'server';
      providerRequestId: string | number;
      responseKind: string;
      responsePayload?: Record<string, unknown>;
      request: ThreadActionRequestDto & { kind: 'requestUserInput' };
    }
  | {
      source: 'planDecision';
      request: ThreadActionRequestDto;
    };

export type RespondToThreadRequestResult =
  | {
      source: 'server';
      pending: Extract<PendingThreadRequestRecord, { source: 'server' }>;
      answeredNote: ThreadAnsweredRequestNoteDto | null;
      continuationPrompt: string | null;
    }
  | {
      source: 'planDecision';
      pending: Extract<PendingThreadRequestRecord, { source: 'planDecision' }>;
      answeredNote: ThreadAnsweredRequestNoteDto | null;
      selectedAction: 'implement' | 'stay';
      dismissedTurnId: string | null;
    };

interface ProviderRequestCoordinatorCallbacks {
  emitThreadEvent<Type extends 'thread.request.created' | 'thread.request.resolved'>(
    type: Type,
    threadId: string,
    payload: ThreadEventPayloadMap[Type],
  ): void;
  findRecordByProviderSessionId(
    provider: string | null | undefined,
    providerSessionId: string,
  ): { id: string; approvalMode?: string | null } | null | undefined;
  normalizeCollaborationMode(value: string | null | undefined): CollaborationModeDto;
  runtimeForProvider(provider: string | null | undefined): AgentRuntime;
}

export class ProviderRequestCoordinator {
  private readonly pendingRequests = new Map<string, Map<string, PendingThreadRequestRecord>>();
  private readonly dismissedPlanDecisionTurns = new Map<string, string>();

  constructor(private readonly callbacks: ProviderRequestCoordinatorCallbacks) {}

  clearThread(localThreadId: string) {
    this.pendingRequests.delete(localThreadId);
    this.dismissedPlanDecisionTurns.delete(localThreadId);
  }

  private getPendingRequest(localThreadId: string, requestId: string) {
    return this.pendingRequests.get(localThreadId)?.get(requestId) ?? null;
  }

  private deletePendingRequest(localThreadId: string, requestId: string) {
    const threadRequests = this.pendingRequests.get(localThreadId);
    threadRequests?.delete(requestId);
    if (threadRequests?.size === 0) {
      this.pendingRequests.delete(localThreadId);
    }
  }

  listPendingRequests(
    localThreadId: string,
    options: { hideAnsweredProviderQuestions?: boolean } = {},
  ): ThreadActionRequestDto[] {
    return [...(this.pendingRequests.get(localThreadId)?.values() ?? [])]
      .filter((entry) => {
        if (!options.hideAnsweredProviderQuestions) {
          return true;
        }
        return !(entry.source === 'server' && entry.responseKind === 'askUserQuestion');
      })
      .map((entry) => entry.request);
  }

  dismissPlanDecisionTurn(localThreadId: string) {
    this.dismissedPlanDecisionTurns.delete(localThreadId);
  }

  private markPlanDecisionDismissed(localThreadId: string, turnId: string) {
    this.dismissedPlanDecisionTurns.set(localThreadId, turnId);
  }

  respondToRequest(
    localThreadId: string,
    requestId: string,
    input: RespondThreadActionRequestInput,
  ): RespondToThreadRequestResult | null {
    const pending = this.getPendingRequest(localThreadId, requestId);
    if (!pending) {
      return null;
    }

    const answeredNote = this.buildAnsweredRequestNote(pending.request, input);
    this.deletePendingRequest(localThreadId, requestId);

    if (pending.source === 'server') {
      const continuationPrompt =
        pending.responseKind === 'askUserQuestion' &&
        pending.responsePayload?.continueAsPrompt === true
          ? this.buildProviderQuestionContinuationPrompt(pending.request, input)
          : null;
      return {
        source: 'server',
        pending,
        answeredNote,
        continuationPrompt,
      };
    }

    const selectedAction = selectedPlanDecisionAction(input);
    if (selectedAction === 'implement') {
      this.dismissPlanDecisionTurn(localThreadId);
      return {
        source: 'planDecision',
        pending,
        answeredNote,
        selectedAction,
        dismissedTurnId: null,
      };
    }

    const dismissedTurnId = pending.request.turnId ?? null;
    if (dismissedTurnId) {
      this.markPlanDecisionDismissed(localThreadId, dismissedTurnId);
    }

    return {
      source: 'planDecision',
      pending,
      answeredNote,
      selectedAction,
      dismissedTurnId,
    };
  }

  respondToProviderRequest(
    provider: string | null | undefined,
    pending: Extract<PendingThreadRequestRecord, { source: 'server' }>,
    input: RespondThreadActionRequestInput,
  ) {
    const runtime = this.callbacks.runtimeForProvider(provider);
    if (!runtime.buildProviderRequestResponse) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend cannot build provider request responses.',
      });
    }
    if (!runtime.respondToProviderRequest) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend cannot respond to provider requests.',
      });
    }

    const result = runtime.buildProviderRequestResponse(
      pendingToAgentPendingProviderRequest(pending),
      input,
    );
    runtime.respondToProviderRequest(pending.providerRequestId, result);
  }

  emitRequestResolved(localThreadId: string, requestId: string) {
    this.callbacks.emitThreadEvent('thread.request.resolved', localThreadId, {
      requestId,
    });
  }

  handleProviderRuntimeRequest(request: AgentProviderRequest) {
    const runtime = this.callbacks.runtimeForProvider(request.provider);
    const defaultMappedRequest = runtime.mapProviderRequest?.(request, {
      approvalMode: 'guarded',
    });
    const providerSessionIdFromParams =
      isRecord(request.params)
        ? request.params.providerSessionId ??
          request.params.threadId ??
          request.params.conversationId ??
          request.params.sessionId
        : null;
    const providerSessionId =
      defaultMappedRequest?.providerSessionId ??
      (typeof providerSessionIdFromParams === 'string' ? providerSessionIdFromParams : null);
    const record = providerSessionId
      ? this.callbacks.findRecordByProviderSessionId(request.provider, providerSessionId)
      : null;
    if (!record) {
      return;
    }

    const approvalMode = (record.approvalMode ?? 'yolo') as ApprovalMode;
    const mappedRequest =
      approvalMode === 'guarded'
        ? defaultMappedRequest
        : runtime.mapProviderRequest?.(request, { approvalMode });
    if (!mappedRequest) {
      return;
    }

    if (mappedRequest.autoApprovedResult) {
      runtime.respondToProviderRequest?.(
        mappedRequest.providerRequestId,
        mappedRequest.autoApprovedResult,
      );
      return;
    }

    if (!mappedRequest.pendingRequest) {
      return;
    }

    const pendingServerRequest: {
      providerRequestId: string | number;
      responseKind: string;
      responsePayload?: Record<string, unknown>;
      request: ThreadActionRequestDto & { kind: 'requestUserInput' };
    } = {
      providerRequestId: mappedRequest.pendingRequest.providerRequestId,
      responseKind: mappedRequest.pendingRequest.responseKind,
      request: mappedRequest.pendingRequest.request as ThreadActionRequestDto & {
        kind: 'requestUserInput';
      },
    };
    if (mappedRequest.pendingRequest.responsePayload) {
      pendingServerRequest.responsePayload = mappedRequest.pendingRequest.responsePayload;
    }
    this.upsertPendingServerRequest(record.id, pendingServerRequest);

    this.callbacks.emitThreadEvent('thread.request.created', record.id, {
      request: mappedRequest.pendingRequest.request,
    });
  }

  createPendingPlanDecisionRequest(
    localThreadId: string,
    turnId: string,
    emitEvents: boolean,
  ) {
    if (this.dismissedPlanDecisionTurns.get(localThreadId) === turnId) {
      return;
    }

    this.clearPendingPlanDecisionRequests(localThreadId, false);

    const request: ThreadActionRequestDto = {
      id: `${LOCAL_PLAN_DECISION_PREFIX}${turnId}`,
      kind: 'planDecision',
      title: 'Plan ready',
      description:
        'Review the proposed plan. Implement will switch the thread back to default mode and start execution automatically.',
      turnId,
      itemId: null,
      createdAt: new Date().toISOString(),
      questions: [
        {
          id: 'plan-decision',
          header: 'Next step',
          question: 'Choose whether to implement this plan now or keep refining it in plan mode.',
          isOther: false,
          isSecret: false,
          options: [
            {
              label: 'Implement',
              description: 'Exit plan mode and continue with implementation immediately.',
            },
            {
              label: 'Stay in plan mode',
              description: 'Keep plan mode on so you can send feedback and request another plan.',
            },
          ],
        },
      ],
    };

    this.upsertPendingPlanDecisionRequest(localThreadId, request);

    if (emitEvents) {
      this.callbacks.emitThreadEvent('thread.request.created', localThreadId, {
        request,
      });
    }
  }

  clearPendingPlanDecisionRequests(localThreadId: string, emitEvents: boolean) {
    this.clearPendingRequestsWhere(
      localThreadId,
      (request) => request.source === 'planDecision',
      emitEvents,
    );
  }

  clearTerminalPendingRequests(localThreadId: string, emitEvents: boolean) {
    this.clearPendingRequestsWhere(
      localThreadId,
      (request) =>
        !(request.source === 'server' && request.responseKind === 'askUserQuestion'),
      emitEvents,
    );
  }

  hasPendingAskUserQuestion(localThreadId: string) {
    return [...(this.pendingRequests.get(localThreadId)?.values() ?? [])].some(
      (request) =>
        request.source === 'server' &&
        request.responseKind === 'askUserQuestion',
    );
  }

  syncPendingPlanDecisionRequest(input: {
    localThreadId: string;
    collaborationMode: string | null | undefined;
    latestTurn: {
      providerTurnId: string;
      status: string;
      items: Array<{ kind: string }>;
    } | null;
  }) {
    const shouldHavePlanDecision =
      this.callbacks.normalizeCollaborationMode(input.collaborationMode) === 'plan' &&
      input.latestTurn?.status === 'completed' &&
      input.latestTurn.items.some((item) => item.kind === 'plan') &&
      !this.hasPendingAskUserQuestion(input.localThreadId);

    if (!shouldHavePlanDecision || !input.latestTurn) {
      this.clearPendingPlanDecisionRequests(input.localThreadId, false);
      this.dismissPlanDecisionTurn(input.localThreadId);
      return;
    }

    const expectedRequestId = `${LOCAL_PLAN_DECISION_PREFIX}${input.latestTurn.providerTurnId}`;
    const existingRequest = this.pendingRequests
      .get(input.localThreadId)
      ?.get(expectedRequestId);
    if (existingRequest?.source === 'planDecision') {
      return;
    }

    this.createPendingPlanDecisionRequest(
      input.localThreadId,
      input.latestTurn.providerTurnId,
      false,
    );
  }

  private buildProviderQuestionContinuationPrompt(
    request: ThreadActionRequestDto,
    input: RespondThreadActionRequestInput,
  ) {
    const lines = buildRequestAnswerLines(request, input);
    if (lines.length === 0) {
      return null;
    }

    return `${CLAUDE_ASK_USER_QUESTION_CONTINUATION_PROMPT}${lines.join('\n')}`;
  }

  private buildAnsweredRequestNote(
    request: ThreadActionRequestDto,
    input: RespondThreadActionRequestInput,
  ): ThreadAnsweredRequestNoteDto | null {
    const summaryLines = request.questions
      .map((question) => {
        const answers = input.answers[question.id]?.answers
          .map((answer) => answer.trim())
          .filter(Boolean) ?? [];
        if (answers.length === 0) {
          return null;
        }

        return `${question.header}: ${answers.join(', ')}`;
      })
      .filter((line): line is string => Boolean(line));

    if (summaryLines.length === 0) {
      return null;
    }

    return {
      id: request.id,
      turnId: request.turnId ?? null,
      title: request.title,
      summaryLines,
      createdAt: new Date().toISOString(),
    };
  }

  private upsertPendingServerRequest(
    localThreadId: string,
    input: {
      providerRequestId: string | number;
      responseKind: string;
      responsePayload?: Record<string, unknown>;
      request: ThreadActionRequestDto & { kind: 'requestUserInput' };
    },
  ) {
    const pendingRequest: Extract<PendingThreadRequestRecord, { source: 'server' }> = {
      source: 'server',
      providerRequestId: input.providerRequestId,
      responseKind: input.responseKind,
      request: input.request,
    };
    if (input.responsePayload) {
      pendingRequest.responsePayload = input.responsePayload;
    }

    this.ensureThreadRequests(localThreadId).set(input.request.id, pendingRequest);
  }

  private upsertPendingPlanDecisionRequest(
    localThreadId: string,
    request: ThreadActionRequestDto,
  ) {
    this.ensureThreadRequests(localThreadId).set(request.id, {
      source: 'planDecision',
      request,
    });
  }

  private ensureThreadRequests(localThreadId: string) {
    let threadRequests = this.pendingRequests.get(localThreadId);
    if (!threadRequests) {
      threadRequests = new Map();
      this.pendingRequests.set(localThreadId, threadRequests);
    }
    return threadRequests;
  }

  private clearPendingRequestsWhere(
    localThreadId: string,
    predicate: (request: PendingThreadRequestRecord) => boolean,
    emitEvents: boolean,
  ) {
    const threadRequests = this.pendingRequests.get(localThreadId);
    if (!threadRequests) {
      return;
    }

    const removedIds: string[] = [];
    for (const [requestId, request] of threadRequests.entries()) {
      if (!predicate(request)) {
        continue;
      }

      threadRequests.delete(requestId);
      removedIds.push(requestId);
    }

    if (threadRequests.size === 0) {
      this.pendingRequests.delete(localThreadId);
    }

    if (!emitEvents) {
      return;
    }

    removedIds.forEach((requestId) => {
      this.callbacks.emitThreadEvent('thread.request.resolved', localThreadId, {
        requestId,
      });
    });
  }
}

function pendingToAgentPendingProviderRequest(
  pending: Extract<PendingThreadRequestRecord, { source: 'server' }>,
): AgentPendingProviderRequest {
  const request: AgentPendingProviderRequest = {
    providerRequestId: pending.providerRequestId,
    responseKind: pending.responseKind,
    request: pending.request,
  };
  if (pending.responsePayload) {
    request.responsePayload = pending.responsePayload;
  }
  return request;
}

function selectedPlanDecisionAction(
  input: RespondThreadActionRequestInput,
): 'implement' | 'stay' {
  const selectedAnswer = Object.values(input.answers)[0]?.answers[0]?.trim().toLowerCase();
  return selectedAnswer === 'implement' ? 'implement' : 'stay';
}

function buildRequestAnswerLines(
  request: ThreadActionRequestDto,
  input: RespondThreadActionRequestInput,
) {
  return request.questions
    .map((question) => {
      const answers = input.answers[question.id]?.answers
        .map((answer) => answer.trim())
        .filter(Boolean) ?? [];
      if (answers.length === 0) {
        return null;
      }
      return `- ${question.question}: ${answers.join(', ')}`;
    })
    .filter((line): line is string => Boolean(line));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
