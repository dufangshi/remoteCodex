import { useEffect, useState } from 'react';
import { request } from '../lib/api';

export function UpstreamModelPicker({
  apiRoot,
  connection,
  value,
  onChange,
}: {
  apiRoot: string;
  connection: {
    id: string;
    harness: string;
    baseUrl: string;
    apiKey?: string;
    authType?: string;
    hasApiKey?: boolean;
  };
  value: string;
  onChange: (model: string) => void;
}) {
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { id, harness, baseUrl, apiKey, authType, hasApiKey } = connection;
  const ready =
    (baseUrl.startsWith('https://') || baseUrl.startsWith('http://')) &&
    !!(apiKey || (id && hasApiKey));
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void request<{
        models: { id: string; name: string }[];
        truncated: boolean;
      }>(`${apiRoot}/management/upstreams/models`, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          id,
          harness,
          baseUrl,
          apiKey: apiKey ?? '',
          authType: authType ?? 'api_key',
        }),
      })
        .then((result) => {
          if (!alive) return;
          if (!Array.isArray(result.models))
            throw Error('Update this Supervisor to enable model discovery.');
          setModels(result.models);
          setTruncated(result.truncated);
        })
        .catch((e) => {
          if (alive)
            setError(e instanceof Error ? e.message : 'Unable to load models');
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiRoot, id, harness, baseUrl, apiKey, authType, ready, refresh]);
  return (
    <div>
      <label className="block text-sm">
        Model
        <select
          className="host-input mt-1 w-full min-w-0 rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel)] p-2 text-sm"
          required
          value={value}
          disabled={!ready || loading}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">
            {loading ? 'Loading models…' : 'Select a model'}
          </option>
          {value && !models.some((m) => m.id === value) && (
            <option value={value}>{value} (configured)</option>
          )}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name === m.id ? m.id : `${m.name} · ${m.id}`}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--theme-fg-muted)]">
        <span>
          {!ready
            ? 'Enter the upstream URL and API key to discover models.'
            : loading
              ? 'Discovering models from this upstream…'
              : error
                ? ''
                : models.length
                  ? `${models.length} models found${truncated ? ' (list truncated)' : ''}.`
                  : 'No models returned by this upstream.'}
        </span>
        <button
          type="button"
          className="min-h-9 rounded-md border border-[var(--theme-border)] px-3 disabled:opacity-40"
          disabled={!ready || loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh models
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 break-words text-xs text-[var(--status-danger-fg)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
