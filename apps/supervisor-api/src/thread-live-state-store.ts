import type { AgentTurn } from '../../../packages/agent-runtime/src/index';
import type {
  ThreadHistoryItemDto,
  ThreadLiveItemsDto,
  ThreadLivePlanDto,
  ThreadTurnDto,
} from '../../../packages/shared/src/index';
import {
  sortHistoryItemsBySequence,
  type TurnItemOrderSnapshot,
} from './thread-history-items';

interface RuntimeDisplayTurnMapping {
  runtimeTurnId: string;
  displayTurnId: string;
}

interface AgentMessageOrderingHint {
  id: string;
  text: string;
  sequence: number;
  createdAt: string | null;
}

export class ThreadLiveStateStore {
  private readonly runtimeDisplayTurnIds = new Map<string, RuntimeDisplayTurnMapping>();
  private readonly hiddenRuntimeTurnIds = new Map<string, Set<string>>();
  private readonly threadLivePlans = new Map<string, ThreadLivePlanDto>();
  private readonly threadLiveItems = new Map<string, ThreadLiveItemsDto>();
  private readonly threadTurnItemOrder = new Map<string, Map<string, Map<string, number>>>();
  private readonly threadNextTurnItemSequence = new Map<string, Map<string, number>>();
  private readonly threadMaterializedAgentMessageCounts = new Map<string, Map<string, number>>();
  private readonly threadAgentMessageOrderingHints = new Map<
    string,
    Map<string, Map<string, AgentMessageOrderingHint>>
  >();

  displayTurnIdForRuntimeTurn(
    localThreadId: string,
    runtimeTurnId: string | null | undefined,
  ) {
    if (!runtimeTurnId) {
      return null;
    }

    const mapping = this.runtimeDisplayTurnIds.get(localThreadId);
    return mapping?.runtimeTurnId === runtimeTurnId
      ? mapping.displayTurnId
      : runtimeTurnId;
  }

  setRuntimeDisplayTurnMapping(
    localThreadId: string,
    mapping: RuntimeDisplayTurnMapping,
  ) {
    this.runtimeDisplayTurnIds.set(localThreadId, mapping);
  }

  clearRuntimeDisplayTurnMapping(localThreadId: string, runtimeTurnId: string) {
    const mapping = this.runtimeDisplayTurnIds.get(localThreadId);
    if (mapping?.runtimeTurnId === runtimeTurnId) {
      this.runtimeDisplayTurnIds.delete(localThreadId);
    }
  }

  hideRuntimeTurn(localThreadId: string, runtimeTurnId: string) {
    let hiddenTurns = this.hiddenRuntimeTurnIds.get(localThreadId);
    if (!hiddenTurns) {
      hiddenTurns = new Set();
      this.hiddenRuntimeTurnIds.set(localThreadId, hiddenTurns);
    }
    hiddenTurns.add(runtimeTurnId);
  }

  visibleRemoteTurns(localThreadId: string, turns: AgentTurn[]) {
    const hiddenTurns = this.hiddenRuntimeTurnIds.get(localThreadId);
    if (!hiddenTurns || hiddenTurns.size === 0) {
      return turns;
    }
    return turns.filter((turn) => !hiddenTurns.has(turn.providerTurnId));
  }

  hiddenRemoteTurns(localThreadId: string, turns: AgentTurn[]) {
    const hiddenTurns = this.hiddenRuntimeTurnIds.get(localThreadId);
    if (!hiddenTurns || hiddenTurns.size === 0) {
      return [];
    }
    return turns.filter((turn) => hiddenTurns.has(turn.providerTurnId));
  }

  clearThread(localThreadId: string) {
    this.threadLivePlans.delete(localThreadId);
    this.threadLiveItems.delete(localThreadId);
    this.threadMaterializedAgentMessageCounts.delete(localThreadId);
    this.threadAgentMessageOrderingHints.delete(localThreadId);
    this.clearRecordedTurnItemOrders(localThreadId);
    this.runtimeDisplayTurnIds.delete(localThreadId);
    this.hiddenRuntimeTurnIds.delete(localThreadId);
  }

  getLivePlan(localThreadId: string): ThreadLivePlanDto | null {
    return this.threadLivePlans.get(localThreadId) ?? null;
  }

