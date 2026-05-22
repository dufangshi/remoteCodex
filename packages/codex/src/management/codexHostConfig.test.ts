import { describe, expect, it } from 'vitest';

import {
  isCodexFeatureEnabledFromConfig,
  upsertCodexFeatureFlag,
  upsertCodexServiceTier,
} from './codexHostConfig';

describe('codexHostConfig', () => {
  it('adds service_tier = "fast" when enabling fast mode', () => {
    expect(upsertCodexServiceTier('model = "gpt-5.4"\n', true)).toBe(
      'model = "gpt-5.4"\nservice_tier = "fast"\n',
    );
  });

  it('inserts service_tier before the first section when enabling fast mode', () => {
    expect(
      upsertCodexServiceTier(
        'model = "gpt-5.4"\n\n[projects."/tmp/example"]\ntrust_level = "trusted"\n',
        true,
      ),
    ).toBe(
      'model = "gpt-5.4"\nservice_tier = "fast"\n[projects."/tmp/example"]\ntrust_level = "trusted"\n',
    );
  });

  it('removes service_tier when disabling fast mode', () => {
    expect(
      upsertCodexServiceTier(
        'model = "gpt-5.4"\nservice_tier = "fast"\napproval_policy = "never"\n',
        false,
      ),
    ).toBe('model = "gpt-5.4"\napproval_policy = "never"\n');
  });

  it('removes unsupported legacy flex values when disabling fast mode', () => {
    expect(
      upsertCodexServiceTier('service_tier = "flex"\nmodel = "gpt-5.4"\n', false),
    ).toBe('model = "gpt-5.4"\n');
  });

  it('writes only the fast line when enabling into an empty config', () => {
    expect(upsertCodexServiceTier('', true)).toBe('service_tier = "fast"\n');
  });

  it('clears the file when disabling and service_tier is the only entry', () => {
    expect(upsertCodexServiceTier('service_tier = "fast"\n', false)).toBe('');
  });

  it('inserts feature flags without merging with the next section header', () => {
    expect(
      upsertCodexFeatureFlag(
        [
          'model = "gpt-5.4"',
          '',
          '[features]',
          'multi_agent = true',
          '[notice]',
          'hide_full_access_warning = true',
          '',
        ].join('\n'),
        'goals',
        true,
      ),
    ).toBe(
      [
        'model = "gpt-5.4"',
        '',
        '[features]',
        'multi_agent = true',
        'goals = true',
        '',
        '[notice]',
        'hide_full_access_warning = true',
        '',
      ].join('\n'),
    );
  });

  it('reads feature flags only from the features section', () => {
    expect(
      isCodexFeatureEnabledFromConfig(
        '[features]\ngoals = true\n\n[notice]\ngoals = false\n',
        'goals',
      ),
    ).toBe(true);
  });
});
