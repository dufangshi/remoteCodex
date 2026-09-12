// Read-only discovery in the ACP-owned DSH process. No second agent or Web server.
import { connect } from 'node:net';
export const name = 'remote-codex-discovery';
export const inject = ['llm', 'appReady'];
export function apply(ctx, config) {
  const dispose = ctx.appReady.onReady(() => {
    void discover(ctx).then(data => send(config, { data }), error =>
      send(config, { error: String(error?.message ?? error) }));
  });
  ctx.on('dispose', dispose);
}
function send(config, result) {
  const socket = connect({ host: '127.0.0.1', port: config.port });
  socket.on('error', () => {});
  socket.on('connect', () => socket.end(JSON.stringify({ token: config.token, ...result }) + '\n'));
}
async function discover(ctx) {
  const models = [];
  for (const provider of ctx.llm.listProviders()) {
    for (const model of await ctx.llm.listModels(provider.id)) {
      const info = await ctx.llm.resolveModelInfo(provider.id, model.id);
      const reasoning = info?.reasoning;
      const efforts = (reasoning?.efforts ?? []).map(effort => ({
        reasoningEffort: String(effort.id), description: effort.description ?? effort.name ?? String(effort.id),
      }));
      if (reasoning && reasoning.defaultEffort === undefined) {
        efforts.unshift({ reasoningEffort: '', description: 'Provider default' });
      }
      const value = JSON.stringify([provider.id, model.id]);
      models.push({ id: value, model: value, displayName: `${provider.name} · ${model.name}`,
        description: model.description ?? '', isDefault: false, hidden: false,
        supportedReasoningEfforts: efforts,
        defaultReasoningEffort: reasoning ? String(reasoning.defaultEffort ?? '') : null,
        selectionKind: 'model', acpAgent: null });
    }
  }
  // Explicit allowlist: never export plugin configs, environment, or credentials.
  const plugins = [...ctx.loader.entries()].filter(entry => !entry.options.group).map(entry => ({
    id: entry.id, name: entry.options.name, enabled: !entry.disabled,
  }));
  return { models, plugins, profile: 'acp',
    notice: 'DSH ACP supports model and reasoning settings. Native Web presets and plugin editing are not exposed by this profile.' };
}
