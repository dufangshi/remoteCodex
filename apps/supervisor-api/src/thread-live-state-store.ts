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

export class ThreadLiveStateStore {
  private readonly runtimeDisplayTurnIds = new Map<string, RuntimeDisplayTurnMapping>();
  private readonly hiddenRuntimeTurnIds = new Map<string, Set<string>>();
  private readonly threadLivePlans = new Map<string, ThreadLivePlanDto>();
  private readonly threadLiveItems = new Map<string, ThreadLiveItemsDto>();
  private readonly threadTurnItemOrder = new Map<string, Map<string, Map<string, number>>>();
  private readonly threadNextTurnItemSequence = new Map<string, Map<string, number>>();
  private readonly threadMaterializedAgentMessageCounts = new Map<string, Map<string, number>>();

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
  }

  clearRecordedTurnItemOrders(localThreadId: string) {
    this.threadTurnItemOrder.delete(localThreadId);
    this.threadNextTurnItemSequence.delete(localThreadId);
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

  upsertLiveItem(
    localThreadId: string,
    turnId: string,
    item: ThreadHistoryItemDto,
  ) {
    const current = this.threadLiveItems.get(localThreadId);
    const currentItems =
      current?.turnId === turnId ? current.items : [];
    const nextItems = [
      ...currentItems.filter((entry) => entry.id !== item.id),
      item,
    ];

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
            kind: 'agentMessage',
            text: input.delta,
            sequence: input.sequence,
          };

    this.setLiveItems(input.localThreadId, {
      turnId: input.turnId,
      items: sortHistoryItemsBySequence([
        ...currentItems.filter((entry) => entry.id !== input.itemId),
        nextItem,
      ]),
      updatedAt: new Date().toISOString(),
    });
    return nextItem;
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
