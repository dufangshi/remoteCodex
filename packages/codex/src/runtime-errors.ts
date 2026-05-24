import {
  AgentRuntimeError,
  isRemoteThreadBootstrapError,
  isRuntimeRequestError,
  isUnsupportedHooksListError,
  parseTurnSteerRace,
  TurnSteerRace,
} from '../../agent-runtime/src/index';
import { JsonRpcClientError } from './jsonrpc';

export type CodexTurnSteerRace = TurnSteerRace;
export {
  isRemoteThreadBootstrapError,
  isUnsupportedHooksListError,
  parseTurnSteerRace,
};

export function unwrapCodexJsonRpcError(error: unknown): JsonRpcClientError | null {
  if (error instanceof JsonRpcClientError) {
    return error;
  }

  if (error instanceof AgentRuntimeError && error.provider === 'codex') {
    return error.cause instanceof JsonRpcClientError ? error.cause : null;
  }

  return null;
}

export function isCodexRuntimeRequestError(error: unknown) {
  return Boolean(unwrapCodexJsonRpcError(error)) || isRuntimeRequestError(error);
}