  setLivePlan(localThreadId: string, plan: ThreadLivePlanDto | null) {
    if (plan) {
      this.threadLivePlans.set(localThreadId, plan);
    } else {
      this.threadLivePlans.delete(localThreadId);
    }
  }

  setLiveItems(localThreadId: string, liveItems: ThreadLiveItemsDto | null) {
    if (liveItems && liveItems.items.length > 0) {
      this.threadLiveItems.set(localThreadId, liveItems);
      return;
    }

    this.threadLiveItems.delete(localThreadId);
  }

  resetRecordedTurnItemOrder(localThreadId: string, turnId: string) {
    this.threadTurnItemOrder.get(localThreadId)?.delete(turnId);
    this.threadNextTurnItemSequence.get(localThreadId)?.delete(turnId);
    this.threadAgentMessageOrderingHints.get(localThreadId)?.delete(turnId);
  }

  clearRecordedTurnItemOrders(localThreadId: string) {
    this.threadTurnItemOrder.delete(localThreadId);
    this.threadNextTurnItemSequence.delete(localThreadId);
    this.threadAgentMessageOrderingHints.delete(localThreadId);
  }

  recordTurnItemOrder(localThreadId: string, turnId: string, itemId: string) {
    let threadOrders = this.threadTurnItemOrder.get(localThreadId);
    if (!threadOrders) {
      threadOrders = new Map();
      this.threadTurnItemOrder.set(localThreadId, threadOrders);
    }

    let turnOrder = threadOrders.get(turnId);
    if (!turnOrder) {
      turnOrder = new Map();
      threadOrders.set(turnId, turnOrder);
    }

    const existing = turnOrder.get(itemId);
    if (existing !== undefined) {
      return existing;
    }

    let threadSequences = this.threadNextTurnItemSequence.get(localThreadId);
    if (!threadSequences) {
      threadSequences = new Map();
      this.threadNextTurnItemSequence.set(localThreadId, threadSequences);
    }

    const sequence = threadSequences.get(turnId) ?? 0;
    threadSequences.set(turnId, sequence + 1);
    turnOrder.set(itemId, sequence);
    return sequence;
  }

  turnItemOrderSnapshot(localThreadId: string): TurnItemOrderSnapshot {
    return this.threadTurnItemOrder.get(localThreadId) ?? new Map();
  }

  finalTurnAgentMessageOrderingHints(
    localThreadId: string,
    turnId: string,
    items: ThreadHistoryItemDto[],
    options: { allowUnmatchedFallback?: boolean } = {},
  ) {
    return new Map(
      [...this.finalTurnAgentMessageOrderingMetadata(localThreadId, turnId, items, options)]
        .map(([itemId, metadata]) => [itemId, metadata.sequence]),
    );
  }

