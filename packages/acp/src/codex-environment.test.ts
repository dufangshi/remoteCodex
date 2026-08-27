import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCodexAcpEnvironment } from './codex-environment';

describe('loadCodexAcpEnvironment', () => {
  it('passes the parsed user config to codex-acp without hard-coding context limits', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-acp-home-'));
    try {
      await fs.writeFile(
        path.join(codexHome, 'config.toml'),
        [
          'model = "gpt-5.6-sol"',
          'model_context_window = 1000000',
          'model_auto_compact_token_limit = 900000',
          '',
          '[features]',
          'goals = true',
        ].join('\n'),
      );

      const env = await loadCodexAcpEnvironment(codexHome, {});
      expect(env?.CODEX_PATH).toBe('codex');
      expect(env?.CODEX_HOME).toBe(codexHome);
      expect(JSON.parse(env?.CODEX_CONFIG ?? '{}')).toEqual({
        model: 'gpt-5.6-sol',
        model_context_window: 1_000_000,
        model_auto_compact_token_limit: 900_000,
        features: { goals: true },
      });
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('preserves an explicitly supplied CODEX_CONFIG', async () => {
    const env = await loadCodexAcpEnvironment('/tmp/codex-home', {
      CODEX_CONFIG: '{"model_context_window":516000}',
    });

    expect(env).toEqual({
      CODEX_PATH: 'codex',
      CODEX_HOME: '/tmp/codex-home',
      CODEX_CONFIG: '{"model_context_window":516000}',
    });
  });

  it('prefers an explicitly configured Codex executable', async () => {
    const env = await loadCodexAcpEnvironment(null, {
      CODEX_PATH: '/opt/codex/bin/codex',
    });

    expect(env).toEqual({ CODEX_PATH: '/opt/codex/bin/codex' });
  });
});
