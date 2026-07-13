import {
  type ModelOptionDto,
  type ThreadDetailDto,
  type ThreadDto,
  type ThreadHistoryItemDto,
  type ThreadTurnPriceEstimateDto,
  type ThreadTurnTokenUsageDto,
} from '@remote-codex/shared';

export function effectiveSandboxMode(
  _thread: Pick<ThreadDto, 'sandboxMode' | 'approvalMode'>,
): 'danger-full-access' {
  return 'danger-full-access';
}

export function prependTurns(
  existing: ThreadDetailDto['turns'],
  older: ThreadDetailDto['turns'],
) {
  const olderIds = new Set(older.map((turn) => turn.id));
  return [...older, ...existing.filter((turn) => !olderIds.has(turn.id))];
}

export function appendLatestTurns(
  existing: ThreadDetailDto['turns'],
  latest: ThreadDetailDto['turns'],
) {
  const latestIds = new Set(latest.map((turn) => turn.id));
  return [...existing.filter((turn) => !latestIds.has(turn.id)), ...latest];
}

export function applyLiveItemTimestampsToTurns(
  turns: ThreadDetailDto['turns'],
  liveItems: NonNullable<ThreadDetailDto['liveItems']> | null,
) {
  if (!liveItems || liveItems.items.length === 0) {
    return turns;
  }

  return turns.map((turn) => {
    if (turn.id !== liveItems.turnId) {
      return turn;
    }

    const liveAgentItems = liveItems.items.filter(
      (item) => item.kind === 'agentMessage' && item.createdAt,
    );
    if (liveAgentItems.length === 0) {
      return turn;
    }

    const liveAgentItemsById = new Map(liveAgentItems.map((item) => [item.id, item]));
    const usedLiveAgentIds = new Set<string>();
    let changed = false;
    const nextItems = turn.items.map((item) => {
      if (
        item.kind !== 'agentMessage' ||
        (item.createdAt && item.createdAt !== turn.startedAt)
      ) {
        return item;
      }

      let liveItem = liveAgentItemsById.get(item.id);
      if (!liveItem) {
        liveItem = liveAgentItems.find(
          (candidate) =>
            !usedLiveAgentIds.has(candidate.id) &&
            candidate.text.trim().length >= 8 &&
            item.text.trim().includes(candidate.text.trim()),
        );
      }

      if (!liveItem?.createdAt || liveItem.createdAt === turn.startedAt) {
        return item;
      }

      usedLiveAgentIds.add(liveItem.id);
      changed = true;
      return { ...item, createdAt: liveItem.createdAt };
    });

    return changed ? { ...turn, items: nextItems } : turn;
  });
}

export function mergePendingRequestIntoDetail(
  detail: ThreadDetailDto,
  request: ThreadDetailDto['pendingRequests'][number],
): ThreadDetailDto {
  return {
    ...detail,
    pendingRequests: [
      ...detail.pendingRequests.filter((entry) => entry.id !== request.id),
      request,
    ],
  };
}

export function removePendingRequestFromDetail(
  detail: ThreadDetailDto,
  requestId: string,
): ThreadDetailDto {
  const pendingRequests = detail.pendingRequests.filter(
    (entry) => entry.id !== requestId,
  );
  return pendingRequests.length === detail.pendingRequests.length
    ? detail
    : {
        ...detail,
        pendingRequests,
      };
}

