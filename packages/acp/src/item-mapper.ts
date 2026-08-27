import type * as acp from '@agentclientprotocol/sdk';

import type {
  AgentHistoryItem,
  AgentTurn,
} from '../../agent-runtime/src/index';

export interface AcpMappedItemUpdate {
  item: AgentHistoryItem;
  completed: boolean;
}

export interface AcpMappedPlanUpdate {
  explanation: string | null;
  plan: Array<{ step: string; status: string }>;
}

export interface AcpMappedSessionUpdate {
  itemUpdates: AcpMappedItemUpdate[];
  outputDeltas: Array<{ itemId: string; delta: string }>;
  planUpdate: AcpMappedPlanUpdate | null;
  title: string | null | undefined;
  usage: { used: number; size: number; cost?: acp.Cost | null } | null;
}

interface StoredToolCall extends acp.ToolCall {
  title: string;
}

function compactJson(value: unknown) {
  if (value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function recordValue(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (Array.isArray(candidate) && candidate.every((part) => typeof part === 'string')) {
      return candidate.join(' ');
    }
  }
  return null;
}

export function acpContentBlockText(content: acp.ContentBlock): string {
  switch (content.type) {
    case 'text':
      return content.text;
    case 'image':
      return content.uri
        ? `[Image: ${content.uri}]`
        : `[Image: ${content.mimeType}]`;
    case 'audio':
      return `[Audio: ${content.mimeType}]`;
    case 'resource_link':
      return `[${content.title ?? content.name}](${content.uri})`;
    case 'resource':
      return 'text' in content.resource
        ? content.resource.text
        : `[Resource: ${content.resource.uri}]`;
  }
}

function toolContentText(content: acp.ToolCallContent) {
  switch (content.type) {
    case 'content':
      return acpContentBlockText(content.content);
    case 'diff':
      return [
        `File: ${content.path}`,
        '',
        'Before:',
        content.oldText ?? '(new file)',
        '',
        'After:',
        content.newText,
      ].join('\n');
    case 'terminal':
      return `Terminal: ${content.terminalId}`;
  }
}

function normalizedToolName(tool: StoredToolCall) {
  return `${tool.name ?? ''} ${tool.title}`.trim().toLowerCase();
}

function toolItemKind(tool: StoredToolCall): AgentHistoryItem['kind'] {
  const name = normalizedToolName(tool);
  if (name.includes('subagent') || /\b(agent|task)\b/.test(name)) {
    return 'agentToolCall';
  }
  if (/\bskill\b/.test(name)) {
    return 'skillToolCall';
  }
  if (tool.kind === 'execute') {
    return 'commandExecution';
  }
  if (tool.kind === 'edit' || tool.kind === 'delete' || tool.kind === 'move') {
    return 'fileChange';
  }
  if (tool.kind === 'read') {
    return 'fileRead';
  }
  if (tool.kind === 'fetch' || name.includes('web') || name.includes('http')) {
    return 'webSearch';
  }
  if (tool.kind === 'think') {
    return 'reasoning';
  }
  return 'toolCall';
}

function mappedToolStatus(status: acp.ToolCallStatus | null | undefined) {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'pending':
    case 'in_progress':
    default:
      return 'running';
  }
}

function lineCount(value: string | null | undefined) {
  return value ? value.replace(/\r\n/g, '\n').split('\n').length : 0;
}

export function acpToolCallToHistoryItem(tool: StoredToolCall): AgentHistoryItem {
  const kind = toolItemKind(tool);
  const locationText = tool.locations?.map((location) => location.path).join(', ') ?? '';
  const command = recordValue(tool.rawInput, ['command', 'cmd', 'argv']);
  const summary = command || locationText || tool.title || tool.name || 'Tool call';
  const detailParts = [
    `Tool: ${tool.name ?? tool.title}`,
    tool.kind ? `Kind: ${tool.kind}` : '',
    tool.status ? `Status: ${tool.status}` : '',
    tool.locations?.length
      ? `Locations:\n${tool.locations.map((location) => `- ${location.path}${location.line ? `:${location.line}` : ''}`).join('\n')}`
      : '',
    tool.rawInput !== undefined ? `Input:\n${compactJson(tool.rawInput)}` : '',
    tool.content?.length
      ? `Content:\n${tool.content.map(toolContentText).join('\n\n')}`
      : '',
    tool.rawOutput !== undefined ? `Output:\n${compactJson(tool.rawOutput)}` : '',
  ].filter(Boolean);
  const diffs = tool.content?.filter(
    (content): content is Extract<acp.ToolCallContent, { type: 'diff' }> =>
      content.type === 'diff',
  ) ?? [];
  const addedLines = diffs.reduce(
    (total, diff) => total + Math.max(0, lineCount(diff.newText) - lineCount(diff.oldText)),
    0,
  );
  const removedLines = diffs.reduce(
    (total, diff) => total + Math.max(0, lineCount(diff.oldText) - lineCount(diff.newText)),
    0,
  );

  return {
    id: tool.toolCallId,
    kind,
    text: summary,
    previewText: summary,
    detailText: detailParts.join('\n\n'),
    status: mappedToolStatus(tool.status),
    ...(kind === 'fileChange'
      ? {
          changedFiles: new Set([
            ...diffs.map((diff) => diff.path),
            ...(tool.locations?.map((location) => location.path) ?? []),
          ]).size || null,
          addedLines: diffs.length > 0 ? addedLines : null,
          removedLines: diffs.length > 0 ? removedLines : null,
        }
      : {}),
  };
}

