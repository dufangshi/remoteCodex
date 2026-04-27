import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const repoRoot = path.resolve(scriptDir, '..');
const serviceDir = path.join(repoRoot, '.local', 'service');
const restartLogPath = path.join(serviceDir, 'restart.log');
const restartStatePath = path.join(serviceDir, 'restart-state.json');
const mode = process.argv[2] ?? 'launch';

if (mode === 'launch') {
  await launchDetachedRestart();
} else if (mode === 'run') {
  await runRestart();
} else {
  console.error('Usage: node scripts/service-restart.mjs [launch|run]');
  process.exit(1);
}

async function launchDetachedRestart() {
  await fsp.mkdir(serviceDir, { recursive: true });
  rotateLogFile(restartLogPath);

  const logFd = fs.openSync(restartLogPath, 'a');
  const child = spawn(process.execPath, [scriptFile, 'run'], {
    cwd: repoRoot,
    detached: true,
    env: process.env,
    stdio: ['ignore', logFd, logFd],
  });

  child.unref();
  fs.closeSync(logFd);

  if (!child.pid) {
    throw new Error('Failed to launch detached restart worker.');
  }

  await writeRestartState({
    pid: child.pid,
    status: 'launched',
    launchedAt: new Date().toISOString(),
    logPath: restartLogPath,
  });

  console.log(`Launched detached restart worker (pid ${child.pid}).`);
  console.log(`Log: ${restartLogPath}`);
}

async function runRestart() {
  await fsp.mkdir(serviceDir, { recursive: true });
  await writeRestartState({
    pid: process.pid,
    status: 'running',
    startedAt: new Date().toISOString(),
    logPath: restartLogPath,
  });

  try {
    await runGitUpdate();
    await runPnpmCommand(['build']);
    await runPnpmCommand(['service:stop']);
    await runPnpmCommand(['service:start']);
    await runPnpmCommand(['service:status']);

    await writeRestartState({
      pid: process.pid,
      status: 'completed',
      completedAt: new Date().toISOString(),
      logPath: restartLogPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    await writeRestartState({
      pid: process.pid,
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: message,
      logPath: restartLogPath,
    });
    process.exit(1);
  }
}

async function runGitUpdate() {
  await runGitCommand(['fetch', 'origin']);

  const branch = await readGitCommand(['rev-parse', '--abbrev-ref', 'HEAD']);
  const trimmedBranch = branch.trim();

  if (trimmedBranch && trimmedBranch !== 'HEAD') {
    await runGitCommand(['pull', '--ff-only', 'origin', trimmedBranch]);
    return;
  }

  await runGitCommand(['pull', '--ff-only', 'origin']);
}

async function runGitCommand(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Command failed: git ${args.join(' ')} (${signal ? `signal ${signal}` : `exit ${String(code)}`})`,
        ),
      );
    });
  });
}

async function readGitCommand(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const chunks = [];

    child.stdout.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf8'));
        return;
      }

      reject(
        new Error(
          `Command failed: git ${args.join(' ')} (${signal ? `signal ${signal}` : `exit ${String(code)}`})`,
        ),
      );
    });
  });
}

async function runPnpmCommand(args) {
  await new Promise((resolve, reject) => {
    const { command, commandArgs } = resolvePnpmInvocation(args);
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Command failed: pnpm ${args.join(' ')} (${signal ? `signal ${signal}` : `exit ${String(code)}`})`,
        ),
      );
    });
  });
}

function resolvePnpmInvocation(args) {
  const pnpmEntrypoint = process.env.npm_execpath;
  if (pnpmEntrypoint) {
    if (pnpmEntrypoint.endsWith('.js') || pnpmEntrypoint.endsWith('.cjs')) {
      return {
        command: process.execPath,
        commandArgs: [pnpmEntrypoint, ...args],
      };
    }

    return {
      command: pnpmEntrypoint,
      commandArgs: args,
    };
  }

  return {
    command: process.execPath,
    commandArgs: [path.join(repoRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'), ...args],
  };
}

function rotateLogFile(logPath) {
  const rotatedPath = `${logPath}.1`;
  if (fs.existsSync(rotatedPath)) {
    fs.rmSync(rotatedPath, { force: true });
  }
  if (fs.existsSync(logPath)) {
    fs.renameSync(logPath, rotatedPath);
  }
}

async function writeRestartState(nextState) {
  await fsp.writeFile(`${restartStatePath}`, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
}