export function mergePendingRequests(
  current: ThreadDetailDto['pendingRequests'],
  incoming: ThreadDetailDto['pendingRequests'],
  resolvedRequestIds: ReadonlySet<string>,
) {
  const filteredIncoming = incoming.filter(
    (request) => !resolvedRequestIds.has(request.id),
  );
  const filteredCurrent = current.filter(
    (request) => !resolvedRequestIds.has(request.id),
  );

  if (filteredCurrent.length === 0) {
    return filteredIncoming;
  }

  const incomingById = new Map(
    filteredIncoming.map((request) => [request.id, request] as const),
  );
  const merged = [
    ...filteredCurrent.map((request) => incomingById.get(request.id) ?? request),
    ...filteredIncoming.filter(
      (request) => !filteredCurrent.some((entry) => entry.id === request.id),
    ),
  ];

  return merged.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function isThreadActionRequest(
  value: unknown,
): value is ThreadDetailDto['pendingRequests'][number] {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const request = value as Partial<ThreadDetailDto['pendingRequests'][number]>;
  return (
    typeof request.id === 'string' &&
    (request.kind === 'requestUserInput' || request.kind === 'planDecision') &&
    typeof request.title === 'string' &&
    typeof request.createdAt === 'string' &&
    Array.isArray(request.questions)
  );
}

export function mergeLiveHistoryItem(
  current: ThreadHistoryItemDto | undefined,
  incoming: ThreadHistoryItemDto,
): ThreadHistoryItemDto {
  if (!current || current.kind !== incoming.kind) {
    return incoming;
  }

  const mergeOrderingHints = (item: ThreadHistoryItemDto): ThreadHistoryItemDto => {
    let nextItem = item;
    const sequence =
      typeof incoming.sequence === 'number' && Number.isFinite(incoming.sequence)
        ? incoming.sequence
        : typeof current.sequence === 'number' && Number.isFinite(current.sequence)
          ? current.sequence
          : null;
    if (sequence !== null && nextItem.sequence !== sequence) {
      nextItem = { ...nextItem, sequence };
    }

    const transcriptOrder =
      typeof incoming.transcriptOrder === 'number' && Number.isFinite(incoming.transcriptOrder)
        ? incoming.transcriptOrder
        : typeof current.transcriptOrder === 'number' && Number.isFinite(current.transcriptOrder)
          ? current.transcriptOrder
          : null;
    if (transcriptOrder !== null && nextItem.transcriptOrder !== transcriptOrder) {
      nextItem = { ...nextItem, transcriptOrder };
    }

    return nextItem;
  };

  if (current.kind === 'agentMessage' && incoming.kind === 'agentMessage') {
    return mergeOrderingHints(
      current.text.length > incoming.text.length
        ? {
            ...incoming,
            text: current.text,
            sequence: incoming.sequence ?? current.sequence ?? null,
          }
        : incoming,
    );
  }

  const currentText = current.detailText?.trim() || current.text.trim();
  const incomingText = incoming.detailText?.trim() || incoming.text.trim();
  return mergeOrderingHints(currentText.length > incomingText.length ? current : incoming);
}

export function reconcileLiveItemsWithDetail(
  current: NonNullable<ThreadDetailDto['liveItems']> | null,
  incoming: NonNullable<ThreadDetailDto['liveItems']> | null,
  turns: ThreadDetailDto['turns'],
): NonNullable<ThreadDetailDto['liveItems']> | null {
  if (!current) {
    return incoming;
  }

  if (incoming && incoming.turnId !== current.turnId) {
    return incoming;
  }

  const materializedTurn = turns.find((turn) => turn.id === current.turnId);
  const materializedItemsById = new Map(
    materializedTurn?.items.map((item) => [item.id, item]) ?? [],
  );
  const materializedAgentTexts =
    materializedTurn?.items
      .filter((item) => item.kind === 'agentMessage')
      .map((item) => item.text.trim())
      .filter(Boolean) ?? [];
  const isCoveredByMaterializedAgentText = (item: ThreadHistoryItemDto) =>
    item.kind === 'agentMessage' &&
    item.text.trim().length > 0 &&
    materializedAgentTexts.some((text) => text.includes(item.text.trim()));

  if (!incoming) {
    const remainingItems = current.items.filter((item) => {
      const materialized = materializedItemsById.get(item.id);
      if (!materialized) {
        return !isCoveredByMaterializedAgentText(item);
      }
      return (
        materialized.kind !== item.kind ||
        (
          typeof item.sequence === 'number' &&
          Number.isFinite(item.sequence) &&
          materialized.sequence !== item.sequence
        )
      );
    });
    return remainingItems.length === 0
      ? null
      : {
          ...current,
          items: remainingItems,
        };
  }

  const currentItemsById = new Map(current.items.map((item) => [item.id, item]));
  const incomingItemsById = new Map(incoming.items.map((item) => [item.id, item]));
  const orderedIds = [
    ...current.items.map((item) => item.id),
    ...incoming.items
      .map((item) => item.id)
      .filter((id) => !currentItemsById.has(id)),
  ];
  const items = orderedIds
    .map((id) => {
      const incomingItem = incomingItemsById.get(id);
      const currentItem = currentItemsById.get(id);
      if (!incomingItem) {
        const materialized = materializedItemsById.get(id);
        if (!materialized && currentItem && isCoveredByMaterializedAgentText(currentItem)) {
          return null;
        }
        if (materialized && materialized.kind === currentItem?.kind) {
          const shouldKeepSequencedLiveItem =
            currentItem &&
            typeof currentItem.sequence === 'number' &&
            Number.isFinite(currentItem.sequence) &&
            materialized.sequence !== currentItem.sequence;
          if (!shouldKeepSequencedLiveItem) {
            return null;
          }
        }
        return currentItem ?? null;
      }
      return mergeLiveHistoryItem(currentItem, incomingItem);
    })
    .filter((item): item is ThreadHistoryItemDto => Boolean(item));

  return items.length === 0
    ? null
    : {
        turnId: incoming.turnId,
        items,
        updatedAt:
          incoming.updatedAt.localeCompare(current.updatedAt) >= 0
            ? incoming.updatedAt
            : current.updatedAt,
      };
}

export function mergeThreadIntoList(existing: ThreadDto[], thread: ThreadDto) {
  const remaining = existing.filter((entry) => entry.id !== thread.id);
  return [thread, ...remaining];
}

function goalKey(goal: NonNullable<ThreadDetailDto['goal']>) {
  return `${goal.threadId}:${goal.objective}:${goal.createdAt}`;
}

function mergeGoalEntry(
  existing: NonNullable<ThreadDetailDto['goal']>,
  incoming: NonNullable<ThreadDetailDto['goal']>,
) {
  const existingUpdatedAt = Date.parse(existing.updatedAt) || 0;
  const incomingUpdatedAt = Date.parse(incoming.updatedAt) || 0;
  const latest = incomingUpdatedAt >= existingUpdatedAt ? incoming : existing;
  const fallback = latest === incoming ? existing : incoming;
  return {
    ...latest,
    localGoalId: latest.localGoalId ?? fallback.localGoalId ?? null,
  };
}

export function normalizeGoalHistory(
  goals: NonNullable<ThreadDetailDto['goalHistory']>,
) {
  const byKey = new Map<string, NonNullable<ThreadDetailDto['goal']>>();
  for (const goal of goals) {
    const key = goalKey(goal);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeGoalEntry(existing, goal) : goal);
  }
  return [...byKey.values()].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

export function mergeGoalHistory(
  existing: NonNullable<ThreadDetailDto['goalHistory']>,
  goal: NonNullable<ThreadDetailDto['goal']>,
) {
  return normalizeGoalHistory([goal, ...existing]);
}

export function formatGoalTokenUsage(goal: NonNullable<ThreadDetailDto['goal']>) {
  const formatter = new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  return goal.tokenBudget === null
    ? `${formatter.format(goal.tokensUsed)} tok`
    : `${formatter.format(goal.tokensUsed)}/${formatter.format(goal.tokenBudget)} tok`;
}

export function formatGoalRuntime(seconds: number) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${minutes}m`;
}

export function getReasoningEffortAvailability(
  modelOptions: ModelOptionDto[],
  model: string | null,
) {
  if (!model) {
    return null;
  }

  const matchedModel = modelOptions.find((entry) => entry.model === model);
  if (!matchedModel) {
    return null;
  }

  return matchedModel.supportedReasoningEfforts.length > 1;
}

export function createClientRequestId() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `client-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function turnHasUserMessage(
  turn: ThreadDetailDto['turns'][number] | undefined,
  prompt: string,
) {
  return (
    turn?.items.some(
      (item) => item.kind === 'userMessage' && item.text.trim() === prompt.trim(),
    ) ?? false
  );
}

const PHOTO_PLACEHOLDER_PATTERN = /\s*\[(?:PHOTO\s+[^\]]+|localImage)\]\s*/g;

