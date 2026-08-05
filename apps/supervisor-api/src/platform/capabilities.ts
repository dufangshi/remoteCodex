export interface PlatformCapabilities {
  platform: NodeJS.Platform;
  terminal: boolean;
  tmux: boolean;
  managedSignals: boolean;
  windowsTaskScheduler: boolean;
}

export function detectPlatformCapabilities(
  platform: NodeJS.Platform = process.platform,
): PlatformCapabilities {
  const windows = platform === 'win32';
  return {
    platform,
    terminal: !windows,
    tmux: !windows,
    managedSignals: !windows,
    windowsTaskScheduler: windows,
  };
}
