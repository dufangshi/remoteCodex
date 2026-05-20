import { describe, expect, it } from 'vitest';

import type { AgentProviderRequest } from '../../agent-runtime/src/index';

import {
  buildCodexProviderRequestResponse,
  mapCodexProviderRequest,
} from './requestMapper';

describe('Codex provider request mapping', () => {
  it('auto-approves command approval requests in yolo mode', () => {
    const request: AgentProviderRequest = {
      provider: 'codex',
      id: 7,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        command: 'pnpm test',
      },
    };

    expect(mapCodexProviderRequest(request, 'yolo')).toEqual({
      providerRequestId: 7,
      providerSessionId: 'thread-1',
      autoApprovedResult: { decision: 'accept' },
      pendingRequest: null,
    });
  });

  it('maps guarded command approval requests to pending action requests', () => {
    const request: AgentProviderRequest = {
      provider: 'codex',
      id: 8,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-2',
        turnId: 'turn-2',
        itemId: 'item-1',
        command: ['pnpm', 'test'],
        cwd: '/repo',
        reason: 'Needs to verify changes.',
      },
    };

    const mapped = mapCodexProviderRequest(request, 'guarded');

    expect(mapped?.providerSessionId).toBe('thread-2');
    expect(mapped?.autoApprovedResult).toBeNull();
    expect(mapped?.pendingRequest?.providerRequestId).toBe(8);
    expect(mapped?.pendingRequest?.responseKind).toBe('commandExecutionApproval');
    expect(mapped?.pendingRequest?.request).toMatchObject({
      id: '8',
      kind: 'requestUserInput',
      title: 'Command approval required',
      turnId: 'turn-2',
      itemId: 'item-1',
    });
    expect(mapped?.pendingRequest?.request.description).toContain('Needs to verify changes.');
    expect(mapped?.pendingRequest?.request.description).toContain('Command: pnpm test');
    expect(mapped?.pendingRequest?.request.description).toContain('CWD: /repo');
  });

  it('maps generic user-input requests and auto-approves recommended allow answers in yolo mode', () => {
    const request: AgentProviderRequest = {
      provider: 'codex',
      id: 9,
      method: 'requestUserInput',
      params: {
        threadId: 'thread-3',
        turnId: 'turn-3',
        questions: [
          {
            id: 'approval',
            header: 'Tool approval',
            question: 'Allow tool use?',
            isOther: false,
            isSecret: false,
            options: [
              { label: 'Allow (Recommended)', description: 'Continue.' },
              { label: 'Deny', description: 'Stop.' },
            ],
          },
        ],
      },
    };

    expect(mapCodexProviderRequest(request, 'yolo')).toEqual({
      providerRequestId: 9,
      providerSessionId: 'thread-3',
      autoApprovedResult: {
        answers: {
          approval: {
            answers: ['Allow (Recommended)'],
          },
        },
      },
      pendingRequest: null,
    });
  });

  it('builds interactive approval responses from pending request answers', () => {
    const pending = mapCodexProviderRequest(
      {
        provider: 'codex',
        id: 10,
        method: 'item/fileChange/requestApproval',
        params: {
          threadId: 'thread-4',
          turnId: 'turn-4',
        },
      },
      'guarded',
    )?.pendingRequest;

    expect(pending).toBeTruthy();
    expect(
      buildCodexProviderRequestResponse(pending!, {
        answers: {
          approval: {
            answers: ['Deny'],
          },
        },
      }),
    ).toEqual({ decision: 'decline' });
  });
});
