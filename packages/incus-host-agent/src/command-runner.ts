import { spawn } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunner {
  run(
    binary: string,
    args: readonly string[],
    timeoutMs: number,
    stdin?: string,
  ): Promise<CommandResult>;
}

export class SpawnCommandRunner implements CommandRunner {
  run(
    binary: string,
    args: readonly string[],
    timeoutMs: number,
    stdin?: string,
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, [...args], {
        shell: false,
        stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        env: { ...process.env, LC_ALL: 'C' },
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Command timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      child.stdout!.setEncoding('utf8');
      child.stderr!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr!.on('data', (chunk: string) => {
        stderr += chunk;
      });
      if (stdin !== undefined && child.stdin) {
        child.stdin.end(stdin);
      }
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
      });
    });
  }
}