export function promptHasPhotoPlaceholder(prompt: string) {
  return /\[(?:PHOTO\s+[^\]]+|localImage)\]/.test(prompt);
}

function promptWithoutPhotoTokens(prompt: string) {
  return prompt.replace(PHOTO_PLACEHOLDER_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

export function turnHasPhotoPromptText(
  turn: ThreadDetailDto['turns'][number] | undefined,
  prompt: string,
) {
  const normalizedPrompt = promptWithoutPhotoTokens(prompt);
  if (!normalizedPrompt) {
    return false;
  }

  return (
    turn?.items.some(
      (item) =>
        item.kind === 'userMessage' &&
        promptWithoutPhotoTokens(item.text) === normalizedPrompt,
    ) ?? false
  );
}

export function turnHasPhotoAttachment(
  turn: ThreadDetailDto['turns'][number] | undefined,
) {
  return (
    turn?.items.some(
      (item) =>
        item.kind === 'userMessage' &&
        /\[(?:PHOTO\s+\.\/\.temp\/threads\/[^\]]+|localImage)\]/.test(item.text),
    ) ?? false
  );
}

export function findTurnWithUserMessage(
  turns: ThreadDetailDto['turns'],
  prompt: string,
) {
  return (
    turns.find((turn) => turnHasUserMessage(turn, prompt)) ??
    (promptHasPhotoPlaceholder(prompt)
      ? turns.find((turn) => turnHasPhotoPromptText(turn, prompt)) ?? null
      : null)
  );
}

export function findMaterializedOptimisticTurn(
  turns: ThreadDetailDto['turns'],
  optimistic: { id: string; serverTurnId: string | null; prompt: string },
) {
  return turns.find((turn) => {
    const matchesAuthoritativeId =
      (optimistic.serverTurnId !== null && turn.id === optimistic.serverTurnId)
      || turn.id === optimistic.id;
    if (
      matchesAuthoritativeId
      && turn.items.some((item) => item.kind === 'userMessage')
    ) {
      return true;
    }

    return (
      turnHasUserMessage(turn, optimistic.prompt)
      || (
        promptHasPhotoPlaceholder(optimistic.prompt)
        && (
          turnHasPhotoPromptText(turn, optimistic.prompt)
          || turnHasPhotoAttachment(turn)
        )
      )
    );
  }) ?? null;
}

export function mergeTurnTokenUsage(
  turns: ThreadDetailDto['turns'],
  turnId: string,
  tokenUsage: ThreadTurnTokenUsageDto,
  priceEstimate: ThreadTurnPriceEstimateDto | null,
) {
  let changed = false;
  const nextTurns = turns.map((turn) => {
    if (turn.id !== turnId) {
      return turn;
    }

    changed = true;
    return {
      ...turn,
      tokenUsage,
      priceEstimate,
    };
  });

  return changed ? nextTurns : turns;
}
