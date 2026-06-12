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
  const lines = [
    `ElAgente Harness chemistry tools are available at ${baseUrl}.`,
    'For chemistry tasks, call its HTTP API directly using the sandbox env var INACT_X_APP_KEY as the x-api-key header; never print or expose that key.',
    'Discover tools with GET /, GET /farmaco/tools, GET /farmaco/.help, GET /quntur/tools, or GET /estructural/tools; invoke approved tools with POST /{module}/tools/{tool} using JSON input.',
  ];
  if (config.harnessWakeupCallbackBaseUrl) {
    const supervisorBaseUrl = `http://127.0.0.1:${config.port}`;
    lines.push(
      `For long-running compute jobs you do not need to stay running: first GET ${supervisorBaseUrl}/api/harness/wakeup and read "notifyTo"; submit the job with "notify_to" set to that value; then register POST ${supervisorBaseUrl}/api/harness/job-watches with JSON {"jobId": "<job id>"}. After that you may end your turn — this thread is woken with a new message when the job reaches a terminal status.`,
    );
  }
  return lines.join(' ');
}

export function combineDeveloperInstructions(parts: Array<string | null | undefined>) {
  const normalized = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return normalized.length > 0 ? normalized.join('\n\n') : null;
}
