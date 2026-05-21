import type {
  AgentHistoryItem,
  AgentTurn,
} from '../../agent-runtime/src/index';

const CLAUDE_TOOL_LABELS: Record<string, string> = {
  Agent: 'Agent',
  Bash: 'Bash',
  Edit: 'Edit file',
  MultiEdit: 'Edit files',
  Write: 'Write file',
  NotebookEdit: 'Edit notebook',
  Read: 'Read file',
  Grep: 'Search files',
  Glob: 'Find files',
  LS: 'List files',
  WebSearch: 'Web search',
  WebFetch: 'Web fetch',
  Skill: 'Skill',
  Task: 'Agent',
  ToolSearch: 'Tool search',
  EnterPlanMode: 'Enter plan mode',
  ExitPlanMode: 'Exit plan mode',
  TodoWrite: 'Update todos',
};
const HIDDEN_ASK_USER_QUESTION_CONTINUATION_PREFIX =
  'The user answered the clarification questions below. Continue from the same plan-mode task using these answers.';
const SUPPRESSED_ASSISTANT_TEXTS = new Set([
  'No response requested.',
]);

function normalizedToolName(toolName: string) {
  return toolName.replace(/[\s_-]+/g, '').toLowerCase();
}

function isSuppressedClaudeToolName(toolName: string) {
  const normalized = normalizedToolName(toolName);
  return (
    normalized === 'askuserquestion' ||
    normalized === 'toolsearch' ||
    normalized === 'enterplanmode'
  );
}

function isExitPlanModeToolName(toolName: string) {
  return normalizedToolName(toolName) === 'exitplanmode';
}

function isWebToolName(toolName: string) {
  const normalized = normalizedToolName(toolName);
  return normalized === 'websearch' || normalized === 'webfetch';
}

function isFileInspectionToolName(toolName: string) {
  const normalized = normalizedToolName(toolName);
  return (
    normalized === 'read' ||
    normalized === 'grep' ||
    normalized === 'glob' ||
    normalized === 'ls'
  );
}

function isAgentToolName(toolName: string) {
  const normalized = normalizedToolName(toolName);
  return normalized === 'agent' || normalized === 'task';
}

