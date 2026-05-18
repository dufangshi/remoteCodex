#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const binDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(binDir, '..');
const packageJsonPath = path.join(packageRoot, 'package.json');
const serviceManagerPath = path.join(packageRoot, 'scripts', 'service-manager.mjs');
const sourceCheckout =
  fs.existsSync(path.join(packageRoot, 'pnpm-workspace.yaml')) &&
  fs.existsSync(path.join(packageRoot, 'scripts', 'service-restart.mjs'));
const defaultServicePort = sourceCheckout ? 4173 : 45673;
const defaultApiPort = sourceCheckout ? 8787 : 45674;

const aliases = new Map([
  ['service:start', 'start'],
  ['service:stop', 'stop'],
  ['service:status', 'status'],
]);

const command = normalizeCommand(process.argv[2]);

if (command === 'help') {
  printHelp();
  process.exit(0);
}

if (command === 'version') {
  console.log(readPackageVersion());
  process.exit(0);
}

if (!['start', 'stop', 'status'].includes(command)) {
  printHelp();
  process.exit(command ? 1 : 0);
}

const child = spawn(process.execPath, [serviceManagerPath, command], {
  cwd: packageRoot,
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`Failed to run remote-codex ${command}: ${error.message}`);
  process.exit(1);
});

function normalizeCommand(value) {
  if (!value || value === '-h' || value === '--help') {
    return 'help';
  }

  if (value === '-v' || value === '--version') {
    return 'version';
  }

  return aliases.get(value) ?? value;
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return String(packageJson.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

function printHelp() {
  console.log(`remote-codex ${readPackageVersion()}

Usage:
  remote-codex start
  remote-codex status
  remote-codex stop

Environment:
  SERVICE_HOST              Web listen host, default 127.0.0.1
  SERVICE_PORT              Web listen port, default ${defaultServicePort}
  SERVICE_API_HOST          API listen host, default 127.0.0.1
  SERVICE_API_PORT          API listen port, default ${defaultApiPort}
  REMOTE_CODEX_SERVICE_DIR  Service state and log directory, default ~/.remote-codex/service
`);
}
