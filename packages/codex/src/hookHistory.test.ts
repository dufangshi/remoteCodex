import { describe, expect, it } from 'vitest';

import {
  codexHookRunToHistoryItem,
  parseCodexHookPromptText,
} from './index';

describe('codex hook history mapping', () => {
  it('parses hook prompt XML emitted as assistant text', () => {
    expect(
      parseCodexHookPromptText(
        '<hook_prompt hook_run_id="stop:0:/tmp/demo/.codex/hooks.json">remote-codex hook ran</hook_prompt>',
      ),
    ).toMatchObject({
      hookRunId: 'stop:0:/tmp/demo/.codex/hooks.json',
      output: 'remote-codex hook ran',
      eventName: 'stop',
      eventLabel: 'Stop',
      sourcePath: '/tmp/demo/.codex/hooks.json',
      outputEntries: [{ kind: 'warning', text: 'remote-codex hook ran' }],
    });
  });

  it('maps Codex hook runs into provider-neutral history items', () => {
    expect(
      codexHookRunToHistoryItem({
        id: 'run-1',
        eventName: 'preToolUse',
        handlerType: 'command',
        executionMode: 'blocking',
        scope: 'project',
        sourcePath: '/tmp/demo/.codex/hooks.json',
        source: 'project',
        status: 'completed',
        statusMessage: 'Checking Bash',
        durationMs: 42,
        outputEntries: [{ kind: 'context', text: 'allowed' }],
        stderr: 'diagnostic',
      }),
    ).toMatchObject({
      id: 'hook:run-1',
      kind: 'hook',
      text: 'PreToolUse hook',
      previewText: 'Checking Bash',
      status: 'Completed',
      hookEventName: 'preToolUse',
      hookEventLabel: 'PreToolUse',
      hookHandlerType: 'command',
      hookScope: 'project',
      hookSource: 'project',
      hookSourcePath: '/tmp/demo/.codex/hooks.json',
      hookStatusMessage: 'Checking Bash',
      hookOutputEntries: [
        { kind: 'context', text: 'allowed' },
        { kind: 'warning', text: 'diagnostic' },
      ],
    });
  });
});
