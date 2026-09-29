import { useEffect, useState } from 'react';

export const FONT_SIZE_KEY = 'remote-codex-font-size';
export const DEFAULT_FONT_SIZE = 16;
export function normalizeFontSize(value: unknown): number {
  const size = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(size) && size >= 12 && size <= 22 ? Math.round(size) : DEFAULT_FONT_SIZE;
}
export function readFontSize(): number {
  try { return normalizeFontSize(localStorage.getItem(FONT_SIZE_KEY)); } catch { return DEFAULT_FONT_SIZE; }
}
export function applyFontSize(size = readFontSize()) {
  document.documentElement.style.fontSize = `${normalizeFontSize(size)}px`;
}
export function setFontSize(size: number) {
  const next = normalizeFontSize(size);
  try { localStorage.setItem(FONT_SIZE_KEY, String(next)); } catch { /* Current page remains usable if storage is unavailable. */ }
  applyFontSize(next);
  window.dispatchEvent(new CustomEvent('remote-codex-font-size', { detail: next }));
}
export function initializeFontSize() {
  applyFontSize();
  window.addEventListener('storage', (event) => { if (event.key === FONT_SIZE_KEY || event.key === null) applyFontSize(); });
}
export function useFontSize() {
  const [size, update] = useState(readFontSize);
  useEffect(() => {
    const refresh = () => update(readFontSize());
    window.addEventListener('remote-codex-font-size', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('remote-codex-font-size', refresh); window.removeEventListener('storage', refresh); };
  }, []);
  return [size, setFontSize] as const;
}
