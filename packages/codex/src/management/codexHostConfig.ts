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

export function isCodexFeatureEnabledFromConfig(content: string, featureName: string) {
  const escaped = featureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const featuresMatch = content.match(/^[^\S\r\n]*\[features\][^\S\r\n]*$/m);
  if (!featuresMatch || featuresMatch.index === undefined) {
    return false;
  }

  const sectionStart = featuresMatch.index + featuresMatch[0].length;
  const nextSectionMatch = content
    .slice(sectionStart)
    .match(/^[^\S\r\n]*\[[^\]\r\n]+\][^\S\r\n]*$/m);
  const sectionEnd =
    nextSectionMatch && nextSectionMatch.index !== undefined
      ? sectionStart + nextSectionMatch.index
      : content.length;
  const featuresBody = content.slice(sectionStart, sectionEnd);
  return new RegExp(`^\\s*${escaped}\\s*=\\s*true\\s*(?:#.*)?$`, 'm').test(featuresBody);
}

export async function readCodexFeatureFlag(
  codexHome: string,
  featureName: string,
) {
  try {
    const content = await fsp.readFile(resolveCodexConfigPath(codexHome), 'utf8');
    return isCodexFeatureEnabledFromConfig(content, featureName);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export function upsertCodexFeatureFlag(
  content: string,
  featureName: string,
  enabled: boolean,
) {
  const normalized = content.replace(/\r\n/g, '\n');
  const escaped = featureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const featuresMatch = normalized.match(/^[^\S\r\n]*\[features\][^\S\r\n]*$/m);
  const nextLine = `${featureName} = ${enabled ? 'true' : 'false'}`;

  if (!featuresMatch || featuresMatch.index === undefined) {
    const prefix = normalized.trimEnd();
    return prefix
      ? `${prefix}\n\n[features]\n${nextLine}\n`
      : `[features]\n${nextLine}\n`;
  }

  const sectionStart = featuresMatch.index + featuresMatch[0].length;
  const nextSectionMatch = normalized
    .slice(sectionStart)
    .match(/^[^\S\r\n]*\[[^\]\r\n]+\][^\S\r\n]*$/m);
  const sectionEnd =
    nextSectionMatch && nextSectionMatch.index !== undefined
      ? sectionStart + nextSectionMatch.index
      : normalized.length;
  const beforeSectionBody = normalized.slice(0, sectionStart);
  const sectionBody = normalized.slice(sectionStart, sectionEnd);
  const afterSection = normalized.slice(sectionEnd);
  const flagPattern = new RegExp(
    `(^[^\\S\\r\\n]*)${escaped}[^\\S\\r\\n]*=[^\\S\\r\\n]*(true|false)[^\\S\\r\\n]*(?:#.*)?$`,
    'm',
  );

  if (flagPattern.test(sectionBody)) {
    return (
      beforeSectionBody +
      sectionBody.replace(flagPattern, `$1${nextLine}`) +
      afterSection
    );
  }

  const bodyWithFlag = `${sectionBody.replace(/\n*$/, '')}\n${nextLine}\n`;
  const normalizedAfterSection = afterSection.startsWith('\n')
    ? afterSection
    : `\n${afterSection}`;
  return beforeSectionBody + bodyWithFlag + normalizedAfterSection;
}

export async function writeCodexFeatureFlag(
  codexHome: string,
  featureName: string,
  enabled: boolean,
) {
  const configPath = resolveCodexConfigPath(codexHome);
  let current = '';
  try {
    current = await fsp.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const next = upsertCodexFeatureFlag(current, featureName, enabled);
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, next, 'utf8');
  return next;
}
