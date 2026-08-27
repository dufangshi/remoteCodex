import { describe, expect, it } from 'vitest';

import { AcpTerminalService } from './terminal-service';

describe('AcpTerminalService', () => {
  it('parses agents that send command and argv as one ACP command string', async () => {
    const service = new AcpTerminalService(() => process.cwd());
    const created = service.create({
      sessionId: 'session-1',
      command: `"${process.execPath}" -e "process.stdout.write('ACP_TERMINAL_OK')"`,
      args: [],
      outputByteLimit: 1_000,
    });
    const exit = await service.waitForExit({
      sessionId: 'session-1',
      terminalId: created.terminalId,
    });
    const output = service.output({
      sessionId: 'session-1',
      terminalId: created.terminalId,
    });

    expect(exit.exitCode).toBe(0);
    expect(output.output).toBe('ACP_TERMINAL_OK');
    expect(output.truncated).toBe(false);
    service.release({
      sessionId: 'session-1',
      terminalId: created.terminalId,
    });
  });
});
