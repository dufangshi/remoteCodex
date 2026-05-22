import {
  DatabaseClient,
  getPolicyRecordByKey,
  upsertPolicyRecord,
} from '../../../../packages/db/src/index';
import type { PluginManifestDto } from '../../../../packages/shared/src/index';
import { parsePluginManifest } from '../../../../packages/plugin-runtime/src/index';

const PLUGIN_SETTINGS_POLICY_KEY = 'plugins';

export interface PersistedPluginSettings {
  enabled: Record<string, boolean>;
  imported: PluginManifestDto[];
}

function emptySettings(): PersistedPluginSettings {
  return {
    enabled: {},
    imported: [],
  };
}

function parseEnabled(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const output: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof enabled === 'boolean') {
      output[key] = enabled;
    } else if (
      enabled &&
      typeof enabled === 'object' &&
      !Array.isArray(enabled) &&
      typeof (enabled as { enabled?: unknown }).enabled === 'boolean'
    ) {
      output[key] = (enabled as { enabled: boolean }).enabled;
    }
  }
  return output;
}

export class PluginSettingsStore {
  constructor(private readonly db: DatabaseClient) {}

  load(): PersistedPluginSettings {
    const record = getPolicyRecordByKey(this.db, PLUGIN_SETTINGS_POLICY_KEY);
    if (!record?.valueJson) {
      return emptySettings();
    }

    try {
      const parsed = JSON.parse(record.valueJson) as {
        enabled?: unknown;
        imported?: unknown;
      };
      return {
        enabled: parseEnabled(parsed.enabled),
        imported: Array.isArray(parsed.imported)
          ? parsed.imported.map((entry) => parsePluginManifest(entry))
          : [],
      };
    } catch {
      return emptySettings();
    }
  }

  save(settings: PersistedPluginSettings) {
    upsertPolicyRecord(
      this.db,
      PLUGIN_SETTINGS_POLICY_KEY,
      JSON.stringify({
        enabled: settings.enabled,
        imported: settings.imported,
      }),
    );
  }
}
