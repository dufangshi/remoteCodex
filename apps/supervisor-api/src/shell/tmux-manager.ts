import fs from 'node:fs';
import path from 'node:path';
import { spawn as spawnChild } from 'node:child_process';

export interface TmuxManagerOptions {
  command?: string;
  defaultShell?: string;
  execCommand?: (
    command: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

async function defaultExecCommand(command: string, args: string[]) {
  return await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>((resolve, reject) => {
    const child = spawnChild(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', reject);
    child.once('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });
  });
}

function resolveExecutablePath(command: string) {
  if (command.includes(path.sep)) {
    return command;
  }

  const searchPath = process.env.PATH ?? '';
  for (const entry of searchPath.split(path.delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const candidate = path.join(trimmed, command);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return command;
}

export class TmuxManager {
  private readonly command: string;
  private readonly defaultShell: string;
  private readonly execCommand: NonNullable<TmuxManagerOptions['execCommand']>;

  constructor(options: TmuxManagerOptions = {}) {
    this.command = resolveExecutablePath(options.command ?? 'tmux');
    this.defaultShell = options.defaultShell ?? process.env.SHELL ?? '/bin/zsh';
    this.execCommand = options.execCommand ?? defaultExecCommand;
  }

  sessionNameForThread(threadId: string) {
    return `rcx-${threadId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 28)}`;
  }

  async listSessionNames() {
    const result = await this.execCommand(this.command, [
      'list-sessions',
      '-F',
      '#{session_name}',
    ]);

    if (result.exitCode !== 0) {
      const stderr = result.stderr.trim().toLowerCase();
      if (
        stderr.includes('no server running') ||
        stderr.includes('error connecting to')
      ) {
        return [];
      }

      throw new Error(result.stderr.trim() || 'Unable to list tmux sessions.');
    }

    return result.stdout
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  async hasSession(sessionName: string) {
    const result = await this.execCommand(this.command, ['has-session', '-t', sessionName]);

    return result.exitCode === 0;
  }

  async createSession(input: {
    sessionName: string;
    cwd: string;
    cols?: number;
    rows?: number;
  }) {
    const args = [
      'new-session',
      '-d',
      '-s',
      input.sessionName,
      '-x',
      String(input.cols ?? 120),
      '-y',
      String(input.rows ?? 36),
      '-c',
      input.cwd,
      this.defaultShell,
      '-l',
    ];
    const result = await this.execCommand(this.command, args);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'Unable to create tmux session.');
    }
  }

  async resizeWindow(sessionName: string, cols: number, rows: number) {
    const result = await this.execCommand(this.command, [
      'resize-window',
      '-t',
      sessionName,
      '-x',
      String(cols),
      '-y',
      String(rows),
    ]);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'Unable to resize tmux window.');
    }
  }

  async sendInput(sessionName: string, data: string) {
    for (const token of tokenizeTmuxInput(data)) {
      const args =
        token.type === 'literal'
          ? ['send-keys', '-t', sessionName, '-l', token.value]
          : ['send-keys', '-t', sessionName, token.value];
      const result = await this.execCommand(this.command, args);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || 'Unable to send input to tmux.');
      }
    }
  }

  async capturePane(sessionName: string, historyLines = 2000) {
    const result = await this.execCommand(this.command, [
      'capture-pane',
      '-p',
      '-e',
      '-S',
      `-${historyLines}`,
      '-t',
      sessionName,
    ]);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'Unable to capture tmux pane.');
    }

    return result.stdout;
  }

  async getPaneCursor(sessionName: string) {
    const result = await this.execCommand(this.command, [
      'display-message',
      '-p',
      '-t',
      sessionName,
      '#{cursor_x} #{cursor_y} #{pane_width} #{pane_height}',
    ]);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'Unable to inspect tmux cursor.');
    }

    const [cursorX, cursorY, paneWidth, paneHeight] = result.stdout
      .trim()
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10));

    return {
      cursorX: Number.isFinite(cursorX) ? cursorX : 0,
      cursorY: Number.isFinite(cursorY) ? cursorY : 0,
      paneWidth: Number.isFinite(paneWidth) ? paneWidth : 0,
      paneHeight: Number.isFinite(paneHeight) ? paneHeight : 0,
    };
  }

  async killSession(sessionName: string) {
    const result = await this.execCommand(this.command, [
      'kill-session',
      '-t',
      sessionName,
    ]);

    if (result.exitCode !== 0 && !result.stderr.includes('can\'t find session')) {
      throw new Error(result.stderr.trim() || 'Unable to kill tmux session.');
    }
  }
}

function tokenizeTmuxInput(data: string) {
  const tokens: Array<{ type: 'literal' | 'key'; value: string }> = [];
  let literalBuffer = '';

  function flushLiteral() {
    if (!literalBuffer) {
      return;
    }

    tokens.push({ type: 'literal', value: literalBuffer });
    literalBuffer = '';
  }

  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];
    if (char === undefined) {
      continue;
    }

    const nextThree = data.slice(index, index + 3);
    const nextFour = data.slice(index, index + 4);

    if (nextThree === '\u001b[A') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'Up' });
      index += 2;
      continue;
    }

    if (nextThree === '\u001b[B') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'Down' });
      index += 2;
      continue;
    }

    if (nextThree === '\u001b[C') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'Right' });
      index += 2;
      continue;
    }

    if (nextThree === '\u001b[D') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'Left' });
      index += 2;
      continue;
    }

    if (nextFour === '\u001b[3~') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'DC' });
      index += 3;
      continue;
    }

    if (nextThree === '\u001bOH' || nextThree === '\u001b[H') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'Home' });
      index += 2;
      continue;
    }

    if (nextThree === '\u001bOF' || nextThree === '\u001b[F') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'End' });
      index += 2;
      continue;
    }

    if (char === '\r' || char === '\n') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'Enter' });
      if (char === '\r' && data[index + 1] === '\n') {
        index += 1;
      }
      continue;
    }

    if (char === '\u0003') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'C-c' });
      continue;
    }

    if (char === '\u0004') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'C-d' });
      continue;
    }

    if (char === '\u0002') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'C-b' });
      continue;
    }

    if (char === '\u0009') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'Tab' });
      continue;
    }

    if (char === '\u007f' || char === '\b') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'BSpace' });
      continue;
    }

    if (char === '\u001b') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'Escape' });
      continue;
    }

    literalBuffer += char;
  }

  flushLiteral();
  return tokens;
}
