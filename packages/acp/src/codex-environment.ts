import fs from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'smol-toml';

export async function loadCodexAcpEnvironment(
  codexHome: string | null | undefined,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
  codexPath: string | null | undefined = 'codex',
): Promise<NodeJS.ProcessEnv | undefined> {
  const normalizedHome = codexHome?.trim();
  const normalizedPath = inheritedEnv.CODEX_PATH?.trim() || codexPath?.trim();
  const env: NodeJS.ProcessEnv = {};
  if (normalizedPath) {
    env.CODEX_PATH = normalizedPath;
  }
  if (!normalizedHome) {
    return Object.keys(env).length > 0 ? env : undefined;
  }
  env.CODEX_HOME = normalizedHome;
  if (inheritedEnv.CODEX_CONFIG) {
    env.CODEX_CONFIG = inheritedEnv.CODEX_CONFIG;
    return env;
  }

  try {
    const source = await fs.readFile(path.join(normalizedHome, 'config.toml'), 'utf8');
    env.CODEX_CONFIG = JSON.stringify(parse(source));
  } catch {
    // Codex can still start with its own defaults when config is absent or invalid.
  }
  return env;
}
