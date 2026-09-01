import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type * as acp from '@agentclientprotocol/sdk';

import {
  parseCommandLine,
  spawnProcess,
} from '../../process-runtime/src/index';
import { resolveAcpWorkspacePath } from './workspace-boundary';

const DEFAULT_OUTPUT_BYTE_LIMIT = 1024 * 1024;

interface AcpTerminalState {
  child: ChildProcess;
  chunks: Buffer[];
  outputByteLimit: number;
  exitStatus: acp.TerminalExitStatus | null;
  exitPromise: Promise<acp.WaitForTerminalExitResponse>;
  resolveExit: (status: acp.WaitForTerminalExitResponse) => void;
}

function retainedOutput(state: AcpTerminalState) {
  const complete = Buffer.concat(state.chunks);
  if (complete.byteLength <= state.outputByteLimit) {
    return { output: complete.toString('utf8'), truncated: false };
  }

  let start = complete.byteLength - state.outputByteLimit;
  while (start < complete.byteLength && (complete[start]! & 0xc0) === 0x80) {
    start += 1;
  }
  return {
    output: complete.subarray(start).toString('utf8'),
    truncated: true,
  };
}

export class AcpTerminalService {
  private readonly terminals = new Map<string, AcpTerminalState>();

  constructor(
    private readonly sessionCwd: (sessionId: string) => string | null,
    private readonly onOperation: (input: {
      operation: 'terminal.create';
      sessionId: string;
      path: string;
    }) => void = () => undefined,
  ) {}

  async create(params: acp.CreateTerminalRequest): Promise<acp.CreateTerminalResponse> {
    const terminalId = randomUUID();
    const sessionCwd = this.sessionCwd(params.sessionId);
    if (!sessionCwd) {
      throw new Error(`ACP session workspace not found: ${params.sessionId}`);
    }
    const cwd = await resolveAcpWorkspacePath(
      sessionCwd,
      params.cwd ?? sessionCwd,
    );
    this.onOperation({
      operation: 'terminal.create',
      sessionId: params.sessionId,
      path: cwd,
    });
    const parsed = params.args && params.args.length > 0
      ? { command: params.command, args: params.args }
      : parseCommandLine(params.command);
    const child = spawnProcess({
      command: parsed.command,
      args: parsed.args,
      cwd,
      env: {
        ...process.env,
        ...Object.fromEntries((params.env ?? []).map((entry) => [entry.name, entry.value])),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolveExit!: (status: acp.WaitForTerminalExitResponse) => void;
    const exitPromise = new Promise<acp.WaitForTerminalExitResponse>((resolve) => {
      resolveExit = resolve;
    });
    const state: AcpTerminalState = {
      child,
      chunks: [],
      outputByteLimit: Math.max(1, params.outputByteLimit ?? DEFAULT_OUTPUT_BYTE_LIMIT),
      exitStatus: null,
      exitPromise,
      resolveExit,
    };
    this.terminals.set(terminalId, state);

    const append = (chunk: Buffer | string) => {
      state.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (error) => append(`${error.message}\n`));
    child.on('close', (code, signal) => {
      const exitStatus: acp.TerminalExitStatus = {
        exitCode: code,
        signal,
      };
      state.exitStatus = exitStatus;
      state.resolveExit(exitStatus);
    });

    return { terminalId };
  }

  output(params: acp.TerminalOutputRequest): acp.TerminalOutputResponse {
    const state = this.require(params.terminalId);
    const output = retainedOutput(state);
    return {
      ...output,
      ...(state.exitStatus ? { exitStatus: state.exitStatus } : {}),
    };
  }

  waitForExit(params: acp.WaitForTerminalExitRequest) {
    return this.require(params.terminalId).exitPromise;
  }

  kill(params: acp.KillTerminalRequest): acp.KillTerminalResponse {
    const state = this.require(params.terminalId);
    if (!state.exitStatus) {
      state.child.kill('SIGTERM');
    }
    return {};
  }

  release(params: acp.ReleaseTerminalRequest): acp.ReleaseTerminalResponse {
    const state = this.require(params.terminalId);
    if (!state.exitStatus) {
      state.child.kill('SIGTERM');
    }
    this.terminals.delete(params.terminalId);
    return {};
  }

  stop() {
    for (const state of this.terminals.values()) {
      if (!state.exitStatus) {
        state.child.kill('SIGTERM');
      }
    }
    this.terminals.clear();
  }

  private require(terminalId: string) {
    const state = this.terminals.get(terminalId);
    if (!state) {
      throw new Error(`ACP terminal not found: ${terminalId}`);
    }
    return state;
  }
}
