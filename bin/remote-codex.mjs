#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const binDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(binDir, '..');
const packageJsonPath = path.join(packageRoot, 'package.json');
const serviceManagerPath = path.join(packageRoot, 'scripts', 'service-manager.mjs');
const relayDistEntry = path.join(packageRoot, 'apps', 'relay-server', 'dist', 'index.js');
const relaySourceEntry = path.join(packageRoot, 'apps', 'relay-server', 'src', 'index.ts');
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

if (command === 'relay') {
  runRelayServer();
} else if (!['start', 'stop', 'status'].includes(command)) {
  printHelp();
  process.exit(command ? 1 : 0);
} else {
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
}

function runRelayServer() {
  const relayEntry = fs.existsSync(relayDistEntry) ? relayDistEntry : relaySourceEntry;
  let commandToRun = process.execPath;
  let args = [relayEntry];

  if (!fs.existsSync(relayEntry)) {
    console.error('Relay server build artifacts are missing. Run `pnpm build` before using `remote-codex relay`.');
    console.error(`Missing: ${path.relative(packageRoot, relayDistEntry)}`);
    process.exit(1);
  }

  if (relayEntry === relaySourceEntry) {
    const tsxEntry = path.join(packageRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (!fs.existsSync(tsxEntry)) {
      console.error('Relay server build artifacts are missing and tsx is not installed for source execution.');
      console.error('Run `pnpm build` or install dependencies with `pnpm install`.');
      process.exit(1);
    }
    args = [tsxEntry, relaySourceEntry];
  }

  const relay = spawn(commandToRun, args, {
    cwd: packageRoot,
    env: process.env,
    stdio: 'inherit',
  });

  relay.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  relay.on('error', (error) => {
    console.error(`Failed to run remote-codex relay: ${error.message}`);
    process.exit(1);
  });
}

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
  remote-codex relay

Environment:
  SERVICE_HOST              Web listen host, default 127.0.0.1
  SERVICE_PORT              Web listen port, default ${defaultServicePort}
  SERVICE_API_HOST          API listen host, default 127.0.0.1
  SERVICE_API_PORT          API listen port, default ${defaultApiPort}
  REMOTE_CODEX_SERVICE_DIR  Service state and log directory, default ~/.remote-codex/service

Relay:
  REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN       Legacy bootstrap token for supervisor tunnels
  REMOTE_CODEX_ADMIN_USERNAME               Relay admin username
  REMOTE_CODEX_ADMIN_PASSWORD               Relay admin password
  REMOTE_CODEX_RELAY_DATA_DIR               Relay user/device store, default .local/relay-server
  REMOTE_CODEX_RELAY_WEB_DIST_DIR           Web dist override, defaults to packaged supervisor-web/dist
  REMOTE_CODEX_RELAY_REGISTRATION_ENABLED   true/false, default true
  HOST                                      Relay listen host, default 0.0.0.0
  PORT                                      Relay listen port, default 8788
`);
}
