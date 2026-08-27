import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createDatabase,
  createThreadRecord,
  createWorkspaceRecord,
  getThreadTurnMetadataByThreadAndTurnId,
  runMigrations,
  seedDefaults,
} from '../../../packages/db/src/index';

import {
  ThreadUsageAccounting,
  buildThreadContextUsageFromPayload,
  buildTurnTokenBreakdown,
  mergeThreadContextUsageFromPayload,
  parseThreadTurnTokenUsageJson,
  shouldResetThreadContextUsageForTurnStart,
} from './thread-usage-accounting';

describe('buildThreadContextUsageFromPayload', () => {
  it('normalizes cache write tokens from GPT-5.6 usage payloads', () => {
    expect(
      buildTurnTokenBreakdown({
        total_tokens: 1_700,
        input_tokens: 1_500,
        input_tokens_details: {
          cached_tokens: 500,
          cache_write_tokens: 200,
        },
        output_tokens: 200,
        reasoning_output_tokens: 50,
      }),
    ).toEqual({
      totalTokens: 1_700,
      inputTokens: 1_500,
      cachedInputTokens: 500,
      cacheWriteInputTokens: 200,
      outputTokens: 200,
      reasoningOutputTokens: 50,
    });
  });

  it('persists an upstream context window that arrives before complete token usage', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-usage-'));
    const databasePath = path.join(tempDir, 'usage.sqlite');
    runMigrations(databasePath);
    const context = createDatabase(databasePath);

    try {
      seedDefaults(context.db);
      const workspace = createWorkspaceRecord(context.db, {
        absPath: path.join(tempDir, 'workspace'),
        label: 'Usage workspace',
      });
      const thread = createThreadRecord(context.db, {
        workspaceId: workspace.id,
        provider: 'acp',
        agentId: 'codex',
        providerSessionId: 'codex::context-session',
        title: 'Context window persistence',
        model: 'gpt-5.6-sol',
        approvalMode: 'yolo',
      });
      const accounting = new ThreadUsageAccounting(context.db);

      expect(accounting.updateTurnUsage({
        localThreadId: thread.id,
        turnId: 'turn-1',
        tokenUsage: {
          last: { totalTokens: 21_346 },
          modelContextWindow: 258_400,
        },
      })).toBeNull();

      const partialRecord = getThreadTurnMetadataByThreadAndTurnId(
        context.db,
        thread.id,
        'turn-1',
      );
      expect(JSON.parse(partialRecord?.tokenUsageJson ?? '{}')).toMatchObject({
        modelContextWindow: 258_400,
      });

      accounting.updateTurnUsage({
        localThreadId: thread.id,
        turnId: 'turn-1',
        tokenUsage: {
          total: {
            totalTokens: 21_346,
            inputTokens: 17_497,
            cachedInputTokens: 3_840,
            outputTokens: 9,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 21_346,
            inputTokens: 17_497,
            cachedInputTokens: 3_840,
            outputTokens: 9,
            reasoningOutputTokens: 0,
          },
        },
      });

      const completedRecord = getThreadTurnMetadataByThreadAndTurnId(
        context.db,
        thread.id,
        'turn-1',
      );
      expect(parseThreadTurnTokenUsageJson(completedRecord?.tokenUsageJson)).toMatchObject({
        modelContextWindow: 258_400,
        last: { totalTokens: 21_346 },
      });

      const reloadedAccounting = new ThreadUsageAccounting(context.db);
      expect(reloadedAccounting.getThreadContextUsage(thread.id)).toMatchObject({
        availability: 'available',
        tokensInContextWindow: 21_346,
        modelContextWindow: 258_400,
      });
    } finally {
      context.sqlite.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('prefers the runtime context window over local model pricing metadata', () => {
    const usage = buildThreadContextUsageFromPayload(
      {
        last: {
          totalTokens: 500000,
          inputTokens: 495000,
          cachedInputTokens: 0,
          outputTokens: 5000,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: 1000000,
      },
      'claude-sonnet-4-5',
      '2026-05-22T00:00:00.000Z',
    );

    expect(usage).toEqual({
      availability: 'available',
      remainingPercent: 50,
      tokensInContextWindow: 500000,
      modelContextWindow: 1000000,
      updatedAt: '2026-05-22T00:00:00.000Z',
    });
  });

  it('uses the effective Codex subscription GPT-5.6 window when runtime usage omits it', () => {
    const usage = buildThreadContextUsageFromPayload(
      {
        last: {
          totalTokens: 182_700,
          inputTokens: 175_700,
          cachedInputTokens: 0,
          outputTokens: 7_000,
          reasoningOutputTokens: 0,
        },
      },
      'gpt-5.6-sol',
      '2026-07-09T00:00:00.000Z',
    );

    expect(usage).toEqual({
      availability: 'available',
      remainingPercent: 48,
      tokensInContextWindow: 182_700,
      modelContextWindow: 353_400,
      updatedAt: '2026-07-09T00:00:00.000Z',
    });
  });

  it('keeps an existing available estimate when a partial live update cannot compute context', () => {
    const current = {
      availability: 'available' as const,
      remainingPercent: 38,
      tokensInContextWindow: 165200,
      modelContextWindow: 258400,
      updatedAt: '2026-05-22T00:00:00.000Z',
    };

    expect(
      mergeThreadContextUsageFromPayload(
        current,
        {
          total: {
            totalTokens: 166000,
            inputTokens: 140800,
            cachedInputTokens: 0,
            outputTokens: 25200,
            reasoningOutputTokens: 0,
          },
        },
        'unknown-model',
        '2026-05-22T00:01:00.000Z',
      ),
    ).toEqual(current);
  });

  it('keeps an upstream window when final token usage omits the window size', () => {
    const current = {
      availability: 'available' as const,
      remainingPercent: 96,
      tokensInContextWindow: 20_000,
      modelContextWindow: 258_400,
      updatedAt: '2026-08-27T00:00:00.000Z',
    };

    expect(
      mergeThreadContextUsageFromPayload(
        current,
        {
          total: {
            totalTokens: 20_542,
            inputTokens: 16_693,
            cachedInputTokens: 3_840,
            outputTokens: 9,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 20_542,
            inputTokens: 16_693,
            cachedInputTokens: 3_840,
            outputTokens: 9,
            reasoningOutputTokens: 0,
          },
        },
        'gpt-5.6-sol',
        '2026-08-27T00:01:00.000Z',
      ),
    ).toEqual({
      availability: 'available',
      remainingPercent: 92,
      tokensInContextWindow: 20_542,
      modelContextWindow: 258_400,
      updatedAt: '2026-08-27T00:01:00.000Z',
    });
  });

  it('only resets context display on turn start when no available estimate exists', () => {
    expect(
      shouldResetThreadContextUsageForTurnStart({
        availability: 'available',
        remainingPercent: 38,
        tokensInContextWindow: 165200,
        modelContextWindow: 258400,
        updatedAt: '2026-05-22T00:00:00.000Z',
      }),
    ).toBe(false);

    expect(
      shouldResetThreadContextUsageForTurnStart({
        availability: 'unavailable',
        remainingPercent: null,
        tokensInContextWindow: null,
        modelContextWindow: null,
        updatedAt: null,
      }),
    ).toBe(true);
  });
});
