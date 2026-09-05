import { useEffect, useState } from 'react';
import {
  fetchModelPricing,
  updateModelPricing,
  type ModelPriceRates,
} from '../lib/modelPricingApi';

const fields = [
  ['inputUsdPerMillion', 'In'],
  ['cachedInputUsdPerMillion', 'Cached'],
  ['outputUsdPerMillion', 'Out'],
  ['cacheWriteInputUsdPerMillion', 'Cache write'],
] as const;
const inputClass =
  'min-w-0 w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-2 py-1.5 text-sm text-[var(--theme-fg)]';

export function ModelPricingSettings() {
  const [models, setModels] = useState<Record<string, ModelPriceRates>>({});
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{
    id: string;
    rates: ModelPriceRates;
    aliases: string;
    isNew: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    fetchModelPricing()
      .then((data) => {
        if (active) setModels(data.models);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(reset = false) {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await updateModelPricing({
        id: draft.id.trim(),
        reset,
        rates: {
          ...draft.rates,
          aliases: draft.aliases
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      setModels(data.models);
      setDraft(null);
      window.dispatchEvent(new Event('model-pricing-updated'));
      setMessage(reset ? 'Default restored.' : 'Model prices saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save prices.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="py-5" aria-label="Model pricing">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Model pricing</h3>
        <button
          className="host-secondary-button rounded-md border px-3 py-1.5 text-xs"
          onClick={() => {
            setError('');
            setDraft({
              id: '',
              rates: {
                inputUsdPerMillion: 0,
                cachedInputUsdPerMillion: 0,
                outputUsdPerMillion: 0,
              },
              aliases: '',
              isNew: true,
            });
          }}
        >
          Add model
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
        USD per 1M tokens · In excludes cache. Estimates exclude tool fees and
        cache storage. Applies to all workspaces on this device.
      </p>
      <input
        aria-label="Search model prices"
        className={`${inputClass} mt-3`}
        placeholder="Search model ID or display name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="mt-2 max-h-72 overflow-auto rounded-md border border-[var(--theme-border)]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--theme-surface-strong)]">
            <tr>
              <th className="p-2">Model</th>
              {fields.map(([key, label]) => (
                <th className="p-2 text-right" key={key}>
                  {label}
                </th>
              ))}
              <th>
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(models)
              .filter(([id, r]) =>
                [id, ...(r.aliases ?? [])].some((s) =>
                  s.toLowerCase().includes(query.toLowerCase()),
                ),
              )
              .map(([id, rates]) => (
                <tr className="border-t border-[var(--theme-border)]" key={id}>
                  <td className="p-2">
                    <span>{id}</span>
                    {rates.custom && (
                      <span className="ml-1 text-[var(--theme-fg-muted)]">
                        custom
                      </span>
                    )}
                  </td>
                  {fields.map(([key]) => (
                    <td className="p-2 text-right tabular-nums" key={key}>
                      {typeof rates[key] === 'number' ? `$${rates[key]}` : '—'}
                    </td>
                  ))}
                  <td className="p-2">
                    <button
                      aria-label={`Edit ${id}`}
                      className="host-secondary-button rounded border px-2 py-1"
                      onClick={() => {
                        setError('');
                        setDraft({
                          id,
                          rates: { ...rates },
                          aliases: (rates.aliases ?? []).join(', '),
                          isNew: false,
                        });
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {draft && (
        <form
          className="mt-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block text-xs">
            Model ID
            <input
              required
              aria-label="Pricing model ID"
              className={`${inputClass} mt-1`}
              disabled={!draft.isNew || busy}
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            />
          </label>
          <label className="mt-2 block text-xs">
            Display names / aliases (comma separated)
            <input
              aria-label="Model aliases"
              className={`${inputClass} mt-1`}
              value={draft.aliases}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {fields.map(([key, label]) => (
              <label className="text-xs" key={key}>
                {label} $/1M
                <input
                  aria-label={`${label} price per million`}
                  className={`${inputClass} mt-1`}
                  type="number"
                  min="0"
                  max="1000000"
                  step="any"
                  required={key !== 'cacheWriteInputUsdPerMillion'}
                  disabled={busy}
                  value={draft.rates[key] ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      rates: {
                        ...draft.rates,
                        [key]:
                          e.target.value === ''
                            ? undefined
                            : Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          {draft.rates.notes && (
            <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">
              {draft.rates.notes}
            </p>
          )}
          {draft.rates.longContextThresholdTokens != null && (
            <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">
              Long context: above{' '}
              {Number(draft.rates.longContextThresholdTokens).toLocaleString()}{' '}
              input tok · In/cache ×{draft.rates.longContextInputMultiplier} ·
              Out ×{draft.rates.longContextOutputMultiplier}
            </p>
          )}
          {draft.rates.sourceUrl && (
            <a
              className="mt-2 block text-xs underline"
              href={draft.rates.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Official pricing · checked {draft.rates.verifiedAt}
            </a>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              disabled={busy}
              type="submit"
              className="host-secondary-button rounded border px-3 py-2 text-xs"
            >
              {busy ? 'Saving…' : 'Save prices'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
              className="host-secondary-button rounded border px-3 py-2 text-xs"
            >
              Cancel
            </button>
            {!draft.isNew && draft.rates.custom && (
              <button
                type="button"
                disabled={busy}
                className="host-secondary-button rounded border px-3 py-2 text-xs"
                onClick={() => void save(true)}
              >
                Reset / remove custom
              </button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="host-error mt-2 rounded border p-2 text-xs">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs">
          {message}
        </p>
      )}
    </section>
  );
}
