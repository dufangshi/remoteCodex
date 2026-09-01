import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WINDOWS_DEVICE_MANAGER_ENV = 'REMOTE_CODEX_WINDOWS_DEVICE_MANAGER';
export const ENABLED_AGENT_PROVIDERS_ENV =
  'REMOTE_CODEX_ENABLED_AGENT_PROVIDERS';

const WINDOWS_DEVICE_MANAGER_REQUIRED_PROVIDERS = ['codex', 'acp'];

export function configureWindowsDeviceManagerEnvironment({
  env = process.env,
  savedConfig = {},
  configPath,
  homeDirectory = os.homedir(),
  platform = process.platform,
  pathExists = fs.existsSync,
} = {}) {
  if (platform !== 'win32') {
    return false;
  }

  const explicitlyManaged =
    isEnabled(env[WINDOWS_DEVICE_MANAGER_ENV]) ||
    isEnabled(savedConfig[WINDOWS_DEVICE_MANAGER_ENV]);
  const legacyManagerInstalled = isLegacyWindowsDeviceManagerConfig({
    env,
    configPath,
    homeDirectory,
    pathExists,
  });
  if (!explicitlyManaged && !legacyManagerInstalled) {
    return false;
  }

  const configuredProviders =
    nonEmptyString(env[ENABLED_AGENT_PROVIDERS_ENV]) ??
    nonEmptyString(savedConfig[ENABLED_AGENT_PROVIDERS_ENV]) ??
    '';
  env[WINDOWS_DEVICE_MANAGER_ENV] = '1';
  env[ENABLED_AGENT_PROVIDERS_ENV] = includeAgentProviders(
    configuredProviders,
    WINDOWS_DEVICE_MANAGER_REQUIRED_PROVIDERS,
  );
  return true;
}

export function includeAgentProviders(value, requiredProviders) {
  const providers = String(value ?? '')
    .split(',')
    .map((provider) => provider.trim())
    .filter(Boolean);
  const normalized = new Set(
    providers.map((provider) => provider.toLowerCase()),
  );
  for (const requiredProvider of requiredProviders) {
    const key = requiredProvider.toLowerCase();
    if (!normalized.has(key)) {
      providers.push(requiredProvider);
      normalized.add(key);
    }
  }
  return providers.join(',');
}

function isLegacyWindowsDeviceManagerConfig({
  env,
  configPath,
  homeDirectory,
  pathExists,
}) {
  const localAppData = nonEmptyString(env.LOCALAPPDATA);
  if (
    !localAppData ||
    !nonEmptyString(configPath) ||
    !nonEmptyString(homeDirectory)
  ) {
    return false;
  }

  const defaultConfigPath = path.win32.join(
    homeDirectory,
    '.remote-codex',
    'relay-supervisor.json',
  );
  if (!sameWindowsPath(configPath, defaultConfigPath)) {
    return false;
  }

  const managerRoot = path.win32.join(
    localAppData,
    'RemoteCodex',
    'DeviceManager',
  );
  return (
    pathExists(path.win32.join(managerRoot, 'RemoteCodex.DeviceManager.exe')) &&
    pathExists(path.win32.join(managerRoot, 'settings.json'))
  );
}

function sameWindowsPath(left, right) {
  try {
    return (
      path.win32.resolve(left).toLowerCase() ===
      path.win32.resolve(right).toLowerCase()
    );
  } catch {
    return false;
  }
}

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}
