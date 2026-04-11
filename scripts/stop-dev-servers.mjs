import { execFileSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const PORTS = [8787, 5173];

function run(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function listListeningPids(port) {
  const output = run('lsof', ['-tiTCP:' + String(port), '-sTCP:LISTEN']);
  if (!output) {
    return [];
  }

  return output
    .split('\n')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 1);
}

function processInfo(pid) {
  const output = run('ps', ['-o', 'pid=,ppid=,command=', '-p', String(pid)]);
  if (!output) {
    return null;
  }

  const match = output.match(/^\s*(\d+)\s+(\d+)\s+([\s\S]+)$/);
  if (!match) {
    return null;
  }

  return {
    pid: Number.parseInt(match[1], 10),
    ppid: Number.parseInt(match[2], 10),
    command: match[3].trim(),
  };
}

function isRepoDevProcess(command) {
  return (
    command.includes(REPO_ROOT) ||
    command.includes('@remote-codex/supervisor-api') ||
    command.includes('@remote-codex/supervisor-web') ||
    command.includes('tsx watch src/index.ts') ||
    command.includes('/vite/bin/vite.js')
  );
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const targets = new Map();

for (const port of PORTS) {
  for (const pid of listListeningPids(port)) {
    let currentPid = pid;
    const visited = new Set();

    while (currentPid > 1 && !visited.has(currentPid)) {
      visited.add(currentPid);
      const info = processInfo(currentPid);
      if (!info) {
        break;
      }

      if (!isRepoDevProcess(info.command)) {
        break;
      }

      targets.set(info.pid, info.command);
      currentPid = info.ppid;
    }
  }
}

const orderedTargets = [...targets.entries()].sort((left, right) => right[0] - left[0]);

if (orderedTargets.length === 0) {
  console.log('No local remote-codex dev servers were listening on 8787 or 5173.');
  process.exit(0);
}

for (const [pid, command] of orderedTargets) {
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped PID ${pid}: ${command}`);
  } catch {
    // Ignore races where the process exits between discovery and kill.
  }
}

sleep(300);

for (const [pid, command] of orderedTargets) {
  if (!isAlive(pid)) {
    continue;
  }

  try {
    process.kill(pid, 'SIGKILL');
    console.log(`Force-stopped PID ${pid}: ${command}`);
  } catch {
    // Ignore races where the process exits between checks.
  }
}
