#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const binDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(binDir, '..');
const packageJsonPath = path.join(packageRoot, 'package.json');
const serviceManagerPath = path.join(packageRoot, 'scripts', 'service-manager.mjs');
const relayDistEntry = path.join(packageRoot, 'apps', 'relay-server', 'dist', 'index.js');
const relaySourceEntry = path.join(packageRoot, 'apps', 'relay-server', 'src', 'index.ts');
const supervisorDistEntry = path.join(packageRoot, 'apps', 'supervisor-api', 'dist', 'index.js');
const supervisorSourceEntry = path.join(packageRoot, 'apps', 'supervisor-api', 'src', 'index.ts');
const relaySupervisorConfigPath = process.env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG
  ? path.resolve(process.env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG)
  : path.join(os.homedir(), '.remote-codex', 'relay-supervisor.json');
const relaySupervisorTmuxSession = process.env.REMOTE_CODEX_RELAY_SUPERVISOR_TMUX_SESSION?.trim()
  || 'remote-codex-relay-supervisor';
const relaySupervisorConfigKeys = [
  'REMOTE_CODEX_RELAY_SERVER_URL',
  'REMOTE_CODEX_RELAY_AGENT_TOKEN',
  'REMOTE_CODEX_ADMIN_USERNAME',
  'REMOTE_CODEX_ADMIN_PASSWORD',
  'REMOTE_CODEX_SESSION_SECRET',
  'REMOTE_CODEX_RELAY_SUPERVISOR_HOST',
  'REMOTE_CODEX_RELAY_SUPERVISOR_PORT',
  'DATABASE_URL',
  'WORKSPACE_ROOT',
  'CODEX_HOME',
  'CODEX_COMMAND',
  'CLAUDE_HOME',
  'CLAUDE_COMMAND',
  'OPENCODE_HOME',
  'OPENCODE_COMMAND',
  'REMOTE_CODEX_ENABLED_AGENT_PROVIDERS',
  'LOG_LEVEL',
  'REMOTE_CODEX_E2E_FAKE_RUNTIME',
  'REMOTE_CODEX_DISABLE_BUILD_RESTART',
  'REMOTE_CODEX_PACKAGE_ROOT',
];
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
  await runRelaySupervisor();
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
      ['REMOTE_CODEX_RELAY_HOST', 'Relay listen host. Use 0.0.0.0 on a public server. Default 0.0.0.0. Falls back to HOST.'],
      ['REMOTE_CODEX_RELAY_PORT', 'Relay listen port. Default 8788. Falls back to PORT.'],
    ],
    example: [
      'REMOTE_CODEX_ADMIN_USERNAME=admin \\',
      'REMOTE_CODEX_ADMIN_PASSWORD=change-me-now \\',
      'REMOTE_CODEX_RELAY_SESSION_SECRET=at-least-16-characters \\',
      'REMOTE_CODEX_RELAY_DATA_DIR=/var/lib/remote-codex-relay \\',
      'REMOTE_CODEX_RELAY_REGISTRATION_ENABLED=false \\',
      'REMOTE_CODEX_RELAY_HOST=0.0.0.0 REMOTE_CODEX_RELAY_PORT=8788 \\',
      'remote-codex relay',
    ],
    effective: () => [
      [
        'Relay listen address',
        `${envValue(['REMOTE_CODEX_RELAY_HOST', 'HOST'], '0.0.0.0')}:${envValue(['REMOTE_CODEX_RELAY_PORT', 'PORT'], '8788')}`,
      ],
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
      console.error(`remote-codex relay exited with code ${code}. Check REMOTE_CODEX_RELAY_HOST/REMOTE_CODEX_RELAY_PORT and environment values above.`);
    }
    process.exit(code ?? 1);
  });

  relay.on('error', (error) => {
    console.error(`Failed to run remote-codex relay: ${error.message}`);
    process.exit(1);
  });
}

async function runRelaySupervisor() {
  const action = process.argv[3] ?? 'start';
  if (action === 'reset') {
    resetRelaySupervisorConfig();
    return;
  }
  if (action === 'status') {
    relaySupervisorStatus();
    return;
  }
  if (action === 'stop') {
    stopRelaySupervisorTmux();
    return;
  }
  if (action !== 'start' && action !== 'run') {
    console.error(`Unknown relay-supervisor action: ${action}`);
    console.error('Use one of: start, run, status, stop, reset.');
    process.exit(1);
  }
  await ensureRelaySupervisorConfig();
  if (action === 'start' && shouldStartRelaySupervisorInTmux()) {
    startRelaySupervisorTmux();
    return;
  }
  runRelaySupervisorForeground();
}

