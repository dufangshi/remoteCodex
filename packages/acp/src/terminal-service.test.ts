import { describe, expect, it } from 'vitest';

import { AcpTerminalService } from './terminal-service';

describe('AcpTerminalService', () => {
  it('parses agents that send command and argv as one ACP command string', async () => {
    const operations: Array<{ operation: string; sessionId: string; path: string }> = [];
    const service = new AcpTerminalService(
      () => process.cwd(),
      (operation) => operations.push(operation),
    );
    const created = await service.create({
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
    expect(operations).toMatchObject([{
      operation: 'terminal.create',
      sessionId: 'session-1',
      path: await import('node:fs/promises').then((fs) => fs.realpath(process.cwd())),
    }]);
    service.release({
      sessionId: 'session-1',
      terminalId: created.terminalId,
    });
  });

  it('rejects terminal working directories outside the session workspace', async () => {
    const service = new AcpTerminalService(() => process.cwd());
    await expect(service.create({
      sessionId: 'session-1',
      command: process.execPath,
      args: ['--version'],
      cwd: '/tmp',
    })).rejects.toThrow(/must stay inside the session workspace/);
  });
});
