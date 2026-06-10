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
const supervisorDistEntry = path.join(packageRoot, 'apps', 'supervisor-api', 'dist', 'index.js');
const supervisorSourceEntry = path.join(packageRoot, 'apps', 'supervisor-api', 'src', 'index.ts');
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

if (fs.existsSync(path.join(packageRoot, '.env'))) {
  process.loadEnvFile?.(path.join(packageRoot, '.env'));
}

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
} else if (command === 'relay-supervisor') {
  runRelaySupervisor();
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
  const guidance = {
    commandName: 'remote-codex relay',
    description: 'Run the public relay server that browsers/apps connect to.',
    required: [
      ['REMOTE_CODEX_ADMIN_USERNAME', 'Initial relay admin username, for example admin.'],
      ['REMOTE_CODEX_ADMIN_PASSWORD', 'Initial relay admin password, at least 8 characters.'],
    ],
    recommended: [
      ['REMOTE_CODEX_RELAY_SESSION_SECRET', 'Relay session signing secret, at least 16 characters. Defaults to the admin password if omitted.'],
      ['REMOTE_CODEX_RELAY_DATA_DIR', 'Persistent relay user/device/share store. Defaults to .local/relay-server.'],
      ['REMOTE_CODEX_RELAY_REGISTRATION_ENABLED', 'true/false. Use false when only admins should create users.'],
      ['HOST', 'Relay listen host. Use 0.0.0.0 on a public server. Default 0.0.0.0.'],
      ['PORT', 'Relay listen port. Default 8788.'],
    ],
    example: [
      'REMOTE_CODEX_ADMIN_USERNAME=admin \\',
      'REMOTE_CODEX_ADMIN_PASSWORD=change-me-now \\',
      'REMOTE_CODEX_RELAY_SESSION_SECRET=at-least-16-characters \\',
      'REMOTE_CODEX_RELAY_DATA_DIR=/var/lib/remote-codex-relay \\',
      'REMOTE_CODEX_RELAY_REGISTRATION_ENABLED=false \\',
      'HOST=0.0.0.0 PORT=8788 \\',
      'remote-codex relay',
    ],
    validate: () => {
      const issues = [];
      if (process.env.REMOTE_CODEX_ADMIN_PASSWORD && process.env.REMOTE_CODEX_ADMIN_PASSWORD.length < 8) {
        issues.push('REMOTE_CODEX_ADMIN_PASSWORD must be at least 8 characters.');
      }
      if (
        process.env.REMOTE_CODEX_RELAY_SESSION_SECRET &&
        process.env.REMOTE_CODEX_RELAY_SESSION_SECRET.length < 16
      ) {
        issues.push('REMOTE_CODEX_RELAY_SESSION_SECRET must be at least 16 characters.');
      }
      return issues;
    },
  };
  validateRequiredEnv(guidance);
  printEnvSummary(guidance);

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
    env: relayServerEnv(),
    stdio: 'inherit',
  });

  relay.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    if (code && code !== 0) {
      console.error(`remote-codex relay exited with code ${code}. Check the relay port, HOST/PORT, and environment values above.`);
    }
    process.exit(code ?? 1);
  });

  relay.on('error', (error) => {
    console.error(`Failed to run remote-codex relay: ${error.message}`);
    process.exit(1);
  });
}

