import { translate, useI18n } from '@remote-codex/thread-ui/i18n';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { relayModeActive, request } from '../lib/api';
import { relayDeviceIdFromPath } from '../lib/relayRoutes';
import { UpstreamManagement } from './UpstreamManagement';

type InstalledHarness = {
  id: string;
  name: string;
  base: { installed?: boolean; path?: string } | null;
};

export function UpstreamsSettings() {
  useI18n();
  const { pathname } = useLocation();
  const deviceId = relayDeviceIdFromPath(pathname);
  if (relayModeActive() && !deviceId) {
    return (
      <p className="py-5 text-sm text-[var(--theme-fg-muted)]">
        {translate('settings.upstreamsChooseDevice')}
      </p>
    );
  }
  const apiRoot = deviceId
    ? `/relay/devices/${encodeURIComponent(deviceId)}/api`
    : '/api';
  return <DeviceUpstreams key={apiRoot} apiRoot={apiRoot} />;
}

function DeviceUpstreams({ apiRoot }: { apiRoot: string }) {
  const [harnesses, setHarnesses] = useState<InstalledHarness[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void request<InstalledHarness[]>(`${apiRoot}/management/harnesses`, {
      cache: 'no-store',
    })
      .then((inventory) => {
        // Base installation is authoritative: an installed ACP adapter alone is
        // not an installed harness. Older inventories omit `installed` on success.
        const installed = inventory.filter(
          (h) =>
            h.base &&
            h.base.installed !== false &&
            (h.base.installed === true || !!h.base.path),
        );
        if (!alive) return;
        setHarnesses(installed);
        setSelected((current) =>
          installed.some((h) => h.id === current)
            ? current
            : (installed[0]?.id ?? ''),
        );
      })
      .catch(() => {
        if (alive) setError(translate('settings.upstreamsInventoryError'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiRoot, revision]);
  return (
    <section
      className="min-w-0 py-4"
      aria-label={translate('settings.upstreamsTab')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex min-w-0 flex-wrap gap-1 rounded-xl bg-[var(--theme-hover)] p-1"
          role="group"
          aria-label={translate('devices.chooseHarness')}
        >
          {!loading &&
            harnesses.map((h) => (
              <button
                key={h.id}
                type="button"
                aria-pressed={selected === h.id}
                className={`min-h-10 rounded-lg px-3 text-xs font-medium transition ${selected === h.id ? 'bg-[var(--theme-panel)] text-[var(--theme-accent-strong)] shadow-sm' : 'text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg)]'}`}
                onClick={() => setSelected(h.id)}
              >
                {h.name}
              </button>
            ))}
        </div>
        <button
          type="button"
          className="host-secondary-button inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-lg border px-3 text-xs"
          aria-label={translate('settings.upstreamsRefresh')}
          disabled={loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={14} />
          <span className="hidden sm:inline">
            {translate('settings.upstreamsRefresh')}
          </span>
        </button>
      </div>
      {loading ? (
        <p role="status" className="py-6 text-sm">
          {translate('settings.loading')}
        </p>
      ) : error ? (
        <p role="alert" className="py-6 text-sm text-[var(--status-danger-fg)]">
          {error}
        </p>
      ) : !selected ? (
        <p className="my-5 rounded-xl border border-dashed border-[var(--theme-border)] p-6 text-sm text-[var(--theme-fg-muted)]">
          {translate('settings.upstreamsNoInstalled')}
        </p>
      ) : ['codex', 'claude', 'gemini', 'grok'].includes(selected) ? (
        <UpstreamManagement
          key={apiRoot + selected}
          apiRoot={apiRoot}
          harness={selected}
          appearance="switch"
        />
      ) : (
        <p className="my-5 rounded-xl border border-dashed border-[var(--theme-border)] p-6 text-sm text-[var(--theme-fg-muted)]">
          {translate('devices.useThisHarnessSNativeConfigurationTo')}
        </p>
      )}
    </section>
  );
}
