// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyFontSize, FONT_SIZE_KEY, normalizeFontSize, readFontSize, setFontSize } from './fontSize';

describe('font size preference', () => {
  beforeEach(() => localStorage.clear());
  it('rejects invalid, out-of-range and missing storage values', () => {
    for (const value of [null, '', 'NaN', 0, 100, -1, undefined]) expect(normalizeFontSize(value)).toBe(16);
    expect(normalizeFontSize('18')).toBe(18);
  });
  it('applies immediately and restores on a later page load', () => {
    setFontSize(20);
    expect(localStorage.getItem(FONT_SIZE_KEY)).toBe('20');
    expect(document.documentElement.style.fontSize).toBe('20px');
    document.documentElement.style.fontSize = '';
    applyFontSize();
    expect(document.documentElement.style.fontSize).toBe('20px');
    expect(readFontSize()).toBe(20);
    setFontSize(16);
    expect(document.documentElement.style.fontSize).toBe('16px');
  });
});