  finalTurnAgentMessageOrderingMetadata(
    localThreadId: string,
    turnId: string,
    items: ThreadHistoryItemDto[],
    options: { allowUnmatchedFallback?: boolean } = {},
  ) {
    const hints = new Map<string, { sequence: number; createdAt: string | null }>();
    const turnOrder = this.threadTurnItemOrder.get(localThreadId)?.get(turnId);
    const liveAgentMessages = [
      ...(this.threadAgentMessageOrderingHints
        .get(localThreadId)
        ?.get(turnId)
        ?.values() ?? []),
    ].map((item) => ({
      id: item.id,
      text: normalizeAgentMessageForMatching(item.text),
      sequence: item.sequence,
      createdAt: item.createdAt,
    }));
    const usedLiveAgentIds = new Set<string>();
    const finalAgentItems = items.filter((item) => item.kind === 'agentMessage');

    for (const item of finalAgentItems) {
      const existingSequence = turnOrder?.get(item.id);
      if (existingSequence !== undefined) {
        const matchingLiveAgent = liveAgentMessages.find(
          (liveAgent) =>
            liveAgent.id === item.id || liveAgent.sequence === existingSequence,
        );
        hints.set(item.id, {
          sequence: existingSequence,
          createdAt: matchingLiveAgent?.createdAt ?? null,
        });
        if (matchingLiveAgent) {
          usedLiveAgentIds.add(matchingLiveAgent.id);
        }
        continue;
      }

      const text = normalizeAgentMessageForMatching(item.text);
      if (!text) {
        continue;
      }

      let bestMatch:
        | {
            id: string;
            sequence: number;
            createdAt: string | null;
            score: number;
          }
        | null = null;
      for (const liveAgent of liveAgentMessages) {
        if (usedLiveAgentIds.has(liveAgent.id) || !liveAgent.text) {
          continue;
        }

        const score = agentMessageMatchScore(text, liveAgent.text);
        if (score === 0 || (bestMatch && bestMatch.score >= score)) {
          continue;
        }

        bestMatch = {
          id: liveAgent.id,
          sequence: liveAgent.sequence,
          createdAt: liveAgent.createdAt,
          score,
        };
      }

      if (bestMatch) {
        usedLiveAgentIds.add(bestMatch.id);
        hints.set(item.id, {
          sequence: bestMatch.sequence,
          createdAt: bestMatch.createdAt,
        });
      }
    }

    if (options.allowUnmatchedFallback ?? true) {
      const remainingLiveAgents = liveAgentMessages
        .filter((liveAgent) => !usedLiveAgentIds.has(liveAgent.id))
        .sort((left, right) => left.sequence - right.sequence);
      let remainingLiveAgentIndex = 0;
      for (const item of finalAgentItems) {
        if (hints.has(item.id) || !normalizeAgentMessageForMatching(item.text)) {
          continue;
        }

        const liveAgent = remainingLiveAgents[remainingLiveAgentIndex];
        if (!liveAgent) {
          break;
        }

        hints.set(item.id, {
          sequence: liveAgent.sequence,
          createdAt: liveAgent.createdAt,
        });
        remainingLiveAgentIndex += 1;
      }
    }

    return hints;
  }

  getLiveItems(
    localThreadId: string,
    allTurns: ThreadTurnDto[],
    visibleTurns: ThreadTurnDto[] = allTurns,
  ): ThreadLiveItemsDto | null {
    const current = this.threadLiveItems.get(localThreadId);
    if (!current) {
      return null;
    }

    const reconciled = this.reconcileLiveItems(localThreadId, allTurns);
    if (!reconciled) {
      return null;
    }

    const visibleTurnIds = new Set(visibleTurns.map((turn) => turn.id));
    return visibleTurnIds.has(reconciled.turnId) ? reconciled : null;
  }

  getLiveItemsForTurn(localThreadId: string, turnId: string | null | undefined) {
    if (!turnId) {
      return null;
    }

    const current = this.threadLiveItems.get(localThreadId);
    return current?.turnId === turnId ? current : null;
  }

  upsertLiveItem(
    localThreadId: string,
    turnId: string,
    item: ThreadHistoryItemDto,
  ) {
    const current = this.threadLiveItems.get(localThreadId);
    const currentItems =
      current?.turnId === turnId ? current.items : [];
    const existingIndex = currentItems.findIndex((entry) => entry.id === item.id);
    const nextItem =
      existingIndex >= 0 && !item.createdAt && currentItems[existingIndex]?.createdAt
        ? { ...item, createdAt: currentItems[existingIndex]!.createdAt }
        : item;
    const nextItems =
      existingIndex >= 0
        ? currentItems.map((entry, index) => (index === existingIndex ? nextItem : entry))
        : [...currentItems, nextItem];

    this.setLiveItems(localThreadId, {
      turnId,
      items: sortHistoryItemsBySequence(nextItems),
      updatedAt: new Date().toISOString(),
    });
  }

