import type {
  AgentActionRequest,
  AgentActionRequestResponseInput,
  AgentPendingProviderRequest,
  AgentProviderRequest,
  AgentProviderRequestMapping,
} from '../../agent-runtime/src/index';
import type { CodexServerRequest } from './types';

type CodexPendingRequestResponseKind =
  | 'answers'
  | 'mcpElicitation'
  | 'commandExecutionApproval'
  | 'fileChangeApproval'
  | 'permissionsApproval'
  | 'legacyExecApproval'
  | 'legacyApplyPatchApproval';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeOptionLabelForApproval(value: string) {
  return value
    .replace(/\(recommended\)\s*$/i, '')
    .trim()
    .toLowerCase();
}

function isAllowOptionLabel(value: string) {
  return /^(allow|approve|yes|continue|proceed|trust)\b/.test(value);
}

function isLikelyPositiveApprovalOption(value: string) {
  const normalized = normalizeOptionLabelForApproval(value);
  return (
    isAllowOptionLabel(normalized) ||
    /\b(allow|approve|yes|continue|proceed|trust)\b/.test(normalized)
  );
}

function isLikelyApprovalPrompt(
  requestMethod: string,
  questions: Array<{
    header: string;
    question: string;
    options: Array<{ label: string; description: string }> | null;
  }>,
) {
  const methodText = requestMethod.toLowerCase();
  if (
    methodText.includes('approval') ||
    methodText.includes('authorize') ||
    methodText.includes('requestuserinput')
  ) {
    return true;
  }

  const combinedText = questions
    .flatMap((question) => [
      question.header,
      question.question,
      ...(question.options?.map((option) => option.label) ?? []),
    ])
    .join(' ')
    .toLowerCase();

  return /(allow|approve|permission|authorize|authorization|auth|mcp|tool)/.test(
    combinedText,
  );
}

function buildAutoApprovedAnswersForServerQuestions(
  requestMethod: string,
  questions: Array<{
    id: string;
    header: string;
    question: string;
    isOther: boolean;
    isSecret: boolean;
    options: Array<{ label: string; description: string }> | null;
  }>,
) {
  if (!isLikelyApprovalPrompt(requestMethod, questions)) {
    return null;
  }

  const answers: Record<string, { answers: string[] }> = {};

  for (const question of questions) {
    if (!question.options || question.options.length === 0) {
      return null;
    }

    const recommendedOption = question.options.find((option) =>
      /\(recommended\)\s*$/i.test(option.label),
    );
    const allowOption =
      recommendedOption && isLikelyPositiveApprovalOption(recommendedOption.label)
        ? recommendedOption
        : question.options.find((option) =>
            isLikelyPositiveApprovalOption(option.label),
          );

    if (!allowOption) {
      return null;
    }

    answers[question.id] = {
      answers: [allowOption.label],
    };
  }

  return answers;
}

