import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export type Json = Record<string, unknown>;

export async function api<T>(
  base: string,
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${pathname}: ${response.status} ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function waitForHealth(base: string, timeoutMs = 30_000) {
  const start = Date.now();
  let lastError = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) {
        return;
      }
      lastError = `${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(150);
  }
  throw new Error(`healthz not ready at ${base}: ${lastError}`);
}

export function threadPath(base: string, threadId: string) {
  if (base.endsWith('/api')) {
    return `/threads/${threadId}`;
  }
  return `/api/threads/${threadId}`;
}

export async function waitForRunning(
  base: string,
  threadId: string,
  timeoutMs = 20_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const detail = await api<any>(base, threadPath(base, threadId));
    const status = detail.thread?.status ?? detail.status;
    const activeTurnId = detail.thread?.activeTurnId ?? detail.activeTurnId;
    if (status === 'running' || Boolean(activeTurnId)) {
      return detail;
    }
    await delay(80);
  }
  throw new Error(`thread ${threadId} never became running at ${base}`);
}

export async function waitForThread(
  base: string,
  threadId: string,
  timeoutMs = 180_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const detail = await api<any>(base, threadPath(base, threadId));
    const status = detail.thread?.status ?? detail.status;
    if (
      (status === 'idle' || status === 'interrupted' || status === 'failed') &&
      Array.isArray(detail.turns) &&
      detail.turns.length > 0
    ) {
      return detail;
    }
    await delay(400);
  }
  throw new Error(`thread ${threadId} did not settle at ${base}`);
}

export function collectTexts(detail: any): string[] {
  return (detail.turns ?? []).flatMap((turn: any) =>
    (turn.items ?? []).map((item: any) => String(item.text ?? '')),
  );
}

export async function ensureWorkspaceDir(root: string, name: string) {
  const dir = path.join(root, name);
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'README.md'), `# ${name}\n`);
  await fs.writeFile(path.join(dir, 'src', 'main.rs'), 'fn main() {}\n');
  return dir;
}

export function spawnBin(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const child = spawn(bin, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  return child;
}

export async function stopProc(child: ChildProcess | undefined) {
  if (!child || child.killed) {
    return;
  }
  child.kill('SIGTERM');
  await delay(300);
  if (!child.killed) {
    child.kill('SIGKILL');
  }
}
