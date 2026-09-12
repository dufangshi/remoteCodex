import { useEffect, useState } from 'react';
import type { ModelOptionDto, ThreadDto } from '@remote-codex/shared';
import { fetchThreadCapabilitySnapshot } from '../lib/api';
import { FormDialog } from './FormDialog';

// Adapter data is metadata only. Never execute backend-provided HTML or JavaScript.
export function HarnessSettingsDialog({ thread, models, busy, onChange, onClose }: {
  thread: ThreadDto;
  models: ModelOptionDto[];
  busy: boolean;
  onChange: (input: { model?: string; reasoningEffort?: ThreadDto['reasoningEffort'] }) => Promise<void>;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<{ profile?: string; notice?: string; plugins?: {id: string; name: string; enabled: boolean}[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetchThreadCapabilitySnapshot(thread.id).then(snapshot => {
      if (!cancelled) setInfo((snapshot.negotiated as { harness?: typeof info } | null)?.harness ?? null);
    }).catch(error => { if (!cancelled) setError(String(error)); });
    return () => { cancelled = true; };
  }, [thread.id]);
  const model = models.find(model => model.model === thread.model);
  const disabled = busy || Boolean(thread.activeTurnId);
  return <FormDialog title="Harness settings" onClose={onClose}>
    <div className="space-y-4 text-sm">
      {error && <p role="alert">{error}</p>}
      <label className="block">Model
        <select className="host-input mt-1 w-full rounded-md border p-2" aria-label="Harness model" value={thread.model ?? ''} disabled={disabled}
          onChange={event => {
            const selected = models.find(model => model.model === event.target.value);
            void onChange({ model: event.target.value, reasoningEffort: selected?.defaultReasoningEffort ?? null });
          }}>
          {models.map(model => <option key={model.id} value={model.model}>{model.displayName}</option>)}
        </select>
      </label>
      {!!model?.supportedReasoningEfforts.length && <label className="block">Reasoning effort
        <select className="host-input mt-1 w-full rounded-md border p-2" aria-label="Harness reasoning effort" value={thread.reasoningEffort ?? ''} disabled={disabled}
          onChange={event => void onChange({reasoningEffort: event.target.value})}>
          {model.supportedReasoningEfforts.map(effort => <option key={effort.reasoningEffort} value={effort.reasoningEffort}>{effort.reasoningEffort || 'Provider default'}</option>)}
        </select>
      </label>}
      {thread.activeTurnId && <p>Session settings can be changed after the current turn finishes.</p>}
      <p className="text-[var(--theme-fg-muted)]">{info?.notice ?? 'Loading harness capabilities…'}</p>
      {info && <section aria-label="Harness plugins" className="space-y-2">
        <h3 className="font-semibold">Plugins · {info.profile} profile</h3>
        <p className="text-xs text-[var(--theme-fg-muted)]">Read-only snapshot from this session’s process at startup.</p>
        <input className="host-input w-full rounded-md border p-2" aria-label="Filter plugins" placeholder="Filter plugins" value={filter} onChange={event => setFilter(event.target.value)} />
        <ul className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">
          {info.plugins?.filter(plugin => plugin.name?.toLowerCase().includes(filter.toLowerCase())).map(plugin => <li className="flex gap-2 break-all text-xs" key={plugin.id}>
            <span>{plugin.enabled ? '●' : '○'}</span><span>{plugin.name}</span><span className="ml-auto">{plugin.enabled ? 'Enabled' : 'Disabled'}</span>
          </li>)}
        </ul>
      </section>}
    </div>
  </FormDialog>;
}
