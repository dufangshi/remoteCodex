import { describe, expect, it } from 'vitest';

import { AgentRuntimeError } from '../../../../packages/agent-runtime/src/index';
import { JsonRpcClientError } from '../../../../packages/codex/src/index';
import {
  isCodexRuntimeRequestError,
  isRemoteThreadBootstrapError,
  isUnsupportedHooksListError,
  parseTurnSteerRace,
  unwrapCodexJsonRpcError,
} from './runtime-errors';

describe('codex runtime error helpers', () => {
  it('unwraps Codex JSON-RPC errors from runtime errors', () => {
    const cause = new JsonRpcClientError('method not found', 'remote_error', { code: -32601 });
    const error = new AgentRuntimeError('method not found', 'codex', 'remote_error', {}, cause);

    expect(unwrapCodexJsonRpcError(error)).toBe(cause);
    expect(isCodexRuntimeRequestError(error)).toBe(true);
  });

  it('classifies Codex remote errors used by ThreadService fallback paths', () => {
    expect(
      isRemoteThreadBootstrapError(
        new AgentRuntimeError(
          'failed to load rollout: rollout at /tmp/demo.jsonl is empty',
          'codex',
          'remote_error',
          {},
          new JsonRpcClientError(
            'failed to load rollout: rollout at /tmp/demo.jsonl is empty',
            'remote_error',
          ),
        ),
      ),
    ).toBe(true);

    expect(
      isUnsupportedHooksListError(
        new AgentRuntimeError(
          'endpoint not found: hooks/list',
          'codex',
          'remote_error',
          {},
          new JsonRpcClientError('endpoint not found: hooks/list', 'remote_error', {
            code: -32601,
          }),
        ),
      ),
    ).toBe(true);
  });

  it('parses Codex steer races from wrapped runtime errors', () => {
    expect(
      parseTurnSteerRace(
        new AgentRuntimeError(
          'expected active turn id `turn-old` but found `turn-new`',
          'codex',
          'remote_error',
          {},
          new JsonRpcClientError(
            'expected active turn id `turn-old` but found `turn-new`',
            'remote_error',
          ),
        ),
      ),
    ).toEqual({
      type: 'turnIdMismatch',
      actualTurnId: 'turn-new',
    });
  });
});
