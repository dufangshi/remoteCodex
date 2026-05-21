import type {
  AgentHistoryItem,
  AgentTurn,
} from '../../agent-runtime/src/index';

const CLAUDE_TOOL_LABELS: Record<string, string> = {
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
  TodoWrite: 'Update todos',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
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

  const command = commandFromInput(input);
  if (command) {
    return command;
  }

  const filePath = pathFromInput(input);
  if (filePath) {
    return filePath;
  }

  const query = stringValue(input.query) ?? stringValue(input.url);
  if (query) {
    return query;
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

export function userMessageToHistoryItem(id: string, message: unknown): AgentHistoryItem {
  return {
    id,
    kind: 'userMessage',
    text: messageContentText(message),
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
): AgentHistoryItem {
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

  if (
    input.name === 'WebSearch' ||
    input.name === 'WebFetch' ||
    input.name === 'web_search' ||
    input.name === 'web_fetch'
  ) {
    return {
      id: input.id,
      kind: 'webSearch',
      text: summary || displayName,
      previewText: summary || displayName,
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
        items.push({
          id: itemId,
          kind: 'agentMessage',
          text,
        });
      }
      continue;
    }
    if (type === 'thinking') {
      const thinking = stringValue(block.thinking);
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
      items.push(toolUseToHistoryItem({
        id,
        name,
        toolInput: block.input,
        status: 'running',
      }));
      continue;
    }
    if (type === 'mcp_tool_use') {
      const id = stringValue(block.id) ?? `${input.messageId}:mcp:${index}`;
      const name = stringValue(block.name) ?? 'MCP tool';
      items.push(toolUseToHistoryItem({
        id,
        name,
        serverName: stringValue(block.server_name),
        toolInput: block.input,
        status: 'running',
      }));
      continue;
    }
    if (type === 'server_tool_use') {
      const id = stringValue(block.id) ?? `${input.messageId}:server:${index}`;
      const name = stringValue(block.name) ?? 'Server tool';
      items.push(toolUseToHistoryItem({
        id,
        name,
        toolInput: block.input,
        status: 'running',
      }));
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
    return toolUseToHistoryItem({
      id: stringValue(block.id) ?? `${input.messageId}:tool:${index}`,
      name: stringValue(block.name) ?? 'Tool',
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
  status: AgentTurn['status'];
  error?: string | null;
  items: AgentHistoryItem[];
  rawTurn?: unknown;
}): AgentTurn {
  const turn: AgentTurn = {
    providerTurnId: input.providerTurnId,
    status: input.status,
    error: input.error ? { message: input.error } : null,
    items: input.items,
  };
  if (input.rawTurn !== undefined) {
    turn.rawTurn = input.rawTurn;
  }
  return turn;
}
