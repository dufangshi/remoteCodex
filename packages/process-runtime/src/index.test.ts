import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseCommandLine, resolveExecutable, runProcess } from './index';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('runProcess', () => {
  it('preserves argv values without shell interpretation', async () => {
    const argument = 'space & (parentheses) 中文';
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1])', argument],
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(argument);
    expect(result.spawnError).toBeNull();
  });

  it('returns stderr and a non-zero exit code', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', "process.stderr.write('failure'); process.exit(7)"],
    });

    expect(result.code).toBe(7);
    expect(result.stderr).toBe('failure');
  });

  it('reports a missing executable', async () => {
    const result = await runProcess({
      command: `remote-codex-missing-${Date.now()}`,
    });

    expect(result.code).toBeNull();
    expect(result.spawnError).not.toBeNull();
  });

  it('terminates a timed out process', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
  });

  it('bounds captured output', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', "process.stdout.write('x'.repeat(100))"],
      maxOutputBytes: 10,
    });

    expect(result.stdout).toBe('x'.repeat(10));
    expect(result.outputTruncated).toBe(true);
  });
});

describe('parseCommandLine', () => {
  it('parses built-in npm and quoted node commands without a shell', () => {
    expect(parseCommandLine('npm install -g @openai/codex@latest')).toEqual({
      command: 'npm',
      args: ['install', '-g', '@openai/codex@latest'],
    });
    expect(parseCommandLine('node -e "process.exit(0)"')).toEqual({
      command: 'node',
      args: ['-e', 'process.exit(0)'],
    });
  });

  it('does not interpret shell operators', () => {
    expect(parseCommandLine('tool first && second')).toEqual({
      command: 'tool',
      args: ['first', '&&', 'second'],
    });
  });
});

describe('resolveExecutable', () => {
  it('resolves an executable from PATH', async () => {
    const resolved = await resolveExecutable(process.execPath);
    expect(resolved).toBe(path.resolve(process.execPath));
  });

  it('uses Windows PATHEXT semantics for command shims', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex process '));
    temporaryDirectories.push(directory);
    const shimPath = path.join(directory, 'codex.CMD');
    await fs.writeFile(shimPath, '@echo off\r\n');

    const resolved = await resolveExecutable('codex', {
      env: { PATH: directory, PATHEXT: '.EXE;.CMD' },
      platform: 'win32',
    });

    expect(resolved?.toLowerCase()).toBe(shimPath.toLowerCase());
  });
});
