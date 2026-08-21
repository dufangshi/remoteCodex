import type { ChildProcess, SpawnOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

export interface SpawnProcessOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnOptions['stdio'];
  detached?: boolean;
  windowsHide?: boolean;
}

export interface RunProcessOptions extends Omit<SpawnProcessOptions, 'stdio' | 'detached'> {
  timeoutMs?: number;
  maxOutputBytes?: number;
  input?: string | Buffer;
}

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
  spawnError: Error | null;
}

export interface ParsedCommandLine {
  command: string;
  args: string[];
}

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Parse a persisted/display command into argv without evaluating a shell.
 * Supports the quoting used by the built-in runtime install commands. Shell
 * operators and environment expansion are intentionally treated as literals.
 */
export function parseCommandLine(value: string): ParsedCommandLine {
  const tokens: string[] = [];
  let token = '';
  let quote: 'single' | 'double' | null = null;
  let tokenStarted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote === 'single') {
      if (character === "'") {
        quote = null;
      } else {
        token += character;
      }
      tokenStarted = true;
      continue;
    }
    if (quote === 'double') {
      if (character === '"') {
        quote = null;
      } else if (
        character === '\\' &&
        (value[index + 1] === '"' || value[index + 1] === '\\')
      ) {
        token += value[index + 1];
        index += 1;
      } else {
        token += character;
      }
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = '';
        tokenStarted = false;
      }
      continue;
    }
    if (character === "'") {
      quote = 'single';
      tokenStarted = true;
      continue;
    }
    if (character === '"') {
      quote = 'double';
      tokenStarted = true;
      continue;
    }
    token += character;
    tokenStarted = true;
  }

  if (quote) {
    throw new Error('Command contains an unterminated quoted argument.');
  }
  if (tokenStarted) {
    tokens.push(token);
  }
  const [command, ...args] = tokens;
  if (!command) {
    throw new Error('Command is empty.');
  }
  return { command, args };
}

/**
 * Spawn an executable without constructing a shell command string.
 * cross-spawn is used so Windows PATHEXT and npm .cmd shims work consistently.
 */
export function spawnProcess(options: SpawnProcessOptions): ChildProcess {
  return crossSpawn(options.command, [...(options.args ?? [])], {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? 'pipe',
    detached: options.detached,
    windowsHide: options.windowsHide ?? true,
    shell: false,
  });
}

export function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawnProcess({
      ...options,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    let timedOut = false;
    let outputTruncated = false;
    let spawnError: Error | null = null;
    let settled = false;

    const append = (current: Buffer, chunk: Buffer | string) => {
      const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxOutputBytes - current.byteLength);
      if (nextChunk.byteLength > remaining) {
        outputTruncated = true;
      }
      return remaining === 0
        ? current
        : Buffer.concat([current, nextChunk.subarray(0, remaining)]);
    };

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (error) => {
      spawnError = error;
    });

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        code: spawnError ? null : code,
        signal,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        timedOut,
        outputTruncated,
        spawnError,
      });
    };

    child.on('close', finish);
    const timer = options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, options.timeoutMs)
      : null;

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    } else {
      child.stdin?.end();
    }
  });
}

function pathEnvironmentValue(env: NodeJS.ProcessEnv) {
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === 'path');
  return entry?.[1] ?? '';
}

function windowsExtensions(command: string, env: NodeJS.ProcessEnv) {
  if (path.extname(command)) {
    return [''];
  }
  const pathExtEntry = Object.entries(env).find(([key]) => key.toLowerCase() === 'pathext');
  const extensions = (pathExtEntry?.[1] ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean);
  return ['', ...extensions];
}

async function isFile(candidate: string) {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** Resolve a command for diagnostics only. Execution must still use spawnProcess. */
export async function resolveExecutable(
  command: string,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  } = {},
): Promise<string | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const hasPathSeparator = command.includes('/') || command.includes('\\');
  const searchDirectories = hasPathSeparator
    ? ['']
    : pathEnvironmentValue(env).split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32' ? windowsExtensions(command, env) : [''];

  for (const directory of searchDirectories) {
    const base = hasPathSeparator
      ? (path.isAbsolute(command) ? command : path.resolve(cwd, command))
      : path.join(directory, command);
    for (const extension of extensions) {
      const candidate = `${base}${extension}`;
      if (await isFile(candidate)) {
        return path.resolve(candidate);
      }
    }
  }
  return null;
}
