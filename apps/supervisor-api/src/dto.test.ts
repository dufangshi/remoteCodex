import { describe, expect, it } from 'vitest';

import type { AgentSessionDetail } from '../../../packages/agent-runtime/src/index';
import { buildThreadPatch } from './dto';

describe('buildThreadPatch', () => {
  it('keeps the thread failed when the latest provider turn failed', () => {
    const patch = buildThreadPatch(
      {
        provider: 'claude',
        providerSessionId: 'provider-session-1',
        cwd: '/tmp/workspace',
        title: 'Demo',
        preview: 'Preview',
        createdAt: '2026-06-07T00:00:00.000Z',
        updatedAt: '2026-06-07T00:00:30.000Z',
        status: 'idle',
        totalTurnCount: 1,
        turns: [
          {
            providerTurnId: 'turn-1',
            startedAt: '2026-06-07T00:00:00.000Z',
            status: 'failed',
            error: { message: 'Missing API key' },
            items: [],
          },
        ],
      } satisfies AgentSessionDetail,
      'gpt-5',
      'medium',
    );

    expect(patch).toMatchObject({
      status: 'failed',
      lastError: 'Missing API key',
    });
  });
});