function isMcpElicitationRequest(
  request: CodexServerRequest,
): request is CodexServerRequest & {
  params: {
    threadId: string;
    turnId?: string;
    serverName?: string;
    mode?: string;
    message?: string;
    requestedSchema?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
} {
  return request.method === 'mcpServer/elicitation/request';
}

function buildAutoApprovedMcpElicitationResult(
  request: CodexServerRequest,
) {
  if (!isMcpElicitationRequest(request)) {
    return null;
  }

  return {
    action: 'accept',
    content: {},
  } as const;
}

function stringFromUnknown(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function arrayTextFromUnknown(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value
    .map((entry) => (typeof entry === 'string' ? entry : null))
    .filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? parts.join(' ') : null;
}

function commandTextFromApprovalParams(params: Record<string, unknown>) {
  return stringFromUnknown(params.command) ?? arrayTextFromUnknown(params.command);
}

function buildApprovalRequestDescription(params: Record<string, unknown>) {
  return [
    stringFromUnknown(params.reason),
    commandTextFromApprovalParams(params)
      ? `Command: ${commandTextFromApprovalParams(params)}`
      : null,
    stringFromUnknown(params.cwd) ? `CWD: ${stringFromUnknown(params.cwd)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildGenericApprovalThreadRequest(
  request: CodexServerRequest,
  options: {
    title: string;
    descriptionFallback: string;
  },
): AgentActionRequest {
  const params = request.params as {
    turnId?: string;
    itemId?: string;
  };
  const description = buildApprovalRequestDescription(request.params);

  return {
    id: String(request.id),
    kind: 'requestUserInput',
    title: options.title,
    description: description || options.descriptionFallback,
    turnId: params.turnId ?? null,
    itemId: params.itemId ?? null,
    createdAt: new Date().toISOString(),
    questions: [
      {
        id: 'approval',
        header: options.title,
        question: description || options.descriptionFallback,
        isOther: false,
        isSecret: false,
        options: [
          {
            label: 'Allow',
            description: 'Permit this action and continue the current turn.',
          },
          {
            label: 'Deny',
            description: 'Decline this action.',
          },
        ],
      },
    ],
  };
}

function yoloApprovalResultForServerRequest(request: CodexServerRequest) {
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
      return { decision: 'accept' };
    case 'item/fileChange/requestApproval':
      return { decision: 'accept' };
    case 'item/permissions/requestApproval': {
      const params = request.params as { permissions?: unknown };
      return {
        permissions: isRecord(params.permissions) ? params.permissions : {},
        scope: 'turn',
      };
    }
    case 'execCommandApproval':
      return { decision: 'approved' };
    case 'applyPatchApproval':
      return { decision: 'approved' };
    default:
      return null;
  }
}

function responseKindForApprovalRequest(
  request: CodexServerRequest,
): CodexPendingRequestResponseKind | null {
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
      return 'commandExecutionApproval';
    case 'item/fileChange/requestApproval':
      return 'fileChangeApproval';
    case 'item/permissions/requestApproval':
      return 'permissionsApproval';
    case 'execCommandApproval':
      return 'legacyExecApproval';
    case 'applyPatchApproval':
      return 'legacyApplyPatchApproval';
    default:
      return null;
  }
}

function buildThreadRequestFromMcpElicitation(
  request: CodexServerRequest & {
    params: {
      threadId: string;
      turnId?: string;
      serverName?: string;
      mode?: string;
      message?: string;
      requestedSchema?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    };
  },
): AgentActionRequest {
  const meta = isRecord(request.params._meta) ? request.params._meta : null;
  const toolTitle = stringOrNull(meta?.tool_title);
  const toolDescription = stringOrNull(meta?.tool_description);
  const serverName = stringOrNull(request.params.serverName) ?? 'MCP';
  const message =
    stringOrNull(request.params.message) ??
    `Allow the ${serverName} MCP server to continue?`;

  return {
    id: String(request.id),
    kind: 'requestUserInput',
    title: toolTitle ?? `${serverName} MCP`,
    description: toolDescription ?? message,
    turnId: request.params.turnId ?? null,
    itemId: null,
    createdAt: new Date().toISOString(),
    questions: [
      {
        id: 'decision',
        header: toolTitle ?? `${serverName} MCP`,
        question: message,
        isOther: false,
        isSecret: false,
        options: [
          {
            label: 'Allow',
            description: 'Permit this MCP tool call.',
          },
          {
            label: 'Deny',
            description: 'Reject this MCP tool call.',
          },
        ],
      },
    ],
  };
}

export function buildCodexProviderRequestResponse(
  pending: AgentPendingProviderRequest,
  input: AgentActionRequestResponseInput,
) {
  const selectedAnswer = Object.values(input.answers)[0]?.answers[0]?.trim().toLowerCase();
  const allowed = Boolean(selectedAnswer && /^(allow|approve|yes|continue|proceed)\b/.test(selectedAnswer));

  switch (pending.responseKind as CodexPendingRequestResponseKind) {
    case 'mcpElicitation':
      return {
        action: allowed ? 'accept' : 'decline',
        content: {},
      };
    case 'commandExecutionApproval':
      return { decision: allowed ? 'accept' : 'decline' };
    case 'fileChangeApproval':
      return { decision: allowed ? 'accept' : 'decline' };
    case 'permissionsApproval':
      return allowed
        ? {
            permissions:
              isRecord(pending.responsePayload?.permissions)
                ? pending.responsePayload.permissions
                : {},
            scope: 'turn',
          }
        : {
            permissions: {},
            scope: 'turn',
          };
    case 'legacyExecApproval':
    case 'legacyApplyPatchApproval':
      return { decision: allowed ? 'approved' : 'denied' };
    case 'answers':
    default:
      return {
        answers: input.answers,
      };
  }
}

export function mapCodexProviderRequest(
  providerRequest: AgentProviderRequest,
  approvalMode: 'yolo' | 'guarded',
): AgentProviderRequestMapping | null {
  const request: CodexServerRequest = {
    id: Number(providerRequest.id),
    method: providerRequest.method,
    params: isRecord(providerRequest.params) ? providerRequest.params : {},
  };
  const providerRequestId = providerRequest.id;
  const approvalResponseKind = responseKindForApprovalRequest(request);
  if (approvalResponseKind) {
    const params = request.params as {
      threadId?: string;
      conversationId?: string;
      permissions?: unknown;
    };
    const providerSessionId = params.threadId ?? params.conversationId;
    if (!providerSessionId) {
      return null;
    }

    const autoApprovedResult =
      approvalMode === 'yolo' ? yoloApprovalResultForServerRequest(request) : null;
    if (autoApprovedResult) {
      return {
        providerRequestId,
        providerSessionId,
        autoApprovedResult,
        pendingRequest: null,
      };
    }

    const title =
      approvalResponseKind === 'commandExecutionApproval' ||
      approvalResponseKind === 'legacyExecApproval'
        ? 'Command approval required'
        : approvalResponseKind === 'fileChangeApproval' ||
            approvalResponseKind === 'legacyApplyPatchApproval'
          ? 'File change approval required'
          : 'Permissions approval required';
    const threadRequest = buildGenericApprovalThreadRequest(request, {
      title,
      descriptionFallback: 'Codex needs approval before it can continue this action.',
    });
    const pendingRequest: AgentPendingProviderRequest = {
      providerRequestId,
      responseKind: approvalResponseKind,
      request: threadRequest,
    };
    if (approvalResponseKind === 'permissionsApproval' && isRecord(params.permissions)) {
      pendingRequest.responsePayload = { permissions: params.permissions };
    }

    return {
      providerRequestId,
      providerSessionId,
      autoApprovedResult: null,
      pendingRequest,
    };
  }

  if (isMcpElicitationRequest(request)) {
    const autoApprovedResult =
      approvalMode === 'yolo'
        ? buildAutoApprovedMcpElicitationResult(request)
        : null;
    if (autoApprovedResult) {
      return {
        providerRequestId,
        providerSessionId: request.params.threadId,
        autoApprovedResult,
        pendingRequest: null,
      };
    }

    return {
      providerRequestId,
      providerSessionId: request.params.threadId,
      autoApprovedResult: null,
      pendingRequest: {
        providerRequestId,
        responseKind: 'mcpElicitation',
        request: buildThreadRequestFromMcpElicitation(request),
      },
    };
  }

  const params = request.params as {
    threadId?: string;
    turnId?: string;
    itemId?: string;
    questions?: Array<{
      id: string;
      header: string;
      question: string;
      isOther: boolean;
      isSecret: boolean;
      options: Array<{ label: string; description: string }> | null;
    }>;
  };

  if (!params.threadId || !Array.isArray(params.questions)) {
    return null;
  }

  const autoApprovedAnswers =
    approvalMode === 'yolo'
      ? buildAutoApprovedAnswersForServerQuestions(
          request.method,
          params.questions,
        )
      : null;
  if (autoApprovedAnswers) {
    return {
      providerRequestId,
      providerSessionId: params.threadId,
      autoApprovedResult: { answers: autoApprovedAnswers },
      pendingRequest: null,
    };
  }

  const questions = params.questions.map((question) => ({
    id: question.id,
    header: question.header,
    question: question.question,
    isOther: question.isOther,
    isSecret: question.isSecret,
    options: question.options?.map((option) => ({
      label: option.label,
      description: option.description,
    })) ?? null,
  }));
  const threadRequest: AgentActionRequest = {
    id: String(request.id),
    kind: 'requestUserInput',
    title: questions[0]?.header || 'User input required',
    description: questions[0]?.question ?? null,
    turnId: params.turnId ?? null,
    itemId: params.itemId ?? null,
    createdAt: new Date().toISOString(),
    questions,
  };

  return {
    providerRequestId,
    providerSessionId: params.threadId,
    autoApprovedResult: null,
    pendingRequest: {
      providerRequestId,
      responseKind: 'answers',
      request: threadRequest,
    },
  };
}
