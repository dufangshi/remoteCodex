import { afterEach, describe, expect, it, vi } from 'vitest';

import { E2EFakeRuntime } from './e2e-fake-runtime';

describe('E2EFakeRuntime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the default iOS stream response for ordinary prompts', async () => {
    vi.useFakeTimers();
    const runtime = new E2EFakeRuntime();
    const session = await runtime.startSession({
      cwd: '/tmp/e2e',
      model: 'ios-e2e-stream',
      approvalMode: 'guarded',
      reasoningEffort: 'medium',
      sandboxMode: 'danger-full-access',
    });

    const turn = await runtime.startTurn({
      providerSessionId: session.providerSessionId,
      prompt: 'hello',
    });

    await vi.advanceTimersByTimeAsync(20_000);

    const updatedSession = await runtime.readSession(session.providerSessionId);
    const assistantItem = updatedSession.turns[0]?.items.find((item) => item.kind === 'agentMessage');
    expect(turn.status).toBe('completed');
    expect(assistantItem?.text).toBe('IOS_STREAM_DELTA_READY IOS_STREAM_COMPLETED');
  });

  it('echoes Android WebView sentinel prompts exactly', async () => {
    vi.useFakeTimers();
    const runtime = new E2EFakeRuntime();
    const session = await runtime.startSession({
      cwd: '/tmp/e2e',
      model: 'ios-e2e-stream',
      approvalMode: 'guarded',
      reasoningEffort: 'medium',
      sandboxMode: 'danger-full-access',
    });

    const turn = await runtime.startTurn({
      providerSessionId: session.providerSessionId,
      prompt: 'Reply with ANDROID_WEB_THREAD_SERVER_OK only.',
    });

    await vi.advanceTimersByTimeAsync(20_000);

    const updatedSession = await runtime.readSession(session.providerSessionId);
    const assistantItem = updatedSession.turns[0]?.items.find((item) => item.kind === 'agentMessage');
    expect(turn.status).toBe('completed');
    expect(assistantItem?.text).toBe('ANDROID_WEB_THREAD_SERVER_OK');
  });
});
