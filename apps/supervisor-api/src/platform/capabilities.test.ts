import { describe, expect, it } from 'vitest';

import { detectPlatformCapabilities } from './capabilities';

describe('detectPlatformCapabilities', () => {
  it('keeps the existing terminal behavior on macOS and Linux', () => {
    expect(detectPlatformCapabilities('darwin')).toMatchObject({
      terminal: true,
      tmux: true,
      managedSignals: true,
      windowsTaskScheduler: false,
    });
    expect(detectPlatformCapabilities('linux')).toMatchObject({
      terminal: true,
      tmux: true,
      managedSignals: true,
      windowsTaskScheduler: false,
    });
  });

  it('marks terminal and Unix lifecycle features unavailable on Windows', () => {
    expect(detectPlatformCapabilities('win32')).toEqual({
      platform: 'win32',
      terminal: false,
      tmux: false,
      managedSignals: false,
      windowsTaskScheduler: true,
    });
  });
});