function runRelaySupervisor() {
  const guidance = {
    commandName: 'remote-codex relay-supervisor',
    description: 'Run the private-machine supervisor backend that connects outward to a public relay.',
    required: [
      ['REMOTE_CODEX_ADMIN_USERNAME', 'Private supervisor admin username. Required because relay mode enables local API auth.'],
      ['REMOTE_CODEX_ADMIN_PASSWORD', 'Private supervisor admin password. Required because relay mode enables local API auth.'],
      ['REMOTE_CODEX_SESSION_SECRET', 'Private supervisor session signing secret, at least 16 characters.'],
      ['REMOTE_CODEX_RELAY_SERVER_URL', 'Public relay websocket base URL, for example ws://host:8788 or wss://relay.example.com.'],
      ['REMOTE_CODEX_RELAY_AGENT_TOKEN', 'Device token created in the relay portal. This is not the relay admin password.'],
    ],
    recommended: [
      ['HOST', 'Private supervisor listen host. Default 127.0.0.1.'],
      ['PORT', 'Private supervisor listen port. Default 8787.'],
      ['DATABASE_URL', 'SQLite database path. Set this when running a separate backend beside another Remote Codex.'],
      ['WORKSPACE_ROOT', 'Root directory that workspace paths must live under. Default is your home directory.'],
      ['CODEX_HOME', 'Codex config directory. Default ~/.codex.'],
    ],
    example: [
      'REMOTE_CODEX_ADMIN_USERNAME=admin \\',
      'REMOTE_CODEX_ADMIN_PASSWORD=change-me-locally \\',
      'REMOTE_CODEX_SESSION_SECRET=at-least-16-characters \\',
      'REMOTE_CODEX_RELAY_SERVER_URL=wss://relay.example.com \\',
      'REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_device_token_from_relay_portal \\',
      'HOST=127.0.0.1 PORT=8787 \\',
      'remote-codex relay-supervisor',
    ],
    validate: () => {
      const issues = [];
      if (process.env.REMOTE_CODEX_ADMIN_PASSWORD && process.env.REMOTE_CODEX_ADMIN_PASSWORD.length < 1) {
        issues.push('REMOTE_CODEX_ADMIN_PASSWORD must not be empty.');
      }
      if (process.env.REMOTE_CODEX_SESSION_SECRET && process.env.REMOTE_CODEX_SESSION_SECRET.length < 16) {
        issues.push('REMOTE_CODEX_SESSION_SECRET must be at least 16 characters.');
      }
      const relayUrl = process.env.REMOTE_CODEX_RELAY_SERVER_URL;
      if (relayUrl && !relayUrl.startsWith('ws://') && !relayUrl.startsWith('wss://')) {
        issues.push('REMOTE_CODEX_RELAY_SERVER_URL must start with ws:// or wss://.');
      }
      return issues;
    },
  };
  validateRequiredEnv(guidance);
  printEnvSummary(guidance);

  const supervisorEntry = fs.existsSync(supervisorDistEntry)
    ? supervisorDistEntry
    : supervisorSourceEntry;
  let commandToRun = process.execPath;
  let args = [supervisorEntry];

  if (!fs.existsSync(supervisorEntry)) {
    console.error('Supervisor API build artifacts are missing. Run `pnpm build` before using `remote-codex relay-supervisor`.');
    console.error(`Missing: ${path.relative(packageRoot, supervisorDistEntry)}`);
    process.exit(1);
  }

  if (supervisorEntry === supervisorSourceEntry) {
    const tsxEntry = path.join(packageRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (!fs.existsSync(tsxEntry)) {
      console.error('Supervisor API build artifacts are missing and tsx is not installed for source execution.');
      console.error('Run `pnpm build` or install dependencies with `pnpm install`.');
      process.exit(1);
    }
    args = [tsxEntry, supervisorSourceEntry];
  }

  const supervisor = spawn(commandToRun, args, {
    cwd: packageRoot,
    env: {
      ...process.env,
      REMOTE_CODEX_MODE: 'relay',
      REMOTE_CODEX_PACKAGE_ROOT: process.env.REMOTE_CODEX_PACKAGE_ROOT ?? packageRoot,
      REMOTE_CODEX_DISABLE_BUILD_RESTART:
        process.env.REMOTE_CODEX_DISABLE_BUILD_RESTART ?? (sourceCheckout ? 'false' : 'true'),
    },
    stdio: 'inherit',
  });

  supervisor.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    if (code && code !== 0) {
      console.error(`remote-codex relay-supervisor exited with code ${code}. Check the relay server URL, device token, local PORT, and environment values above.`);
    }
    process.exit(code ?? 1);
  });

  supervisor.on('error', (error) => {
    console.error(`Failed to run remote-codex relay-supervisor: ${error.message}`);
    process.exit(1);
  });
}

