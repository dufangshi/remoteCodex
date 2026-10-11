// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyThemePreset, normalizeThemePreset, readThemePreset, setThemePreset, THEME_PRESET_KEY, threadAgentField } from './themePreset';

describe('theme preset preference', () => {
  beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.themePreset; });
  it('falls back to Classic for missing or unknown values', () => {
    for (const value of [null, '', 'neon', 1, undefined]) expect(normalizeThemePreset(value)).toBe('classic');
    expect(normalizeThemePreset('plum-pocket')).toBe('plum-pocket');
  });
  it('applies immediately and restores on a later page load', () => {
    setThemePreset('plum-pocket');
    expect(localStorage.getItem(THEME_PRESET_KEY)).toBe('plum-pocket');
    expect(document.documentElement.dataset.themePreset).toBe('plum-pocket');
    delete document.documentElement.dataset.themePreset;
    applyThemePreset();
    expect(document.documentElement.dataset.themePreset).toBe('plum-pocket');
    expect(readThemePreset()).toBe('plum-pocket');
    setThemePreset('classic');
    expect(document.documentElement.dataset.themePreset).toBe('classic');
  });
  it('names the agent harness for avatars without the generic ACP provider', () => {
    expect(threadAgentField({ provider: 'acp', agentId: 'Codex' })).toEqual({ agent: 'codex' });
    expect(threadAgentField({ provider: 'claude', agentId: null })).toEqual({ agent: 'claude' });
    expect(threadAgentField({ provider: 'acp' })).toEqual({});
  });
});
