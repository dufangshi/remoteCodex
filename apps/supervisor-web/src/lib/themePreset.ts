import { useEffect, useState } from 'react';

/** Visual theme presets. Each works with the light, dark and system color modes. */
export const THEME_PRESETS = ['classic', 'plum-pocket'] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];
export const DEFAULT_THEME_PRESET: ThemePreset = 'classic';
export const THEME_PRESET_KEY = 'pockymoe-theme-preset';
const CHANGE_EVENT = 'pockymoe-theme-preset';

export function normalizeThemePreset(value: unknown): ThemePreset {
  return THEME_PRESETS.includes(value as ThemePreset) ? (value as ThemePreset) : DEFAULT_THEME_PRESET;
}
export function readThemePreset(): ThemePreset {
  try { return normalizeThemePreset(localStorage.getItem(THEME_PRESET_KEY)); } catch { return DEFAULT_THEME_PRESET; }
}
/** Stylesheets select presets with `:root[data-theme-preset='…']`. */
export function applyThemePreset(preset = readThemePreset()) {
  document.documentElement.dataset.themePreset = normalizeThemePreset(preset);
}
export function setThemePreset(preset: ThemePreset) {
  const next = normalizeThemePreset(preset);
  try { localStorage.setItem(THEME_PRESET_KEY, next); } catch { /* The current page still switches. */ }
  applyThemePreset(next);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
}
export function initializeThemePreset() {
  applyThemePreset();
  window.addEventListener('storage', (event) => { if (event.key === THEME_PRESET_KEY || event.key === null) applyThemePreset(); });
}
export function useThemePreset() {
  const [preset, update] = useState(readThemePreset);
  useEffect(() => {
    const refresh = () => update(readThemePreset());
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return [preset, setThemePreset] as const;
}

/** Browser chrome color for the `theme-color` meta tag. */
export function themeChromeColor(preset: ThemePreset, mode: 'light' | 'dark') {
  if (preset === 'plum-pocket') return mode === 'dark' ? '#170d1d' : '#2f1a3b';
  return mode === 'dark' ? '#171713' : '#f3f6f7';
}

/** The avatar a theme shows for a thread's harness. */
export function threadAgent(thread: { provider?: string | null; agentId?: string | null }) {
  const agent = (thread.agentId || thread.provider || '').trim().toLowerCase();
  return agent && agent !== 'acp' ? agent : undefined;
}
export function threadAgentField(thread: { provider?: string | null; agentId?: string | null }): { agent?: string } {
  const agent = threadAgent(thread);
  return agent ? { agent } : {};
}
