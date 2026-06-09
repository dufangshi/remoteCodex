export type GraphChatToolStatus = 'pending' | 'completed' | 'failed';

export type GraphChatToolResultState = {
  finalResult: unknown;
  stdout: string;
  stderr: string;
};

export type GraphChatToolMergedPayload = {
  call: { tool?: unknown; args?: unknown; call_id?: unknown };
  result?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function reconstructGraphChatToolArgs(args: unknown): unknown {
  if (!args) {
    return {};
  }

  if (isRecord(args) && Object.prototype.hasOwnProperty.call(args, '0')) {
    try {
      const reconstructedString = Object.keys(args)
        .map(Number)
        .filter((key) => Number.isFinite(key))
        .sort((left, right) => left - right)
        .map((key) => String(args[String(key)] ?? ''))
        .join('');

      return JSON.parse(reconstructedString);
    } catch {
      return args;
    }
  }

  if (typeof args === 'string') {
    try {
      return JSON.parse(args);
    } catch {
      return args;
    }
  }

  return args;
}

export function createEmptyGraphChatToolResultState(): GraphChatToolResultState {
  return {
    finalResult: null,
    stdout: '',
    stderr: '',
  };
}

function normalizeToolResult(result: unknown) {
  return typeof result === 'string' ? { result } : result;
}

export function mergeGraphChatToolResultState(
  state: GraphChatToolResultState,
): Record<string, unknown> {
  const merged: Record<string, unknown> = isRecord(state.finalResult)
    ? { ...state.finalResult }
    : state.finalResult != null
      ? { result: state.finalResult }
      : {};

  if (state.stdout) {
    merged.stdout = state.stdout;
  }
  if (state.stderr) {
    merged.stderr = state.stderr;
  }

  if (!('status' in merged) && (state.stdout || state.stderr)) {
    merged.status = 'pending';
  }

  return merged;
}

export function getGraphChatToolUiStatus(result: unknown): GraphChatToolStatus {
  if (!result) {
    return 'pending';
  }

  if (!isRecord(result)) {
    return 'completed';
  }

  const status = result.status;
  if (status === 'stream' || status === 'pending' || status === 'running') {
    return 'pending';
  }
  if (status === 'failed' || status === 'error' || status === 'timed_out') {
    return 'failed';
  }
  if (typeof result.exit_code === 'number' && result.exit_code !== 0) {
    return 'failed';
  }
  return 'completed';
}

export function preprocessGraphChatToolBlocks(content: string): {
  processedContent: string;
  resultMap: Map<string, GraphChatToolResultState>;
} {
  const resultMap = new Map<string, GraphChatToolResultState>();
  const resultRegex = /```tool-result\s*([\s\S]*?)\s*```/g;

  const contentWithoutOrphanedResults = content.replace(
    resultRegex,
    (fullMatch, jsonContent: string) => {
      try {
        const data = JSON.parse(jsonContent) as Record<string, unknown>;
        const callId = data.call_id;
        if (typeof callId !== 'string') {
          return fullMatch;
        }

        const normalizedResult = normalizeToolResult(data.result);
        const state =
          resultMap.get(callId) ?? createEmptyGraphChatToolResultState();

        if (
          isRecord(normalizedResult) &&
          normalizedResult.status === 'stream' &&
          typeof normalizedResult.chunk === 'string'
        ) {
          if (normalizedResult.stream === 'stderr') {
            state.stderr += normalizedResult.chunk;
          } else {
            state.stdout += normalizedResult.chunk;
          }
        } else {
          state.finalResult = normalizedResult;
        }

        resultMap.set(callId, state);
        return '';
      } catch {
        return fullMatch;
      }
    },
  );

  const callRegex = /```tool-call\s*([\s\S]*?)\s*```/g;
  const processedContent = contentWithoutOrphanedResults.replace(
    callRegex,
    (fullMatch, jsonContent: string) => {
      try {
        const data = JSON.parse(jsonContent) as Record<string, unknown>;
        const callId = data.call_id;
        const tool = data.tool;

        if (typeof tool !== 'string') {
          return fullMatch;
        }

        const args = reconstructGraphChatToolArgs(data.args);
        if (typeof callId === 'string' && resultMap.has(callId)) {
          const resultData = mergeGraphChatToolResultState(
            resultMap.get(callId) ?? createEmptyGraphChatToolResultState(),
          );
          const mergedPayload = JSON.stringify(
            {
              call: { tool, args, call_id: callId },
              result: resultData,
            },
            null,
            2,
          );

          return `\`\`\`tool-merged\n${mergedPayload}\n\`\`\``;
        }

        return fullMatch;
      } catch {
        return fullMatch;
      }
    },
  );

  return { processedContent, resultMap };
}
