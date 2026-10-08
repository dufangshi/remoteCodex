import { translate, useI18n } from '@remote-codex/thread-ui/i18n';
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
  useI18n();
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
  return <FormDialog title={translate("settings.harnessSettings")} onClose={onClose}>
    <div className="space-y-4 text-sm">
      {error && <p role="alert">{error}</p>}
      <label className="block">{translate("settings.model")}<select className="host-input mt-1 w-full rounded-md border p-2" aria-label={translate("settings.harnessModel")} value={thread.model ?? ''} disabled={disabled}
          onChange={event => {
            const selected = models.find(model => model.model === event.target.value);
            void onChange({ model: event.target.value, reasoningEffort: selected?.defaultReasoningEffort ?? null });
          }}>
          {models.map(model => <option key={model.id} value={model.model}>{model.displayName}</option>)}
        </select>
      </label>
      {!!model?.supportedReasoningEfforts.length && <label className="block">{translate("settings.reasoningEffort")}<select className="host-input mt-1 w-full rounded-md border p-2" aria-label={translate("settings.harnessReasoningEffort")} value={thread.reasoningEffort ?? ''} disabled={disabled}
          onChange={event => void onChange({reasoningEffort: event.target.value})}>
          {model.supportedReasoningEfforts.map(effort => <option key={effort.reasoningEffort} value={effort.reasoningEffort}>{effort.reasoningEffort || translate("settings.providerDefault")}</option>)}
        </select>
      </label>}
      {thread.activeTurnId && <p>{translate("settings.sessionSettingsCanBeChangedAfterThe")}</p>}
      <p className="text-[var(--theme-fg-muted)]">{info?.notice ?? translate("settings.loadingHarnessCapabilities")}</p>
      {info && <section aria-label={translate("settings.harnessPlugins")} className="space-y-2">
        <h3 className="font-semibold">{translate("settings.plugins")} {info.profile} {translate("settings.profile")}</h3>
        <p className="text-xs text-[var(--theme-fg-muted)]">{translate("settings.readOnlySnapshotFromThisSessionS")}</p>
        <input className="host-input w-full rounded-md border p-2" aria-label={translate("settings.filterPlugins")} placeholder={translate("settings.filterPlugins")} value={filter} onChange={event => setFilter(event.target.value)} />
        <ul className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">
          {info.plugins?.filter(plugin => plugin.name?.toLowerCase().includes(filter.toLowerCase())).map(plugin => <li className="flex gap-2 break-all text-xs" key={plugin.id}>
            <span>{plugin.enabled ? '●' : '○'}</span><span>{plugin.name}</span><span className="ml-auto">{plugin.enabled ? translate("settings.enabled") : translate("settings.disabled")}</span>
          </li>)}
        </ul>
      </section>}
    </div>
  </FormDialog>;
}
