import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  configureWindowsDeviceManagerEnvironment,
  ENABLED_AGENT_PROVIDERS_ENV,
  includeAgentProviders,
  WINDOWS_DEVICE_MANAGER_ENV,
} from '../../bin/relay-supervisor-environment.mjs';

const homeDirectory = 'C:\\Users\\remote-codex-test';
const localAppData = path.win32.join(homeDirectory, 'AppData', 'Local');
const defaultConfigPath = path.win32.join(
  homeDirectory,
  '.remote-codex',
  'relay-supervisor.json',
);
const managerRoot = path.win32.join(
  localAppData,
  'RemoteCodex',
  'DeviceManager',
);
const installedManagerPaths = new Set([
  path.win32.join(managerRoot, 'RemoteCodex.DeviceManager.exe').toLowerCase(),
  path.win32.join(managerRoot, 'settings.json').toLowerCase(),
]);

function configure({
  env = {},
  savedConfig = {},
  configPath = defaultConfigPath,
  platform = 'win32',
  installedPaths = installedManagerPaths,
} = {}) {
  const mutableEnvironment = { LOCALAPPDATA: localAppData, ...env };
  const managed = configureWindowsDeviceManagerEnvironment({
    env: mutableEnvironment,
    savedConfig,
    configPath,
    homeDirectory,
    platform,
    pathExists(candidate) {
      return installedPaths.has(path.win32.resolve(candidate).toLowerCase());
    },
  });
  return { managed, env: mutableEnvironment };
}

test('migrates the legacy Windows manager provider list', () => {
  const result = configure({
    env: { [ENABLED_AGENT_PROVIDERS_ENV]: 'codex' },
  });

  assert.equal(result.managed, true);
  assert.equal(result.env[WINDOWS_DEVICE_MANAGER_ENV], '1');
  assert.equal(result.env[ENABLED_AGENT_PROVIDERS_ENV], 'codex,acp');
});

test('uses a saved manager marker after the legacy installation is removed', () => {
  const result = configure({
    savedConfig: {
      [WINDOWS_DEVICE_MANAGER_ENV]: 'true',
      [ENABLED_AGENT_PROVIDERS_ENV]: 'codex,claude',
    },
    installedPaths: new Set(),
  });

  assert.equal(result.managed, true);
  assert.equal(result.env[ENABLED_AGENT_PROVIDERS_ENV], 'codex,claude,acp');
});

test('preserves an explicitly marked manager environment and provider order', () => {
  const result = configure({
    env: {
      [WINDOWS_DEVICE_MANAGER_ENV]: '1',
      [ENABLED_AGENT_PROVIDERS_ENV]: 'ACP, codex,opencode',
    },
    installedPaths: new Set(),
  });

  assert.equal(result.managed, true);
  assert.equal(result.env[ENABLED_AGENT_PROVIDERS_ENV], 'ACP,codex,opencode');
});

test('does not change a manually managed Windows supervisor', () => {
  const result = configure({
    env: { [ENABLED_AGENT_PROVIDERS_ENV]: 'codex' },
    configPath: 'C:\\remote-codex-test\\custom-supervisor.json',
  });

  assert.equal(result.managed, false);
  assert.equal(result.env[WINDOWS_DEVICE_MANAGER_ENV], undefined);
  assert.equal(result.env[ENABLED_AGENT_PROVIDERS_ENV], 'codex');
});

test('does not apply Windows manager compatibility on other platforms', () => {
  const result = configure({
    env: { [WINDOWS_DEVICE_MANAGER_ENV]: '1' },
    platform: 'linux',
  });

  assert.equal(result.managed, false);
  assert.equal(result.env[ENABLED_AGENT_PROVIDERS_ENV], undefined);
});

test('adds required providers without case-insensitive duplicates', () => {
  assert.equal(
    includeAgentProviders('Codex,ACP,claude', ['codex', 'acp']),
    'Codex,ACP,claude',
  );
});