function runRelaySupervisorForeground() {
  const guidance = {
    commandName: 'remote-codex relay-supervisor',
    description: 'Run the private-machine supervisor backend that connects outward to a public relay.',
    required: [
      ['REMOTE_CODEX_ADMIN_USERNAME', 'Private supervisor admin username. Defaults to a saved local value.'],
      ['REMOTE_CODEX_ADMIN_PASSWORD', 'Private supervisor admin password. Defaults to a saved generated value.'],
      ['REMOTE_CODEX_SESSION_SECRET', 'Private supervisor session signing secret. Defaults to a saved generated value.'],
      ['REMOTE_CODEX_RELAY_SERVER_URL', 'Public relay websocket base URL, for example ws://host:8788 or wss://relay.example.com.'],
      ['REMOTE_CODEX_RELAY_AGENT_TOKEN', 'Device token created in the relay portal. This is not the relay admin password.'],
    ],
    recommended: [
      ['REMOTE_CODEX_RELAY_SUPERVISOR_HOST', 'Private supervisor listen host. Default 127.0.0.1. Falls back to HOST.'],
      ['REMOTE_CODEX_RELAY_SUPERVISOR_PORT', 'Private supervisor listen port. Default 8787. Falls back to PORT.'],
      ['DATABASE_URL', 'SQLite database path. Set this when running a separate backend beside another Remote Codex.'],
      ['WORKSPACE_ROOT', 'Root directory that workspace paths must live under. Default is your home directory.'],
      ['CODEX_HOME', 'Codex config directory. Default ~/.codex.'],
    ],
    example: [
      'remote-codex relay-supervisor',
      '# foreground/debug mode:',
      'remote-codex relay-supervisor run',
      '# or reset saved interactive configuration:',
      'remote-codex relay-supervisor reset',
    ],
    effective: () => [
      [
        'Private supervisor listen address',
        `${envValue(['REMOTE_CODEX_RELAY_SUPERVISOR_HOST', 'HOST'], '127.0.0.1')}:${envValue(['REMOTE_CODEX_RELAY_SUPERVISOR_PORT', 'PORT'], '8787')}`,
      ],
      ['Relay server URL', envValue(['REMOTE_CODEX_RELAY_SERVER_URL'], 'missing')],
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
      console.error(`remote-codex relay-supervisor exited with code ${code}. Check the relay server URL, device token, local REMOTE_CODEX_RELAY_SUPERVISOR_PORT, and environment values above.`);
    }
    process.exit(code ?? 1);
  });

  supervisor.on('error', (error) => {
    console.error(`Failed to run remote-codex relay-supervisor: ${error.message}`);
    process.exit(1);
  });
}

function shouldStartRelaySupervisorInTmux() {
  const setting = process.env.REMOTE_CODEX_RELAY_SUPERVISOR_TMUX?.trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(setting ?? '')) {
    return false;
  }
  if (process.env.TMUX) {
    return false;
  }
  return commandExists('tmux');
}

