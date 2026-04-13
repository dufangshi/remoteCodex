import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export type CodexServiceTier = 'fast' | null;
const SERVICE_TIER_LINE_GLOBAL_PATTERN =
  /^\s*service_tier\s*=\s*("fast"|"flex"|'fast'|'flex').*\n?/gm;

function resolveCodexConfigPath(codexHome: string) {
  return path.join(codexHome, 'config.toml');
}

export function parseCodexServiceTier(content: string): CodexServiceTier {
  const match = content.match(
    /^\s*service_tier\s*=\s*["'](?<tier>fast)["']\s*$/m,
  );
  const tier = match?.groups?.tier;
  return tier === 'fast' ? tier : null;
}

export function isFastModeEnabledFromConfig(content: string) {
  return parseCodexServiceTier(content) === 'fast';
}

export function readCodexFastModeSync(codexHome: string) {
  try {
    const content = fs.readFileSync(resolveCodexConfigPath(codexHome), 'utf8');
    return isFastModeEnabledFromConfig(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export function upsertCodexServiceTier(content: string, enabled: boolean) {
  const normalized = content.replace(/\r\n/g, '\n');
  const withoutServiceTier = normalized.replace(
    SERVICE_TIER_LINE_GLOBAL_PATTERN,
    '',
  );

  if (!enabled) {
    return withoutServiceTier.replace(/\n{3,}/g, '\n\n').trimEnd()
      + (withoutServiceTier.trim() ? '\n' : '');
  }

  const nextLine = 'service_tier = "fast"';
  if (!withoutServiceTier.trim()) {
    return `${nextLine}\n`;
  }

  const firstSectionMatch = withoutServiceTier.match(/^\s*\[[^\]]+\]/m);
  if (!firstSectionMatch || firstSectionMatch.index === undefined) {
    return withoutServiceTier.endsWith('\n')
      ? `${withoutServiceTier}${nextLine}\n`
      : `${withoutServiceTier}\n${nextLine}\n`;
  }

  const beforeFirstSection = withoutServiceTier.slice(0, firstSectionMatch.index).trimEnd();
  const afterFirstSection = withoutServiceTier
    .slice(firstSectionMatch.index)
    .replace(/^\n+/, '');
  return beforeFirstSection
    ? `${beforeFirstSection}\n${nextLine}\n${afterFirstSection}`
    : `${nextLine}\n${afterFirstSection}`;
}

export async function writeCodexFastMode(codexHome: string, enabled: boolean) {
  const configPath = resolveCodexConfigPath(codexHome);
  let current = '';
  try {
    current = await fsp.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const next = upsertCodexServiceTier(current, enabled);
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, next, 'utf8');
  return next;
}
