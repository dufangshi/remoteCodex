import fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { resolveDefaultShell } from './default-shell';

describe('resolveDefaultShell', () => {
  it('uses SHELL when it exists on POSIX systems', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      return filePath === '/custom/shell';
    });

    expect(resolveDefaultShell({ SHELL: '/custom/shell' })).toBe('/custom/shell');
    expect(existsSpy).toHaveBeenCalledWith('/custom/shell');
  });

  it('falls back to an existing POSIX shell instead of assuming zsh', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      return filePath === '/bin/sh';
    });

    expect(resolveDefaultShell({ SHELL: '/missing/zsh' })).toBe('/bin/sh');
  });
});
