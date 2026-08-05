import { describe, expect, it } from 'vitest';

import { PluginRegistry } from '../../../../packages/plugin-runtime/src/index';
import type { PluginManifestDto } from '../../../../packages/shared/src/index';
import { PluginService, PluginUnavailableError } from './plugin-service';

const terminalManifest: PluginManifestDto = {
  id: 'remote-codex-terminal',
  name: 'Terminal',
  version: '1.0.0',
  description: 'Terminal test plugin.',
  remoteCodex: '*',
  capabilities: {
    artifactTypes: [],
    timelineRenderers: [],
    threadPanels: [],
  },
};

describe('PluginService platform availability', () => {
  it('keeps a supported plugin enabled', () => {
    const registry = new PluginRegistry([{ manifest: terminalManifest }]);
    const service = new PluginService(registry);

    expect(service.getPlugin(terminalManifest.id)).toMatchObject({
      enabled: true,
      available: true,
      unavailableReason: null,
    });
  });

  it('disables an unavailable plugin without persisting a platform preference', () => {
    const registry = new PluginRegistry([{ manifest: terminalManifest }]);
    const reason = 'The Terminal plugin is not available on native Windows.';
    const service = new PluginService(registry, undefined, {
      unavailablePlugins: new Map([[terminalManifest.id, reason]]),
    });

    expect(service.getPlugin(terminalManifest.id)).toMatchObject({
      enabled: false,
      available: false,
      unavailableReasonCode: 'unsupported_platform',
      unavailableReason: reason,
    });
    expect(() => service.setPluginEnabled(terminalManifest.id, true))
      .toThrow(PluginUnavailableError);
    expect(registry.enabledManifests()).toEqual([]);
  });
});
