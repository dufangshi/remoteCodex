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

  it('maps form feed to Ctrl-L when sending tmux input', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const manager = new TmuxManager({
      async execCommand(command, args) {
        calls.push({ command, args });
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
        };
      },
    });

    await manager.sendInput('rcx-test', '\u000c');

    expect(calls).toEqual([
      {
        command: expect.stringContaining('tmux'),
        args: ['send-keys', '-t', 'rcx-test', 'C-l'],
      },
    ]);
  });
});