function isSkillToolName(toolName: string) {
  return normalizedToolName(toolName) === 'skill';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function thinkingTextFromBlock(block: Record<string, unknown>): string | null {
  return (
    stringValue(block.thinking) ??
    stringValue(block.text) ??
    stringValue(block.content)
  );
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readableToolName(toolName: string) {
  if (CLAUDE_TOOL_LABELS[toolName]) {
    return CLAUDE_TOOL_LABELS[toolName];
  }
  if (toolName.startsWith('mcp__')) {
    return toolName.split('__').filter(Boolean).join(' / ');
  }
  return toolName;
}

function commandFromInput(input: unknown) {
  if (!isRecord(input)) {
    return null;
  }
  return stringValue(input.command) ?? stringValue(input.cmd) ?? stringValue(input.description);
}

function pathFromInput(input: unknown) {
  if (!isRecord(input)) {
    return null;
  }
  return (
    stringValue(input.file_path) ??
    stringValue(input.filePath) ??
    stringValue(input.path) ??
    stringValue(input.notebook_path)
  );
}

function summarizeToolInput(input: unknown) {
  if (!isRecord(input)) {
    return compactJson(input);
  }

  const description = stringValue(input.description);
  if (description) {
    return description;
  }

  const command = commandFromInput(input);
  if (command) {
    return command;
  }

  const filePath = pathFromInput(input);
  const pattern = stringValue(input.pattern);
  if (filePath && pattern) {
    return `${pattern} in ${filePath}`;
  }
  if (pattern) {
    return pattern;
  }
  if (filePath) {
    return filePath;
  }

  const query = stringValue(input.query) ?? stringValue(input.url) ?? stringValue(input.prompt);
  if (query) {
    return query;
  }

  const skill = stringValue(input.skill);
  if (skill) {
    const args = stringValue(input.args);
    return args ? `${skill}: ${args}` : skill;
  }

  return compactJson(input);
}

export function messageContentText(message: unknown): string {
  if (!isRecord(message)) {
    return '';
  }

  const content = message.content;
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((block) => {
      if (!isRecord(block)) {
        return '';
      }
      if (typeof block.text === 'string') {
        return block.text;
      }
      if (typeof block.content === 'string') {
        return block.content;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function hiddenInitPrompt() {
  return 'Initialize this Claude Code session for Remote Codex. Do not inspect or modify files. Reply with "Ready."';
}

export function isHiddenInitMessage(message: unknown) {
  return messageContentText(message).trim() === hiddenInitPrompt();
}

export function isHiddenContinuationMessage(message: unknown) {
  return messageContentText(message)
    .trim()
    .startsWith(HIDDEN_ASK_USER_QUESTION_CONTINUATION_PREFIX);
}

function shouldSuppressAssistantText(text: string) {
  return SUPPRESSED_ASSISTANT_TEXTS.has(text.trim());
}

export function userMessageToHistoryItem(id: string, message: unknown): AgentHistoryItem {
  return {
    id,
    kind: 'userMessage',
    text: messageContentText(message),
  };
}

export function userMessageHistoryItem(id: string, text: string): AgentHistoryItem {
  return {
    id,
    kind: 'userMessage',
    text,
  };
}

export function toolUseToHistoryItem(
  input: {
    id: string;
    name: string;
    toolInput: unknown;
    status?: string | null;
    result?: unknown;
    serverName?: string | null;
  },
): AgentHistoryItem | null {
  if (isSuppressedClaudeToolName(input.name)) {
    return null;
  }

  const detailParts = [
    `Tool: ${input.serverName ? `${input.serverName}/${input.name}` : input.name}`,
    '',
    'Input:',
    compactJson(input.toolInput),
  ];
  if (input.result !== undefined) {
    detailParts.push('', 'Result:', compactJson(input.result));
  }

  const summary = summarizeToolInput(input.toolInput);
  const status = input.status ?? (input.result === undefined ? 'running' : 'completed');
  const displayName = readableToolName(input.serverName ? `${input.serverName}/${input.name}` : input.name);

  if (input.name === 'Bash') {
    const command = commandFromInput(input.toolInput) ?? summary;
    return {
      id: input.id,
      kind: 'commandExecution',
      text: command || 'Bash command',
      previewText: command || 'Bash command',
      detailText: detailParts.join('\n'),
      status,
    };
  }

  if (isExitPlanModeToolName(input.name)) {
    const plan = isRecord(input.toolInput) ? stringValue(input.toolInput.plan) : null;
    return {
      id: input.id,
      kind: 'plan',
      text: plan ?? summary ?? 'Plan ready for review.',
      previewText: 'Plan ready',
      detailText: detailParts.join('\n'),
      status: input.status ?? 'completed',
    };
  }

  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(input.name)) {
    const filePath = pathFromInput(input.toolInput);
    return {
      id: input.id,
      kind: 'fileChange',
      text: filePath ?? displayName,
      previewText: filePath ? `${displayName}: ${filePath}` : displayName,
      detailText: detailParts.join('\n'),
      changedFiles: filePath ? 1 : null,
      addedLines: null,
      removedLines: null,
      status,
    };
  }

  if (isWebToolName(input.name)) {
    return {
      id: input.id,
      kind: 'webSearch',
      text: summary ? `${displayName}: ${summary}` : displayName,
      previewText: summary ? `${displayName}: ${summary}` : displayName,
      detailText: detailParts.join('\n'),
      status,
    };
  }

  if (isFileInspectionToolName(input.name)) {
    return {
      id: input.id,
      kind: 'fileRead',
      text: summary ? `${displayName}: ${summary}` : displayName,
      previewText: summary ? `${displayName}: ${summary}` : displayName,
      detailText: detailParts.join('\n'),
      status,
    };
  }

  if (isAgentToolName(input.name)) {
    const summaryText = summary || displayName;
    return {
      id: input.id,
      kind: 'agentToolCall',
      text: summaryText === displayName ? displayName : `${displayName}: ${summaryText}`,
      previewText: displayName,
      detailText: detailParts.join('\n'),
      status,
    };
  }

  if (isSkillToolName(input.name)) {
    const skill = isRecord(input.toolInput) ? stringValue(input.toolInput.skill) : null;
    const summaryText = skill
      ? `Skill: ${skill}`
      : summary
        ? `${displayName}: ${summary}`
        : displayName;
    return {
      id: input.id,
      kind: 'skillToolCall',
      text: summaryText,
      previewText: skill ?? displayName,
      detailText: detailParts.join('\n'),
      status,
    };
  }

  return {
    id: input.id,
    kind: 'toolCall',
    text: summary ? `${displayName}: ${summary}` : displayName,
    previewText: displayName,
    detailText: detailParts.join('\n'),
    status,
  };
}

function contentBlocks(message: unknown): unknown[] {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return [];
  }
  return message.content;
}

export function toolResultBlocks(message: unknown): Array<{ toolUseId: string; result: unknown }> {
  return contentBlocks(message)
    .map((block) => {
      if (!isRecord(block) || block.type !== 'tool_result') {
        return null;
      }
      const toolUseId = stringValue(block.tool_use_id);
      if (!toolUseId) {
        return null;
      }
      return {
        toolUseId,
        result: block.content,
      };
    })
    .filter((block): block is { toolUseId: string; result: unknown } => Boolean(block));
}

export function askUserQuestionToolUseIds(message: unknown): Set<string> {
  const ids = new Set<string>();
  for (const block of contentBlocks(message)) {
    if (!isRecord(block) || block.type !== 'tool_use') {
      continue;
    }
    const id = stringValue(block.id);
    const name = stringValue(block.name);
    if (id && name === 'AskUserQuestion') {
      ids.add(id);
    }
  }
  return ids;
}

export function suppressedClaudeToolUseIds(message: unknown): Set<string> {
  const ids = new Set<string>();
  for (const block of contentBlocks(message)) {
    if (!isRecord(block) || block.type !== 'tool_use') {
      continue;
    }
    const id = stringValue(block.id);
    const name = stringValue(block.name);
    if (id && name && isSuppressedClaudeToolName(name)) {
      ids.add(id);
    }
  }
  return ids;
}

export function shouldSuppressClaudeToolUse(toolName: string) {
  return isSuppressedClaudeToolName(toolName);
}

export function assistantMessageToHistoryItems(
  input: {
    messageId: string;
    message: unknown;
    skipTextBlockIds?: Set<string>;
  },
): AgentHistoryItem[] {
  const items: AgentHistoryItem[] = [];
  for (const [index, block] of contentBlocks(input.message).entries()) {
    if (!isRecord(block)) {
      continue;
    }
    const type = block.type;
    if (type === 'text') {
      const itemId = `${input.messageId}:content:${index}`;
      if (input.skipTextBlockIds?.has(itemId)) {
        continue;
      }
      const text = stringValue(block.text);
      if (text) {
        if (shouldSuppressAssistantText(text)) {
          continue;
        }
        items.push({
          id: itemId,
          kind: 'agentMessage',
          text,
        });
      }
      continue;
    }
    if (type === 'thinking') {
      const thinking = thinkingTextFromBlock(block);
      if (thinking) {
        items.push({
          id: `${input.messageId}:content:${index}`,
          kind: 'reasoning',
          text: thinking,
        });
      }
      continue;
    }
    if (type === 'tool_use') {
      const id = stringValue(block.id) ?? `${input.messageId}:tool:${index}`;
      const name = stringValue(block.name) ?? 'Tool';
      if (isSuppressedClaudeToolName(name)) {
        continue;
      }
      const item = toolUseToHistoryItem({
        id,
        name,
        toolInput: block.input,
        status: 'running',
      });
      if (item) {
        items.push(item);
      }
      continue;
    }
    if (type === 'mcp_tool_use') {
      const id = stringValue(block.id) ?? `${input.messageId}:mcp:${index}`;
      const name = stringValue(block.name) ?? 'MCP tool';
      const item = toolUseToHistoryItem({
        id,
        name,
        serverName: stringValue(block.server_name),
        toolInput: block.input,
        status: 'running',
      });
      if (item) {
        items.push(item);
      }
      continue;
    }
    if (type === 'server_tool_use') {
      const id = stringValue(block.id) ?? `${input.messageId}:server:${index}`;
      const name = stringValue(block.name) ?? 'Server tool';
      const item = toolUseToHistoryItem({
        id,
        name,
        toolInput: block.input,
        status: 'running',
      });
      if (item) {
        items.push(item);
      }
    }
  }
  return items;
}

export function partialTextDelta(input: {
  messageId: string;
  event: unknown;
}): { itemId: string; delta: string } | null {
  if (!isRecord(input.event)) {
    return null;
  }
  if (input.event.type === 'content_block_start') {
    const index = typeof input.event.index === 'number' ? input.event.index : 0;
    const block = input.event.content_block;
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string' || !block.text) {
      return null;
    }
    return {
      itemId: `${input.messageId}:content:${index}`,
      delta: block.text,
    };
  }
  if (input.event.type !== 'content_block_delta') {
    return null;
  }
  const index = typeof input.event.index === 'number' ? input.event.index : 0;
  const delta = input.event.delta;
  if (!isRecord(delta) || delta.type !== 'text_delta' || typeof delta.text !== 'string' || !delta.text) {
    return null;
  }
  return {
    itemId: `${input.messageId}:content:${index}`,
    delta: delta.text,
  };
}

export function partialReasoningDelta(input: {
  messageId: string;
  event: unknown;
}): AgentHistoryItem | null {
  if (!isRecord(input.event)) {
    return null;
  }
  const index = typeof input.event.index === 'number' ? input.event.index : 0;
  const itemId = `${input.messageId}:content:${index}`;

  if (input.event.type === 'content_block_start') {
    const block = input.event.content_block;
    if (!isRecord(block) || block.type !== 'thinking') {
      return null;
    }
    const text = thinkingTextFromBlock(block) ?? '';
    return {
      id: itemId,
      kind: 'reasoning',
      text,
      status: 'running',
    };
  }

  if (input.event.type !== 'content_block_delta') {
    return null;
  }

  const delta = input.event.delta;
  if (!isRecord(delta) || delta.type !== 'thinking_delta') {
    return null;
  }
  const text = stringValue(delta.thinking) ?? stringValue(delta.text);
  if (!text) {
    return null;
  }

  return {
    id: itemId,
    kind: 'reasoning',
    text,
    status: 'running',
  };
}

export function toolUseFromPartialStart(input: {
  messageId: string;
  event: unknown;
}): AgentHistoryItem | null {
  if (!isRecord(input.event) || input.event.type !== 'content_block_start') {
    return null;
  }
  const index = typeof input.event.index === 'number' ? input.event.index : 0;
  const block = input.event.content_block;
  if (!isRecord(block)) {
    return null;
  }
  if (block.type === 'tool_use') {
    const name = stringValue(block.name) ?? 'Tool';
    if (isSuppressedClaudeToolName(name)) {
      return null;
    }
    return toolUseToHistoryItem({
      id: stringValue(block.id) ?? `${input.messageId}:tool:${index}`,
      name,
      toolInput: block.input,
      status: 'running',
    });
  }
  if (block.type === 'mcp_tool_use') {
    return toolUseToHistoryItem({
      id: stringValue(block.id) ?? `${input.messageId}:mcp:${index}`,
      name: stringValue(block.name) ?? 'MCP tool',
      serverName: stringValue(block.server_name),
      toolInput: block.input,
      status: 'running',
    });
  }
  if (block.type === 'server_tool_use') {
    return toolUseToHistoryItem({
      id: stringValue(block.id) ?? `${input.messageId}:server:${index}`,
      name: stringValue(block.name) ?? 'Server tool',
      toolInput: block.input,
      status: 'running',
    });
  }
  return null;
}

export function resultForToolUse(
  input: {
    toolUseId: string;
    result: unknown;
    previous?: AgentHistoryItem | null;
  },
): AgentHistoryItem {
  if (input.previous) {
    if (input.previous.kind === 'plan') {
      const plan = isRecord(input.result) ? stringValue(input.result.plan) : null;
      const nextItem: AgentHistoryItem = {
        ...input.previous,
        text: plan ?? input.previous.text,
        status: 'completed',
      };
      if (input.previous.detailText !== undefined) {
        nextItem.detailText = input.previous.detailText;
      }
      return nextItem;
    }

    return {
      ...input.previous,
      detailText: [
        input.previous.detailText?.trim() || input.previous.text,
        '',
        'Result:',
        compactJson(input.result),
      ].join('\n'),
      status: 'completed',
    };
  }

  return {
    id: input.toolUseId,
    kind: 'toolCall',
    text: 'Tool result',
    previewText: 'Tool result',
    detailText: compactJson(input.result),
    status: 'completed',
  };
}

export function buildAgentTurn(input: {
  providerTurnId: string;
  startedAt?: string | null;
  status: AgentTurn['status'];
  error?: string | null;
  items: AgentHistoryItem[];
  rawTurn?: unknown;
}): AgentTurn {
  const turn: AgentTurn = {
    providerTurnId: input.providerTurnId,
    startedAt: input.startedAt ?? null,
    status: input.status,
    error: input.error ? { message: input.error } : null,
    items: input.items,
  };
  if (input.rawTurn !== undefined) {
    turn.rawTurn = input.rawTurn;
  }
  return turn;
}