function validateRequiredEnv(input) {
  const missing = input.required
    .map(([name]) => name)
    .filter((name) => !nonEmptyEnv(name));
  const issues = input.validate?.() ?? [];

  if (missing.length === 0 && issues.length === 0) {
    return;
  }

  console.error(`${input.commandName} cannot start because its configuration is incomplete.`);
  console.error('');
  console.error(input.description);
  console.error('');
  console.error('Required:');
  for (const [name, description] of input.required) {
    const marker = missing.includes(name) ? 'missing' : 'set';
    console.error(`  ${name} (${marker})`);
    console.error(`    ${description}`);
  }

  if (input.recommended.length > 0) {
    console.error('');
    console.error('Recommended / optional:');
    for (const [name, description] of input.recommended) {
      console.error(`  ${name}`);
      console.error(`    ${description}`);
    }
  }

  if (issues.length > 0) {
    console.error('');
    console.error('Invalid values:');
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
  }

  console.error('');
  console.error('Example:');
  console.error(`  ${input.example.join('\n  ')}`);
  process.exit(1);
}

function printEnvSummary(input) {
  console.error(`${input.commandName} configuration:`);
  console.error(input.description);
  console.error('');
  console.error('Required:');
  for (const [name, description] of input.required) {
    console.error(`  ${name}: ${nonEmptyEnv(name) ? 'set' : 'missing'}`);
    console.error(`    ${description}`);
  }
  if (input.recommended.length > 0) {
    console.error('');
    console.error('Recommended / optional:');
    for (const [name, description] of input.recommended) {
      console.error(`  ${name}: ${nonEmptyEnv(name) ? 'set' : 'default/unset'}`);
      console.error(`    ${description}`);
    }
  }
  console.error('');
}

function nonEmptyEnv(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

function relayServerEnv() {
  const env = { ...process.env };
  for (const name of [
    'HOST',
    'PORT',
    'REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN',
    'REMOTE_CODEX_RELAY_CLIENT_TOKEN',
    'REMOTE_CODEX_ADMIN_EMAIL',
    'REMOTE_CODEX_RELAY_DATA_DIR',
    'REMOTE_CODEX_RELAY_SESSION_SECRET',
    'REMOTE_CODEX_RELAY_REGISTRATION_ENABLED',
    'REMOTE_CODEX_RELAY_WEB_DIST_DIR',
  ]) {
    if (typeof env[name] === 'string' && env[name].trim().length === 0) {
      delete env[name];
    }
  }
  return env;
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
  remote-codex relay-supervisor

Environment:
  SERVICE_HOST              Web listen host, default 127.0.0.1
  SERVICE_PORT              Web listen port, default ${defaultServicePort}
  SERVICE_API_HOST          API listen host, default 127.0.0.1
  SERVICE_API_PORT          API listen port, default ${defaultApiPort}
  REMOTE_CODEX_SERVICE_DIR  Service state and log directory, default ~/.remote-codex/service

Relay:
  remote-codex relay runs the public relay server.
  Required: REMOTE_CODEX_ADMIN_USERNAME, REMOTE_CODEX_ADMIN_PASSWORD
  Recommended: REMOTE_CODEX_RELAY_SESSION_SECRET, REMOTE_CODEX_RELAY_DATA_DIR,
               REMOTE_CODEX_RELAY_REGISTRATION_ENABLED, HOST, PORT

Relay supervisor:
  remote-codex relay-supervisor runs the private backend that connects to the relay.
  Required: REMOTE_CODEX_ADMIN_USERNAME, REMOTE_CODEX_ADMIN_PASSWORD,
            REMOTE_CODEX_SESSION_SECRET, REMOTE_CODEX_RELAY_SERVER_URL,
            REMOTE_CODEX_RELAY_AGENT_TOKEN
  Recommended: HOST, PORT, DATABASE_URL, WORKSPACE_ROOT, CODEX_HOME
`);
}
