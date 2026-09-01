import type * as acp from '@agentclientprotocol/sdk';

import type {
  AgentSessionHistoryCoverage,
  AgentTurn,
} from '../../agent-runtime/src/types';
import { AcpTurnItemMapper } from './item-mapper';

interface HydratedTurnBuilder {
  userMessageId: string | null;
  mapper: AcpTurnItemMapper;
  startedAt: string;
  sawNonUserUpdate: boolean;
}

function updateMessageId(update: { messageId?: unknown }) {
  return typeof update.messageId === 'string' && update.messageId.trim()
    ? update.messageId.trim()
    : null;
}

export class AcpSessionHydrator {
  private readonly turns: AgentTurn[] = [];
  private readonly leadingUpdates: acp.SessionUpdate[] = [];
  private current: HydratedTurnBuilder | null = null;
  private turnIndex = 0;
  private providerIdentifiedTurnCount = 0;
  private readonly receivedAt = Date.now();

  constructor(private readonly providerSessionId: string) {}

  apply(update: acp.SessionUpdate) {
    if (update.sessionUpdate === 'user_message_chunk') {
      this.applyUserMessage(update);
      return;
    }
    if (
      update.sessionUpdate === 'config_option_update' ||
      update.sessionUpdate === 'current_mode_update' ||
      update.sessionUpdate === 'available_commands_update' ||
      update.sessionUpdate === 'session_info_update' ||
      update.sessionUpdate === 'usage_update'
    ) {
      return;
    }
    if (!this.current) {
      this.leadingUpdates.push(update);
      return;
    }
    const current = this.current;
    this.flushLeadingUpdates(current);
    current.sawNonUserUpdate = true;
    current.mapper.apply(update);
  }

  complete() {
    this.finishCurrent();
    return [...this.turns];
  }

  coverage(): AgentSessionHistoryCoverage {
    this.finishCurrent();
    return {
      source: 'providerReplay',
      // ACP v1 has no authoritative history total; absence cannot prove completeness.
      completeness: 'unknown',
      replayedTurnCount: this.turns.length,
      replayedItemCount: this.turns.reduce(
        (count, turn) => count + turn.items.length,
        0,
      ),
      providerIdentifiedTurnCount: this.providerIdentifiedTurnCount,
    };
  }

  private applyUserMessage(
    update: Extract<acp.SessionUpdate, { sessionUpdate: 'user_message_chunk' }>,
  ) {
    const messageId = updateMessageId(update);
    const shouldStartTurn =
      !this.current ||
      this.current.sawNonUserUpdate ||
      Boolean(
        messageId &&
        this.current.userMessageId &&
        messageId !== this.current.userMessageId,
      );
    if (shouldStartTurn) {
      if (this.current) {
        this.finishCurrent();
      }
      this.startTurn(messageId);
    }
    const current = this.current!;
    if (messageId && !current.userMessageId) {
      current.userMessageId = messageId;
    }
    current.mapper.appendUserMessage(
      update.content,
      current.userMessageId ?? `${current.mapper.turnId}:user`,
    );
  }

  private startTurn(userMessageId: string | null) {
    const index = this.turnIndex++;
    const stableSource = userMessageId ?? `${this.providerSessionId}:${index}`;
    const builder: HydratedTurnBuilder = {
      userMessageId,
      mapper: new AcpTurnItemMapper(
        `acp-hydrated:${stableSource}`,
        [],
        'hydrate',
      ),
      startedAt: new Date(this.receivedAt + index).toISOString(),
      sawNonUserUpdate: false,
    };
    if (userMessageId) {
      this.providerIdentifiedTurnCount += 1;
    }
    this.current = builder;
    return builder;
  }

  private finishCurrent() {
    if (!this.current && this.leadingUpdates.length > 0) {
      this.startTurn(null);
    }
    if (!this.current) {
      return;
    }
    this.flushLeadingUpdates(this.current);
    const completed = this.current.mapper.complete('completed').turn;
    if (completed.items.length > 0) {
      this.turns.push({
        ...completed,
        startedAt: this.current.startedAt,
      });
    }
    this.current = null;
  }

  private flushLeadingUpdates(current: HydratedTurnBuilder) {
    for (const update of this.leadingUpdates.splice(0)) {
      current.mapper.apply(update);
    }
  }
}
