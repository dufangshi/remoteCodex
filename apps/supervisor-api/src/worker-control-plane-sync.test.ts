import { describe, expect, it, vi } from 'vitest';

import { loadRuntimeConfig } from '../../../packages/config/src/index';
import {
  WorkerControlPlaneSyncClient,
  WorkerControlPlaneSyncError,
} from './worker-control-plane-sync';

function workerConfig() {
  return loadRuntimeConfig({
    NODE_ENV: 'test',
    REMOTE_CODEX_RUNTIME_ROLE: 'worker',
    REMOTE_CODEX_SANDBOX_ID: '00000000-0000-4000-8000-000000000002',
    REMOTE_CODEX_USER_ID: '00000000-0000-4000-8000-000000000001',
    REMOTE_CODEX_CONTROL_PLANE_BASE_URL: 'https://control-plane.example.com',
    REMOTE_CODEX_CONTROL_PLANE_SERVICE_TOKEN: 'control-plane-service-token',
  });
}

describe('WorkerControlPlaneSyncClient', () => {
  it('sends session checkpoints to the control plane with worker identity', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        session: {
          id: '00000000-0000-4000-8000-000000000003',
          userId: '00000000-0000-4000-8000-000000000001',
          sandboxId: '00000000-0000-4000-8000-000000000002',
          workerSessionId: 'worker-session-1',
          status: 'active',
          lastActivityAt: '2026-05-25T00:00:00.000Z',
        },
      })
    );
    const client = new WorkerControlPlaneSyncClient(workerConfig(), { fetchImpl });

    const result = await client.checkpointSession({
      sessionId: '00000000-0000-4000-8000-000000000003',
      workerSessionId: 'worker-session-1',
      status: 'active',
    });

    expect(result.session.workerSessionId).toBe('worker-session-1');
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('/api/internal/sessions/00000000-0000-4000-8000-000000000003/checkpoint', 'https://control-plane.example.com'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-remote-codex-service-token': 'control-plane-service-token',
        },
        body: JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000001',
          sandboxId: '00000000-0000-4000-8000-000000000002',
          workerSessionId: 'worker-session-1',
          status: 'active',
        }),
      }),
    );
  });

  it('retries transient checkpoint failures with bounded attempts', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code: 'temporary' }, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          session: {
            id: '00000000-0000-4000-8000-000000000003',
            userId: '00000000-0000-4000-8000-000000000001',
            sandboxId: '00000000-0000-4000-8000-000000000002',
            workerSessionId: 'worker-session-1',
            status: 'active',
            lastActivityAt: '2026-05-25T00:00:00.000Z',
          },
        }),
      );
    const client = new WorkerControlPlaneSyncClient(workerConfig(), {
      fetchImpl,
      maxAttempts: 2,
      initialBackoffMs: 0,
    });

    await expect(
      client.checkpointSession({
        sessionId: '00000000-0000-4000-8000-000000000003',
        workerSessionId: 'worker-session-1',
      }),
    ).resolves.toMatchObject({
      session: {
        workerSessionId: 'worker-session-1',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent checkpoint denials', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ code: 'wrong_sandbox' }, { status: 403 }),
    );
    const client = new WorkerControlPlaneSyncClient(workerConfig(), {
      fetchImpl,
      maxAttempts: 3,
      initialBackoffMs: 0,
    });

    await expect(
      client.checkpointSession({
        sessionId: '00000000-0000-4000-8000-000000000003',
      }),
    ).rejects.toMatchObject({
      code: 'checkpoint_rejected',
      statusCode: 403,
    } satisfies Partial<WorkerControlPlaneSyncError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('records worker-local Harness usage events with worker identity', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        harnessUsageEvent: {
          id: 'usage-1',
          userId: '00000000-0000-4000-8000-000000000001',
          sandboxId: '00000000-0000-4000-8000-000000000002',
          workspaceId: '00000000-0000-4000-8000-000000000004',
          sessionId: '00000000-0000-4000-8000-000000000005',
          provider: 'elagente-harness',
          module: 'farmaco',
          tool: 'dock',
          runId: 'run-1',
          jobId: 'job-1',
          externalEventId: 'run-1',
          computeUnits: 2,
          costUsd: 0.25,
          status: 'ok',
          metadataJson: '{}',
          occurredAt: '2026-06-03T00:00:00.000Z',
          importedAt: '2026-06-03T00:00:00.000Z',
        },
      }),
    );
    const client = new WorkerControlPlaneSyncClient(workerConfig(), { fetchImpl });

    const result = await client.recordHarnessUsageEvent({
      workspaceId: '00000000-0000-4000-8000-000000000004',
      sessionId: '00000000-0000-4000-8000-000000000005',
      threadId: 'thread-1',
      turnId: 'turn-1',
      module: 'farmaco',
      tool: 'dock',
      runId: 'run-1',
      jobId: 'job-1',
      externalEventId: 'run-1',
      computeUnits: 2,
      costUsd: 0.25,
      status: 'ok',
      metadata: { resultStatus: 'ok' },
    });

    expect(result.harnessUsageEvent.externalEventId).toBe('run-1');
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('/api/internal/harness/usage-events', 'https://control-plane.example.com'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-remote-codex-service-token': 'control-plane-service-token',
        },
        body: JSON.stringify({
          workspaceId: '00000000-0000-4000-8000-000000000004',
          sessionId: '00000000-0000-4000-8000-000000000005',
          threadId: 'thread-1',
          turnId: 'turn-1',
          module: 'farmaco',
          tool: 'dock',
          runId: 'run-1',
          jobId: 'job-1',
          externalEventId: 'run-1',
          computeUnits: 2,
          costUsd: 0.25,
          status: 'ok',
          metadata: { resultStatus: 'ok' },
          userId: '00000000-0000-4000-8000-000000000001',
          sandboxId: '00000000-0000-4000-8000-000000000002',
        }),
      }),
    );
  });

  it('checks Harness quota with worker identity before invocation', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        allowed: false,
        denial: {
          reason: 'harness_spend_quota_exceeded',
          quotaProfile: 'developer',
          limit: 50,
          used: 49,
        },
      }),
    );
    const client = new WorkerControlPlaneSyncClient(workerConfig(), { fetchImpl });

    const result = await client.checkHarnessQuota({
      workspaceId: '00000000-0000-4000-8000-000000000004',
      sessionId: '00000000-0000-4000-8000-000000000005',
      module: 'farmaco',
      tool: 'dock',
      estimatedCostUsd: 2,
    });

    expect(result.allowed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('/api/internal/harness/quota/check', 'https://control-plane.example.com'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          workspaceId: '00000000-0000-4000-8000-000000000004',
          sessionId: '00000000-0000-4000-8000-000000000005',
          module: 'farmaco',
          tool: 'dock',
          estimatedCostUsd: 2,
          userId: '00000000-0000-4000-8000-000000000001',
          sandboxId: '00000000-0000-4000-8000-000000000002',
        }),
      }),
    );
  });
});
