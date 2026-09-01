import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const localRoot = path.join(repoRoot, '.local');
await fs.mkdir(localRoot, { recursive: true });
const testRoot = await fs.mkdtemp(path.join(localRoot, 'acp-codex-web-'));
const isolatedCodexHome = path.join(testRoot, 'codex-home');
await fs.mkdir(isolatedCodexHome, { recursive: true });
const sourceCodexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
for (const fileName of ['auth.json', 'config.toml']) {
  const source = path.join(sourceCodexHome, fileName);
  try {
    await fs.access(source);
    await fs.symlink(source, path.join(isolatedCodexHome, fileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const apiPort = await freePort();
const webPort = await freePort();
try {
  const child = spawn(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      'e2e/acp-codex-parity.spec.ts',
      ...process.argv.slice(2),
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        REMOTE_CODEX_REAL_ACP_E2E: '1',
        REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'acp',
        CODEX_HOME: isolatedCodexHome,
        ACP_COMMAND: '',
        E2E_API_PORT: String(apiPort),
        E2E_WEB_PORT: String(webPort),
        E2E_DATABASE_URL: path.join(testRoot, 'supervisor.sqlite'),
        E2E_WORKSPACE_ROOT: path.join(testRoot, 'workspaces'),
      },
    },
  );
  const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
  if (code !== 0) {
    throw new Error(`Playwright Codex ACP parity failed with ${signal ?? `exit ${code}`}.`);
  }
} finally {
  await fs.rm(testRoot, { recursive: true, force: true });
}