function mergeDefined<T extends object>(current: T, patch: object): T {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  return Object.assign({}, current, Object.fromEntries(entries));
}

function planText(entries: acp.PlanEntry[]) {
  return entries
    .map((entry) => {
      const marker = entry.status === 'completed' ? 'x' : ' ';
      return `- [${marker}] ${entry.content}`;
    })
    .join('\n');
}

function mappedPlan(entries: acp.PlanEntry[]): AcpMappedPlanUpdate {
  return {
    explanation: null,
    plan: entries.map((entry) => ({
      step: entry.content,
      status: entry.status === 'in_progress' ? 'in_progress' : entry.status,
    })),
  };
}

export class AcpTurnItemMapper {
  private readonly items = new Map<string, AgentHistoryItem>();
  private readonly order: string[] = [];
  private readonly tools = new Map<string, StoredToolCall>();
  private agentMessageIndex = 0;
  private thoughtIndex = 0;
  private currentAgentMessageId: string | null = null;
  private currentThoughtId: string | null = null;

  constructor(
    readonly turnId: string,
    initialItems: AgentHistoryItem[] = [],
  ) {
    for (const item of initialItems) {
      this.upsert(item);
    }
  }

  turn(status: AgentTurn['status'] = 'inProgress', error: string | null = null): AgentTurn {
    return {
      providerTurnId: this.turnId,
      status,
      error: error ? { message: error } : null,
      items: this.order.map((id) => this.items.get(id)!).filter(Boolean),
    };
  }