  appendLiveAgentMessageDelta(input: {
    localThreadId: string;
    turnId: string;
    itemId: string;
    delta: string;
    sequence: number;
    createdAt?: string | null | undefined;
  }): ThreadHistoryItemDto {
    const current = this.threadLiveItems.get(input.localThreadId);
    const currentItems =
      current?.turnId === input.turnId ? current.items : [];
    const existing = currentItems.find((entry) => entry.id === input.itemId);
    const nextItem: ThreadHistoryItemDto =
      existing?.kind === 'agentMessage'
        ? {
            ...existing,
            text: `${existing.text}${input.delta}`,
            sequence: input.sequence,
          }
        : {
            id: input.itemId,
            createdAt: input.createdAt ?? new Date().toISOString(),
            kind: 'agentMessage',
            text: input.delta,
            sequence: input.sequence,
          };
    this.recordAgentMessageOrderingHint(
      input.localThreadId,
      input.turnId,
      nextItem,
      input.sequence,
    );

    this.setLiveItems(input.localThreadId, {
      turnId: input.turnId,
      items: sortHistoryItemsBySequence(
        existing
          ? currentItems.map((entry) =>
              entry.id === input.itemId ? nextItem : entry,
            )
          : [...currentItems, nextItem],
      ),
      updatedAt: new Date().toISOString(),
    });
    return nextItem;
  }

  private recordAgentMessageOrderingHint(
    localThreadId: string,
    turnId: string,
    item: ThreadHistoryItemDto,
    sequence: number,
  ) {
    if (item.kind !== 'agentMessage' || !Number.isFinite(sequence)) {
      return;
    }

    let threadHints = this.threadAgentMessageOrderingHints.get(localThreadId);
    if (!threadHints) {
      threadHints = new Map();
      this.threadAgentMessageOrderingHints.set(localThreadId, threadHints);
    }

    let turnHints = threadHints.get(turnId);
    if (!turnHints) {
      turnHints = new Map();
      threadHints.set(turnId, turnHints);
    }

    turnHints.set(item.id, {
      id: item.id,
      text: item.text,
      sequence,
      createdAt: item.createdAt ?? null,
    });
  }

  private reconcileLiveItems(
    localThreadId: string,
    turns: ThreadTurnDto[],
  ): ThreadLiveItemsDto | null {
    const current = this.threadLiveItems.get(localThreadId);
    if (!current) {
      return null;
    }

    const matchingTurn = turns.find((turn) => turn.id === current.turnId);
    const materializedItemsById = new Map(
      matchingTurn?.items.map((item) => [item.id, item]) ?? [],
    );
    const materializedAgentTexts =
      matchingTurn?.items
        .filter((item) => item.kind === 'agentMessage')
        .map((item) => item.text.trim())
        .filter(Boolean) ?? [];
    const materializedAgentMessageCount =
      matchingTurn?.items.filter((item) => item.kind === 'agentMessage').length ?? 0;
    const nextItems = current.items.filter((item) => {
      const materializedItem = materializedItemsById.get(item.id);
      if (item.kind === 'agentMessage') {
        if (materializedItem?.kind === 'agentMessage') {
          return false;
        }
        const itemText = item.text.trim();
        if (
          itemText.length > 0 &&
          materializedAgentTexts.some((text) => text.includes(itemText))
        ) {
          return false;
        }
      }

      if (!materializedItem) {
        return true;
      }

      return (
        typeof item.sequence === 'number' &&
        Number.isFinite(item.sequence) &&
        materializedItem.sequence !== item.sequence
      );
    });

    if (matchingTurn) {
      let threadCounts = this.threadMaterializedAgentMessageCounts.get(localThreadId);
      if (!threadCounts) {
        threadCounts = new Map();
        this.threadMaterializedAgentMessageCounts.set(localThreadId, threadCounts);
      }
      threadCounts.set(current.turnId, materializedAgentMessageCount);
    }

    if (nextItems.length === current.items.length) {
      return current;
    }

    if (nextItems.length === 0) {
      this.threadLiveItems.delete(localThreadId);
      return null;
    }

    const nextLiveItems: ThreadLiveItemsDto = {
      ...current,
      items: nextItems,
      updatedAt: new Date().toISOString(),
    };
    this.threadLiveItems.set(localThreadId, nextLiveItems);
    return nextLiveItems;
  }
}

function normalizeAgentMessageForMatching(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function agentMessageMatchScore(finalText: string, liveText: string) {
  if (finalText === liveText) {
    return 3;
  }

  // Very short streaming fragments can appear in unrelated final answers.
  if (liveText.length >= 8 && finalText.includes(liveText)) {
    return 2;
  }

  if (finalText.length >= 8 && liveText.includes(finalText)) {
    return 1;
  }

  return 0;
}
