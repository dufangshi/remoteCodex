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
const commandHelpTarget =
  command === 'help'
    ? normalizeHelpTarget(process.argv[3])
    : hasHelpFlag(process.argv.slice(3))
      ? command
      : null;

if (commandHelpTarget) {
  printCommandHelp(commandHelpTarget);
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

function normalizeHelpTarget(value) {
  if (!value || value === '-h' || value === '--help') {
    return 'help';
  }

  return normalizeCommand(value);
}

function hasHelpFlag(values) {
  return values.includes('-h') || values.includes('--help');
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return String(packageJson.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

function printCommandHelp(target) {
  switch (target) {
    case 'start':
      printStartHelp();
      return;
    case 'status':
      printStatusHelp();
      return;
    case 'stop':
      printStopHelp();
      return;
    case 'relay':
      printRelayHelp();
      return;
    case 'relay-supervisor':
      printRelaySupervisorHelp();
      return;
    case 'version':
      printVersionHelp();
      return;
    case 'help':
    default:
      printHelp();
  }
}

function printHelp() {
  console.log(`remote-codex ${readPackageVersion()}

Local and relayable web supervisor for Codex workspaces and threads.

Usage:
  remote-codex <command>
  remote-codex <command> --help

Commands:
  start             Start the normal local web app and supervisor API.
  status            Print status for the normal local service.
  stop              Stop the normal local service.
  relay             Run the public relay server for browsers/apps.
  relay-supervisor  Run the private supervisor backend that connects to a relay.
  version           Print the installed remote-codex package version.
  help [command]    Show global help or help for a command.

Common workflows:
  Local/LAN or Tailscale:
    remote-codex start

  Public relay server:
    remote-codex relay

  Private machine connecting outward to that relay:
    remote-codex relay-supervisor

Command help:
  remote-codex start --help
  remote-codex relay --help
  remote-codex relay-supervisor --help

Modes:
  local             Default supervisor mode. No Remote Codex login is required.
  server            Directly reachable supervisor. Requires admin auth.
  relay             Private supervisor connects outward to public relay.

Files and defaults:
  .env is loaded from the installed package/source root when present.
  Source checkout service dir defaults to .local/service.
  npm-installed service dir defaults to ~/.remote-codex/service.

Docs:
  docs/auth-and-connectivity-modes.md
`);
}

function printStartHelp() {
  console.log(`remote-codex start

Start the normal local Remote Codex service: one supervisor API process plus one
web process. This is the recommended command for local development, LAN access,
or Tailscale access.

Usage:
  remote-codex start
  remote-codex service:start

What it starts:
  Web UI       http://SERVICE_HOST:SERVICE_PORT
  API          http://SERVICE_API_HOST:SERVICE_API_PORT

Environment:
  SERVICE_HOST              Web listen host. Default 127.0.0.1.
  SERVICE_PORT              Web listen port. Default ${defaultServicePort}.
  SERVICE_API_HOST          API listen host. Default 127.0.0.1.
  SERVICE_API_PORT          API listen port. Default ${defaultApiPort}.
  REMOTE_CODEX_SERVICE_DIR  Service state/log directory.
  LOG_LEVEL                 API log level. Default warn for service mode.
  DISABLE_REQUEST_LOGGING   true/false. Default true for service mode.

Supervisor configuration forwarded to the API:
  REMOTE_CODEX_MODE         local, server, or relay. Default local.
  WORKSPACE_ROOT            Root directory for workspaces. Default home dir.
  DATABASE_URL              SQLite database path.
  CODEX_HOME                Codex config directory. Default ~/.codex.
  CODEX_COMMAND             Codex executable. Default codex.
  CLAUDE_HOME               Claude config directory. Default ~/.claude.
  CLAUDE_COMMAND            Claude executable. Default claude.
  OPENCODE_HOME             OpenCode config directory. Default ~/.opencode.
  OPENCODE_COMMAND          OpenCode executable. Default opencode.

Example:
  SERVICE_HOST=127.0.0.1 SERVICE_PORT=4173 remote-codex start

Expose over Tailscale after start:
  tailscale serve --bg http://127.0.0.1:${defaultServicePort}
`);
}

function printStatusHelp() {
  console.log(`remote-codex status

Print status for the normal local service started by remote-codex start.

Usage:
  remote-codex status
  remote-codex service:status

Output includes:
  API process pid and health
  Web process pid and health
  Service URLs
  Log directory

Environment:
  REMOTE_CODEX_SERVICE_DIR  Service state/log directory to inspect.
`);
}

function printStopHelp() {
  console.log(`remote-codex stop

Stop the normal local service started by remote-codex start.

Usage:
  remote-codex stop
  remote-codex service:stop

Environment:
  REMOTE_CODEX_SERVICE_DIR  Service state/log directory to stop.
`);
}

function printRelayHelp() {
  console.log(`remote-codex relay

Run the public relay server. This command is intended for a VPS or server that
browsers and mobile apps can reach. It serves the relay portal/admin UI and
forwards allowed API/WebSocket traffic to private machines connected with
remote-codex relay-supervisor.

Usage:
  remote-codex relay

Required environment:
  REMOTE_CODEX_ADMIN_USERNAME
    Initial relay admin username, for example admin.
  REMOTE_CODEX_ADMIN_PASSWORD
    Initial relay admin password. Must be at least 8 characters.

Recommended environment:
  REMOTE_CODEX_RELAY_SESSION_SECRET
    Relay session signing secret. Must be at least 16 characters. Defaults to
    REMOTE_CODEX_ADMIN_PASSWORD when omitted.
  REMOTE_CODEX_RELAY_DATA_DIR
    Persistent user/device/share store. Default .local/relay-server.
  REMOTE_CODEX_RELAY_REGISTRATION_ENABLED
    true/false. Default true. Use false when only admins should create users.
  HOST
    Relay listen host. Default 0.0.0.0. Use 0.0.0.0 on a public server.
  PORT
    Relay listen port. Default 8788.
  REMOTE_CODEX_ADMIN_EMAIL
    Optional seeded admin email. Defaults to <username>@relay.local.
  REMOTE_CODEX_RELAY_WEB_DIST_DIR
    Optional web dist override. Defaults to packaged supervisor-web/dist.
  REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN
    Optional legacy bootstrap token. Prefer per-device tokens from the portal.
  REMOTE_CODEX_RELAY_CLIENT_TOKEN
    Optional legacy client token. Prefer relay user sessions.

Example:
  REMOTE_CODEX_ADMIN_USERNAME=admin \\
  REMOTE_CODEX_ADMIN_PASSWORD=change-me-now \\
  REMOTE_CODEX_RELAY_SESSION_SECRET=at-least-16-characters \\
  REMOTE_CODEX_RELAY_DATA_DIR=/var/lib/remote-codex-relay \\
  REMOTE_CODEX_RELAY_REGISTRATION_ENABLED=false \\
  HOST=0.0.0.0 PORT=8788 \\
  remote-codex relay

After start:
  Relay health:  GET /healthz
  Portal:        /relay-portal
  Admin:         /relay-admin
  Device API:    /relay/devices/:deviceId/api/...
  Device WS:     /relay/devices/:deviceId/ws

Typical flow:
  1. Start remote-codex relay on the public server.
  2. Log in to /relay-portal as the seeded admin.
  3. Create a device and copy its rcd_... token.
  4. Put that token into REMOTE_CODEX_RELAY_AGENT_TOKEN on the private machine.
  5. Start remote-codex relay-supervisor on the private machine.
`);
}

function printRelaySupervisorHelp() {
  console.log(`remote-codex relay-supervisor

Run the private-machine supervisor backend in relay mode. This is the process
that has local workspace access and runs Codex. It does not expose itself to the
public internet; it connects outward to a public relay server.

Usage:
  remote-codex relay-supervisor

This command automatically sets for the child supervisor:
  REMOTE_CODEX_MODE=relay

Required environment:
  REMOTE_CODEX_ADMIN_USERNAME
    Private supervisor admin username. Required because relay mode enables API auth.
  REMOTE_CODEX_ADMIN_PASSWORD
    Private supervisor admin password.
  REMOTE_CODEX_SESSION_SECRET
    Private supervisor session signing secret. Must be at least 16 characters.
  REMOTE_CODEX_RELAY_SERVER_URL
    Public relay websocket base URL. Use ws://host:port for plain relay ports or
    wss://relay.example.com behind TLS.
  REMOTE_CODEX_RELAY_AGENT_TOKEN
    Device token created in the relay portal. This is not the relay admin password.

Recommended environment:
  HOST
    Private supervisor listen host. Default 127.0.0.1.
  PORT
    Private supervisor listen port. Default 8787.
  DATABASE_URL
    SQLite database path. Set this when running beside another Remote Codex.
  WORKSPACE_ROOT
    Root directory that workspace paths must live under. Default home directory.
  CODEX_HOME
    Codex config directory. Default ~/.codex.
  CODEX_COMMAND
    Codex executable. Default codex.
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS
    Comma-separated provider ids, for example codex,claude.

Example:
  REMOTE_CODEX_ADMIN_USERNAME=admin \\
  REMOTE_CODEX_ADMIN_PASSWORD=change-me-locally \\
  REMOTE_CODEX_SESSION_SECRET=at-least-16-characters \\
  REMOTE_CODEX_RELAY_SERVER_URL=wss://relay.example.com \\
  REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_device_token_from_relay_portal \\
  HOST=127.0.0.1 PORT=8787 \\
  DATABASE_URL=$HOME/.remote-codex/relay-supervisor.sqlite \\
  remote-codex relay-supervisor

When running a separate test backend beside an existing Remote Codex service,
set separate values for:
  PORT
  DATABASE_URL
  WORKSPACE_ROOT

The relay server will report supervisorConnected=true on /healthz after this
process connects successfully.
`);
}

function printVersionHelp() {
  console.log(`remote-codex version

Print the installed remote-codex package version.

Usage:
  remote-codex version
  remote-codex --version
  remote-codex -v
`);
}