  apply(update: acp.SessionUpdate): AcpMappedSessionUpdate {
    const result: AcpMappedSessionUpdate = {
      itemUpdates: [],
      outputDeltas: [],
      planUpdate: null,
      title: undefined,
      usage: null,
    };

    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        return result;
      case 'agent_message_chunk': {
        result.itemUpdates.push(...this.finishThought());
        const delta = acpContentBlockText(update.content);
        const itemId = this.currentAgentMessageId ?? `${this.turnId}:agent:${++this.agentMessageIndex}`;
        this.currentAgentMessageId = itemId;
        const current = this.items.get(itemId);
        const item: AgentHistoryItem = {
          ...(current ?? { id: itemId, kind: 'agentMessage' as const }),
          text: `${current?.text ?? ''}${delta}`,
          status: 'running',
        };
        this.upsert(item);
        result.outputDeltas.push({ itemId, delta });
        return result;
      }
      case 'agent_thought_chunk': {
        result.itemUpdates.push(...this.finishAgentMessage());
        const delta = acpContentBlockText(update.content);
        const itemId = this.currentThoughtId ?? `${this.turnId}:thought:${++this.thoughtIndex}`;
        this.currentThoughtId = itemId;
        const current = this.items.get(itemId);
        const item: AgentHistoryItem = {
          ...(current ?? { id: itemId, kind: 'reasoning' as const }),
          text: `${current?.text ?? ''}${delta}`,
          status: 'running',
        };
        this.upsert(item);
        result.itemUpdates.push({ item, completed: false });
        return result;
      }
      case 'tool_call': {
        result.itemUpdates.push(...this.finishOpenText());
        const tool: StoredToolCall = {
          ...update,
          title: update.title || update.name || 'Tool call',
        };
        this.tools.set(tool.toolCallId, tool);
        const item = acpToolCallToHistoryItem(tool);
        this.upsert(item);
        result.itemUpdates.push({ item, completed: tool.status === 'completed' || tool.status === 'failed' });
        return result;
      }
      case 'tool_call_update': {
        result.itemUpdates.push(...this.finishOpenText());
        const previous = this.tools.get(update.toolCallId) ?? {
          toolCallId: update.toolCallId,
          title: update.title ?? update.name ?? 'Tool call',
        };
        const tool = mergeDefined(previous, update) as StoredToolCall;
        tool.title ||= tool.name || 'Tool call';
        this.tools.set(tool.toolCallId, tool);
        const item = acpToolCallToHistoryItem(tool);
        this.upsert(item);
        result.itemUpdates.push({ item, completed: tool.status === 'completed' || tool.status === 'failed' });
        return result;
      }
      case 'plan': {
        result.itemUpdates.push(...this.finishOpenText());
        const item: AgentHistoryItem = {
          id: `${this.turnId}:plan`,
          kind: 'plan',
          text: planText(update.entries),
          previewText: 'Plan',
          status: update.entries.every((entry) => entry.status === 'completed')
            ? 'completed'
            : 'running',
        };
        this.upsert(item);
        result.itemUpdates.push({ item, completed: item.status === 'completed' });
        result.planUpdate = mappedPlan(update.entries);
        return result;
      }
      case 'plan_update': {
        result.itemUpdates.push(...this.finishOpenText());
        if (update.plan.type === 'items') {
          const item: AgentHistoryItem = {
            id: `${this.turnId}:plan:${update.plan.planId}`,
            kind: 'plan',
            text: planText(update.plan.entries),
            previewText: 'Plan',
            status: update.plan.entries.every((entry) => entry.status === 'completed')
              ? 'completed'
              : 'running',
          };
          this.upsert(item);
          result.itemUpdates.push({ item, completed: item.status === 'completed' });
          result.planUpdate = mappedPlan(update.plan.entries);
        } else if (update.plan.type === 'markdown') {
          const item: AgentHistoryItem = {
            id: `${this.turnId}:plan:${update.plan.planId}`,
            kind: 'plan',
            text: update.plan.content,
            previewText: 'Plan',
            status: 'running',
          };
          this.upsert(item);
          result.itemUpdates.push({ item, completed: false });
        }
        return result;
      }
      case 'plan_removed': {
        const itemId = `${this.turnId}:plan:${update.planId}`;
        const current = this.items.get(itemId);
        if (current) {
          const item = { ...current, status: 'cancelled' };
          this.upsert(item);
          result.itemUpdates.push({ item, completed: true });
        }
        result.planUpdate = { explanation: null, plan: [] };
        return result;
      }
      case 'session_info_update':
        result.title = update.title;
        return result;
      case 'usage_update':
        result.usage = {
          used: update.used,
          size: update.size,
          ...(update.cost !== undefined ? { cost: update.cost } : {}),
        };
        return result;
      case 'compaction_update': {
        result.itemUpdates.push(...this.finishOpenText());
        const summary = update.summary?.map(acpContentBlockText).join('\n\n') ?? '';
        const item: AgentHistoryItem = {
          id: `${this.turnId}:compaction:${update.compactionId}`,
          kind: 'contextCompaction',
          text: summary || update.error || 'Context compaction',
          previewText: 'Context compaction',
          status: update.status,
        };
        this.upsert(item);
        result.itemUpdates.push({
          item,
          completed: ['completed', 'failed', 'cancelled'].includes(update.status),
        });
        return result;
      }
      case 'compaction_summary_chunk': {
        const itemId = `${this.turnId}:compaction:${update.compactionId}`;
        const current = this.items.get(itemId);
        const item: AgentHistoryItem = {
          ...(current ?? {
            id: itemId,
            kind: 'contextCompaction' as const,
            previewText: 'Context compaction',
          }),
          text: `${current?.text ?? ''}${acpContentBlockText(update.content)}`,
          status: 'in_progress',
        };
        this.upsert(item);
        result.itemUpdates.push({ item, completed: false });
        return result;
      }
      case 'available_commands_update':
      case 'current_mode_update':
      case 'config_option_update':
        return result;
    }
  }

  complete(status: AgentTurn['status'], error: string | null = null) {
    const updates = this.finishOpenText();
    for (const id of this.order) {
      const current = this.items.get(id)!;
      const nextStatus = current.status === 'failed'
        ? 'failed'
        : status === 'failed'
          ? 'failed'
          : status === 'interrupted'
            ? 'interrupted'
            : 'completed';
      const item = current.status === nextStatus ? current : { ...current, status: nextStatus };
      this.items.set(id, item);
      if (!updates.some((entry) => entry.item.id === id)) {
        updates.push({ item, completed: true });
      }
    }
    return {
      updates,
      turn: this.turn(status, error),
    };
  }

  private upsert(item: AgentHistoryItem) {
    if (!this.items.has(item.id)) {
      this.order.push(item.id);
    }
    this.items.set(item.id, item);
  }

  private finishAgentMessage(): AcpMappedItemUpdate[] {
    if (!this.currentAgentMessageId) {
      return [];
    }
    const item = this.items.get(this.currentAgentMessageId)!;
    this.currentAgentMessageId = null;
    const completed = { ...item, status: 'completed' };
    this.items.set(completed.id, completed);
    return [{ item: completed, completed: true }];
  }

  private finishThought(): AcpMappedItemUpdate[] {
    if (!this.currentThoughtId) {
      return [];
    }
    const item = this.items.get(this.currentThoughtId)!;
    this.currentThoughtId = null;
    const completed = { ...item, status: 'completed' };
    this.items.set(completed.id, completed);
    return [{ item: completed, completed: true }];
  }

  private finishOpenText() {
    return [...this.finishAgentMessage(), ...this.finishThought()];
  }
}
