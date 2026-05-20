import { AgentRuntimeError } from '../../../../packages/agent-runtime/src/index';
import { JsonRpcClientError } from '../../../../packages/codex/src/index';

export type CodexTurnSteerRace =
  | { type: 'missing' }
  | { type: 'turnIdMismatch'; actualTurnId: string };

export function unwrapCodexJsonRpcError(error: unknown): JsonRpcClientError | null {
  if (error instanceof JsonRpcClientError) {
    return error;
  }

  if (error instanceof AgentRuntimeError && error.provider === 'codex') {
    return error.cause instanceof JsonRpcClientError ? error.cause : null;
  }

  return null;
}

function isCodexRemoteError(error: unknown) {
  const codexError = unwrapCodexJsonRpcError(error);
  return codexError?.code === 'remote_error' ? codexError : null;
}

export function isCodexRuntimeRequestError(error: unknown) {
  return Boolean(unwrapCodexJsonRpcError(error));
}

export function isRemoteThreadBootstrapError(error: unknown) {
  const codexError = isCodexRemoteError(error);
  if (!codexError) {
    return false;
  }

  return (
    codexError.message.includes('includeTurns is unavailable before first user message') ||
    codexError.message.includes('is not materialized yet') ||
    codexError.message.includes('no rollout found for thread id') ||
    codexError.message.includes('failed to load rollout') ||
    (codexError.message.includes('rollout at') && codexError.message.includes('is empty'))
  );
}

export function isUnsupportedHooksListError(error: unknown) {
  const codexError = isCodexRemoteError(error);
  if (!codexError) {
    return false;
  }

  const remoteCode = codexError.details?.code;
  const message = codexError.message.toLowerCase();
  return (
    remoteCode === -32601 ||
    message.includes('endpoint not found') ||
    message.includes('method not found') ||
    (message.includes('hooks/list') && message.includes('not found'))
  );
}

export function parseTurnSteerRace(error: unknown): CodexTurnSteerRace | null {
  const codexError = isCodexRemoteError(error);
  if (!codexError) {
    return null;
  }

  if (codexError.message === 'no active turn to steer') {
    return { type: 'missing' };
  }

  const mismatchPrefix = 'expected active turn id `';
  const mismatchSeparator = '` but found `';
  if (!codexError.message.startsWith(mismatchPrefix)) {
    return null;
  }

  const actualTurnId = codexError.message
    .slice(mismatchPrefix.length)
    .split(mismatchSeparator)[1]
    ?.replace(/`$/, '');

  if (!actualTurnId) {
    return null;
  }

  return {
    type: 'turnIdMismatch',
    actualTurnId,
  };
}