function startRelaySupervisorTmux() {
  persistRelaySupervisorRuntimeConfig();
  if (tmuxSessionExists(relaySupervisorTmuxSession)) {
    console.log(`remote-codex relay-supervisor is already running in tmux session: ${relaySupervisorTmuxSession}`);
    printRelaySupervisorTmuxCommands();
    return;
  }

  const command = relaySupervisorTmuxCommand();
  const result = spawnSync('tmux', ['new-session', '-d', '-s', relaySupervisorTmuxSession, command], {
    cwd: packageRoot,
    env: relaySupervisorTmuxLaunchEnv(),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    console.error('Failed to start relay-supervisor in tmux.');
    if (result.stderr?.trim()) {
      console.error(result.stderr.trim());
    }
    console.error('Falling back to foreground mode.');
    runRelaySupervisorForeground();
    return;
  }

  console.log(`Started remote-codex relay-supervisor in tmux session: ${relaySupervisorTmuxSession}`);
  printRelaySupervisorTmuxCommands();
}

function relaySupervisorTmuxCommand() {
  const envPrefix = nonEmptyEnv('REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG')
    ? `REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG=${shellQuote(process.env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG)}`
    : '';
  const command = `${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(import.meta.url))} relay-supervisor run`;
  return envPrefix ? `${envPrefix} ${command}` : command;
}

function relaySupervisorTmuxLaunchEnv() {
  const env = {};
  for (const name of ['PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM']) {
    if (nonEmptyEnv(name)) {
      env[name] = process.env[name];
    }
  }
  if (nonEmptyEnv('REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG')) {
    env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG = process.env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG;
  }
  return env;
}

function relaySupervisorStatus() {
  if (!commandExists('tmux')) {
    console.log('tmux is not installed; no managed relay-supervisor session can be inspected.');
    process.exit(1);
  }
  if (!tmuxSessionExists(relaySupervisorTmuxSession)) {
    console.log(`remote-codex relay-supervisor is not running in tmux session: ${relaySupervisorTmuxSession}`);
    process.exit(1);
  }
  console.log(`remote-codex relay-supervisor is running in tmux session: ${relaySupervisorTmuxSession}`);
  printRelaySupervisorTmuxCommands();
}

function stopRelaySupervisorTmux() {
  if (!commandExists('tmux')) {
    console.log('tmux is not installed; no managed relay-supervisor session can be stopped.');
    return;
  }
  if (!tmuxSessionExists(relaySupervisorTmuxSession)) {
    console.log(`remote-codex relay-supervisor is not running in tmux session: ${relaySupervisorTmuxSession}`);
    return;
  }
  const result = spawnSync('tmux', ['kill-session', '-t', relaySupervisorTmuxSession], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(`Failed to stop tmux session: ${relaySupervisorTmuxSession}`);
    if (result.stderr?.trim()) {
      console.error(result.stderr.trim());
    }
    process.exit(1);
  }
  console.log(`Stopped remote-codex relay-supervisor tmux session: ${relaySupervisorTmuxSession}`);
}

function printRelaySupervisorTmuxCommands() {
  console.log(`Attach logs: tmux attach -t ${shellQuote(relaySupervisorTmuxSession)}`);
  console.log('Status:      remote-codex relay-supervisor status');
  console.log('Stop:        remote-codex relay-supervisor stop');
}

function tmuxSessionExists(sessionName) {
  const result = spawnSync('tmux', ['has-session', '-t', sessionName], {
    cwd: packageRoot,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function commandExists(commandName) {
  const result = spawnSync(commandName, ['-V'], {
    cwd: packageRoot,
    stdio: 'ignore',
  });
  return result.error?.code !== 'ENOENT';
}

async function ensureRelaySupervisorConfig() {
  const existing = readRelaySupervisorConfig();
  const generated = {
    REMOTE_CODEX_ADMIN_USERNAME: 'admin',
    REMOTE_CODEX_ADMIN_PASSWORD: randomSecret(24),
    REMOTE_CODEX_SESSION_SECRET: randomSecret(32),
    DATABASE_URL: path.join(os.homedir(), '.remote-codex', 'relay-supervisor.sqlite'),
  };
  const config = { ...generated, ...existing };
  for (const [name, value] of Object.entries(config)) {
    if (!nonEmptyEnv(name) && typeof value === 'string' && value.trim().length > 0) {
      process.env[name] = value;
    }
  }

  const needsRelayUrl = !nonEmptyEnv('REMOTE_CODEX_RELAY_SERVER_URL');
  const needsAgentToken = !nonEmptyEnv('REMOTE_CODEX_RELAY_AGENT_TOKEN');
  if (!needsRelayUrl && !needsAgentToken) {
    persistRelaySupervisorRuntimeConfig(config);
    return;
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    persistRelaySupervisorRuntimeConfig(config);
    return;
  }

  console.error('remote-codex relay-supervisor needs relay connection details.');
  console.error(`Answers will be saved to ${relaySupervisorConfigPath}.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    if (needsRelayUrl) {
      process.env.REMOTE_CODEX_RELAY_SERVER_URL = await promptRelaySupervisorValue(
        rl,
        'Relay websocket URL (ws:// or wss://): ',
        (value) => value.startsWith('ws://') || value.startsWith('wss://'),
        'Relay websocket URL must start with ws:// or wss://.',
      );
    }
    if (needsAgentToken) {
      process.env.REMOTE_CODEX_RELAY_AGENT_TOKEN = await promptRelaySupervisorValue(
        rl,
        'Relay device token: ',
        (value) => value.length > 0,
        'Relay device token must not be empty.',
      );
    }
  } finally {
    rl.close();
  }

  persistRelaySupervisorRuntimeConfig(config);
}

async function promptRelaySupervisorValue(rl, prompt, validate, invalidMessage) {
  while (true) {
    const value = (await rl.question(prompt)).trim();
    if (validate(value)) {
      return value;
    }
    console.error(invalidMessage);
  }
}

function readRelaySupervisorConfig() {
  try {
    return JSON.parse(fs.readFileSync(relaySupervisorConfigPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`Ignoring invalid relay-supervisor config at ${relaySupervisorConfigPath}: ${error.message}`);
    }
    return {};
  }
}

function writeRelaySupervisorConfig(config) {
  fs.mkdirSync(path.dirname(relaySupervisorConfigPath), { recursive: true });
  fs.writeFileSync(relaySupervisorConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(relaySupervisorConfigPath, 0o600);
  } catch {
    // Best-effort on filesystems that do not support chmod.
  }
}

function persistRelaySupervisorRuntimeConfig(base = readRelaySupervisorConfig()) {
  const config = { ...base };
  for (const name of relaySupervisorConfigKeys) {
    if (nonEmptyEnv(name)) {
      config[name] = process.env[name];
    }
  }
  writeRelaySupervisorConfig(config);
}

function resetRelaySupervisorConfig() {
  try {
    fs.unlinkSync(relaySupervisorConfigPath);
    console.log(`Deleted relay-supervisor config: ${relaySupervisorConfigPath}`);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.log(`No relay-supervisor config found at ${relaySupervisorConfigPath}`);
      return;
    }
    console.error(`Failed to delete relay-supervisor config: ${error.message}`);
    process.exit(1);
  }
}

function randomSecret(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
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
  const effective = input.effective?.() ?? [];
  if (effective.length > 0) {
    console.error('Effective values:');
    for (const [label, value] of effective) {
      console.error(`  ${label}: ${value}`);
    }
    console.error('');
  }
  console.error('Required:');
  for (const [name, description] of input.required) {
    console.error(`  ${name}: ${envStatusLabel(name, 'missing')}`);
    console.error(`    ${description}`);
  }
  if (input.recommended.length > 0) {
    console.error('');
    console.error('Recommended / optional:');
    for (const [name, description] of input.recommended) {
      console.error(`  ${name}: ${envStatusLabel(name, 'unset')}`);
      console.error(`    ${description}`);
    }
  }
  console.error('');
}

function envStatusLabel(name, missingLabel) {
  const directValue = cleanEnvValue(name);
  if (directValue) {
    return isSensitiveEnvName(name) ? 'set' : `set: ${directValue}`;
  }

  const fallback = envFallbackFor(name);
  if (fallback) {
    for (const fallbackName of fallback.names) {
      const fallbackValue = cleanEnvValue(fallbackName);
      if (fallbackValue) {
        return isSensitiveEnvName(name) ? `fallback from ${fallbackName}` : `fallback from ${fallbackName}: ${fallbackValue}`;
      }
    }

    if (fallback.defaultValue) {
      return `default: ${fallback.defaultValue}`;
    }
  }

  return missingLabel;
}

function envFallbackFor(name) {
  switch (name) {
    case 'REMOTE_CODEX_RELAY_DATA_DIR':
      return { names: [], defaultValue: '.local/relay-server' };
    case 'REMOTE_CODEX_RELAY_HOST':
      return { names: ['HOST'], defaultValue: '0.0.0.0' };
    case 'REMOTE_CODEX_RELAY_PORT':
      return { names: ['PORT'], defaultValue: '8788' };
    case 'REMOTE_CODEX_RELAY_SUPERVISOR_HOST':
      return { names: ['HOST'], defaultValue: '127.0.0.1' };
    case 'REMOTE_CODEX_RELAY_SUPERVISOR_PORT':
      return { names: ['PORT'], defaultValue: '8787' };
    case 'DATABASE_URL':
      return { names: [], defaultValue: `sqlite://${path.join('.local', 'remote-codex-relay-supervisor.sqlite')}` };
    case 'WORKSPACE_ROOT':
      return { names: [], defaultValue: os.homedir() };
    case 'CODEX_HOME':
      return { names: [], defaultValue: path.join(os.homedir(), '.codex') };
    default:
      return null;
  }
}

function cleanEnvValue(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isSensitiveEnvName(name) {
  return /PASSWORD|SECRET|TOKEN/i.test(name);
}

function nonEmptyEnv(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

function envValue(names, defaultValue) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return defaultValue;
}

function shellQuote(value) {
  const stringValue = String(value ?? '');
  if (/^[A-Za-z0-9_./:@%+=,~-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `'${stringValue.replace(/'/g, `'\\''`)}'`;
}

function relayServerEnv() {
  const env = { ...process.env };
  for (const name of [
    'HOST',
    'PORT',
    'REMOTE_CODEX_RELAY_HOST',
    'REMOTE_CODEX_RELAY_PORT',
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
  REMOTE_CODEX_RELAY_HOST
    Relay listen host. Default 0.0.0.0. Use 0.0.0.0 on a public server.
    Falls back to HOST for legacy scripts.
  REMOTE_CODEX_RELAY_PORT
    Relay listen port. Default 8788. Falls back to PORT for legacy scripts.
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
  REMOTE_CODEX_RELAY_HOST=0.0.0.0 REMOTE_CODEX_RELAY_PORT=8788 \\
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
  remote-codex relay-supervisor run
  remote-codex relay-supervisor status
  remote-codex relay-supervisor stop
  remote-codex relay-supervisor reset

This command automatically sets for the child supervisor:
  REMOTE_CODEX_MODE=relay

Default process management:
  By default, this command tries to start the supervisor in a detached tmux
  session named "${relaySupervisorTmuxSession}" so the device stays online
  after the launching terminal closes. If tmux is not installed, or if
  REMOTE_CODEX_RELAY_SUPERVISOR_TMUX=0 is set, it runs in the foreground.

  Use "remote-codex relay-supervisor run" for explicit foreground/debug mode.
  Use "remote-codex relay-supervisor status" to inspect the tmux session.
  Use "remote-codex relay-supervisor stop" to stop the tmux session.

Interactive setup:
  When REMOTE_CODEX_RELAY_SERVER_URL or REMOTE_CODEX_RELAY_AGENT_TOKEN is
  missing and stdin is interactive, the command asks for those values and saves
  them to:
    ${relaySupervisorConfigPath}

  The saved config also includes generated local supervisor auth/session values
  and copied setup values such as REMOTE_CODEX_RELAY_SUPERVISOR_PORT, so the
  tmux child process can start with the same effective configuration.

  Use "remote-codex relay-supervisor reset" to delete the saved config.

Environment overrides:
  REMOTE_CODEX_RELAY_SERVER_URL
    Public relay websocket base URL. Use ws://host:port for plain relay ports or
    wss://relay.example.com behind TLS.
  REMOTE_CODEX_RELAY_AGENT_TOKEN
    Device token created in the relay portal. This is not the relay admin password.
  REMOTE_CODEX_ADMIN_USERNAME
    Private supervisor admin username. Defaults to saved "admin".
  REMOTE_CODEX_ADMIN_PASSWORD
    Private supervisor admin password. Defaults to a saved generated value.
  REMOTE_CODEX_SESSION_SECRET
    Private supervisor session signing secret. Defaults to a saved generated value.

Recommended environment:
  REMOTE_CODEX_RELAY_SUPERVISOR_HOST
    Private supervisor listen host. Default 127.0.0.1.
    Falls back to HOST for legacy scripts.
  REMOTE_CODEX_RELAY_SUPERVISOR_PORT
    Private supervisor listen port. Default 8787. Falls back to PORT for legacy scripts.
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
  REMOTE_CODEX_RELAY_SUPERVISOR_TMUX
    Set to 0/false/no/off to disable default tmux management.
  REMOTE_CODEX_RELAY_SUPERVISOR_TMUX_SESSION
    tmux session name. Default ${relaySupervisorTmuxSession}.

Example:
  remote-codex relay-supervisor

Foreground/debug example:
  remote-codex relay-supervisor run

Management:
  remote-codex relay-supervisor status
  remote-codex relay-supervisor stop

Non-interactive example:
  REMOTE_CODEX_RELAY_SERVER_URL=wss://relay.example.com \\
  REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_device_token_from_relay_portal \\
  remote-codex relay-supervisor

When running a separate test backend beside an existing Remote Codex service,
set separate values for:
  REMOTE_CODEX_RELAY_SUPERVISOR_PORT
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
