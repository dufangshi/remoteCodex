import { describe, expect, it } from 'vitest';

import { TmuxManager } from './tmux-manager';

describe('TmuxManager', () => {
  it('treats a missing tmux socket as an empty session list', async () => {
    const manager = new TmuxManager({
      async execCommand() {
        return {
          stdout: '',
          stderr:
            'error connecting to /private/tmp/tmux-501/default (No such file or directory)',
          exitCode: 1,
        };
      },
    });

    await expect(manager.listSessionNames()).resolves.toEqual([]);
  });

  it('derives a stable tmux session name from the thread id', () => {
    const manager = new TmuxManager();

    expect(manager.sessionNameForThread('019d-abc.def/ghi')).toBe(
      'rcx-019d-abcdefghi',
    );
  });
});
