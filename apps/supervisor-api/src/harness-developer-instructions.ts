import type { RuntimeConfig } from '../../../packages/config/src/index';

export function harnessDeveloperInstructions(config: RuntimeConfig) {
  if (
    config.runtimeRole !== 'worker' ||
    !config.harnessEnabled ||
    !config.chemistryToolsEnabled ||
    !config.harnessBaseUrl
  ) {
    return null;
  }

  const baseUrl = config.harnessBaseUrl.replace(/\/+$/, '');
  return [
    `ElAgente Harness chemistry tools are available at ${baseUrl}.`,
    'For chemistry tasks, call its HTTP API directly using the sandbox env var INACT_X_APP_KEY as the x-api-key header; never print or expose that key.',
    'Discover tools with GET /, GET /farmaco/tools, GET /farmaco/.help, GET /quntur/tools, or GET /estructural/tools; invoke approved tools with POST /{module}/tools/{tool} using JSON input.',
  ].join(' ');
}

export function combineDeveloperInstructions(parts: Array<string | null | undefined>) {
  const normalized = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return normalized.length > 0 ? normalized.join('\n\n') : null;
}
