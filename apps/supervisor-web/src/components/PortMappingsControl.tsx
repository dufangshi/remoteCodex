import { useEffect, useRef, useState } from 'react';
import { Network } from 'lucide-react';
import { ApiError, request } from '../lib/api';
import { FormDialog } from './FormDialog';

interface Mapping { id: string; port: number; label: string; createdAt: string }
interface LocalLink { port: number; path: string }

export function parseLocalPreviewLink(href: string): LocalLink | null {
  try {
    const url = new URL(/^(?:localhost|127\.0\.0\.1|\[::1\]):\d/i.test(href) ? `http://${href}` : href);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password) return null;
    // URL normalizes an explicit :80 to the default port.
    const port = Number(url.port || 80);
    if (port < 1 || port > 65535) return null;
    return { port, path: url.pathname + url.search + url.hash };
  } catch { return null; }
}

export function PortMappingsControl({ deviceId, open: controlledOpen, onOpenChange }: {
  deviceId: string; open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const manager = controlledOpen ?? internalOpen;
  const setManager = onOpenChange ?? setInternalOpen;
  const [link, setLink] = useState<LocalLink | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [port, setPort] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const api = `/relay/devices/${encodeURIComponent(deviceId)}/api/port-mappings`;
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const intercept = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor?.closest('.thread-timeline-surface')) return;
      const target = parseLocalPreviewLink(anchor.getAttribute('href') ?? '');
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      setManager(false);
      setError(null);
      setLink(target);
    };
    document.addEventListener('click', intercept, true);
    return () => document.removeEventListener('click', intercept, true);
  }, [setManager]);
  useEffect(() => {
    if (!manager && !link) return;
    const controller = new AbortController();
    setAvailable(null);
    setError(null);
    void Promise.all([
      request<{ mappings: Mapping[] }>(api, { signal: controller.signal }),
      request<{ available: boolean }>('/relay/port-mappings/config', { signal: controller.signal }),
    ]).then(([list, config]) => {
      if (!controller.signal.aborted) { setMappings(list.mappings); setAvailable(config.available); }
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof ApiError && cause.statusCode === 404
        ? 'Update this device’s Supervisor to enable port mappings.'
        : cause instanceof Error ? cause.message : 'Could not load port mappings.');
    });
    return () => controller.abort();
  }, [api, manager, link]);

  async function action(run: (signal: AbortSignal) => Promise<void>) {
    const signal = lifetime.current!.signal;
    setBusy(true); setError(null); setCopied(null);
    try { await run(signal); }
    catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Port mapping failed.'); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function enable(value: number, signal: AbortSignal): Promise<Mapping> {
    const mapping = await request<Mapping>(api, {
      method: 'POST', signal, body: JSON.stringify({ port: value, label }),
    });
    if (!signal.aborted) setMappings(items => items.some(item => item.id === mapping.id) ? items : [...items, mapping]);
    return mapping;
  }
  async function launch(mapping: Mapping, path: string, signal: AbortSignal) {
    return request<{ url: string }>(`/relay/devices/${encodeURIComponent(deviceId)}/port-mappings/${mapping.id}/open`, {
      method: 'POST', signal, body: JSON.stringify({ path }),
    });
  }
  function open(mapping?: Mapping, target = link) {
    // Reserve the tab in the click handler so asynchronous API calls do not
    // trigger the browser's popup blocker. Never expose the main window opener.
    const tab = window.open('about:blank', '_blank');
    if (!tab) { setError('Allow popups for this site, then try again.'); return; }
    tab.opener = null;
    void action(async signal => {
      try {
        const selected = mapping ?? await enable(target!.port, signal);
        const result = await launch(selected, target?.path ?? '/', signal);
        if (signal.aborted) { tab.close(); return; }
        tab.location.replace(result.url);
        setLink(null);
      } catch (cause) { tab.close(); throw cause; }
    });
  }
  const buttonClass = 'host-secondary-button min-h-10 rounded-md border px-3 text-sm disabled:opacity-50';
  const inputClass = 'host-input min-h-10 w-full rounded-md border px-3';
  const readiness = available === false
    ? <p className="host-muted text-sm" role="status">Port previews are not configured on this Relay yet.</p>
    : available === null && !error ? <p className="host-muted text-sm" role="status">Loading port mappings…</p> : null;
  const errorMessage = error ? <p className="host-error text-sm" role="alert">{error}</p> : null;
  return <>
    {controlledOpen === undefined && <button aria-label="Port mappings" title="Port mappings" onClick={() => setManager(true)}><Network /></button>}
    {manager && <FormDialog title="Port mappings" description="Open HTTP services running on this device. Mappings are private to your account." busy={busy} onClose={() => setManager(false)}>
      <div className="space-y-4 min-w-0">
        {readiness}{errorMessage}
        <form className="flex flex-wrap gap-2" onSubmit={event => {
          event.preventDefault();
          void action(async signal => { await enable(Number(port), signal); setPort(''); setLabel(''); });
        }}>
          <label className="min-w-0 flex-1 text-sm">HTTP port<input aria-label="HTTP port" className={inputClass} type="number" inputMode="numeric" min="1" max="65535" required value={port} onChange={event => setPort(event.target.value)} disabled={busy} /></label>
          <label className="min-w-0 flex-1 text-sm">Label<input aria-label="Port label" className={inputClass} maxLength={40} value={label} onChange={event => setLabel(event.target.value)} disabled={busy} /></label>
          <button className={`${buttonClass} self-end`} disabled={busy || available !== true}>Enable</button>
        </form>
        {mappings.length === 0 && available === true && <p className="host-muted text-sm">No enabled ports.</p>}
        <ul className="space-y-3">
          {mappings.map(mapping => <li key={mapping.id} className="rounded-md border p-3 space-y-2">
            <div className="break-words text-sm font-medium">{mapping.label ? `${mapping.label} · ` : ''}127.0.0.1:{mapping.port}</div>
            <div className="host-muted text-xs">Enabled {new Date(mapping.createdAt).toLocaleString()}</div>
            <div className="flex flex-wrap gap-2">
              <button className={buttonClass} type="button" disabled={busy || available !== true} onClick={() => open(mapping, null)}>Open</button>
              <button className={buttonClass} type="button" disabled={busy || available !== true} onClick={() => void action(async signal => {
                const { url } = await launch(mapping, '/', signal);
                // Copy the stable address, never the short-lived login handoff.
                const address = new URL(url); address.searchParams.delete('__rc_launch');
                await navigator.clipboard.writeText(address.href); setCopied(mapping.id);
              })}>{copied === mapping.id ? 'Copied' : 'Copy address'}</button>
              <button className={buttonClass} type="button" disabled={busy} onClick={() => void action(async signal => {
                await request(api + '/' + mapping.id, { method: 'DELETE', signal });
                setMappings(items => items.filter(item => item.id !== mapping.id));
              })}>Stop</button>
            </div>
          </li>)}
        </ul>
        <p className="host-muted text-xs">Stopping a mapping closes its connections. The local service keeps running. On WSL, the service must be reachable from the Supervisor’s WSL environment.</p>
      </div>
    </FormDialog>}
    {link && <FormDialog title="Open device web service?" description={`Enable a private mapping for 127.0.0.1:${link.port} and open this link in a new tab?`} busy={busy} onClose={() => setLink(null)}>
      <div className="space-y-4 min-w-0">
        <p className="host-muted text-sm break-all">{link.path}</p>
        {readiness}{errorMessage}
        <div className="flex justify-end gap-2">
          <button className={buttonClass} disabled={busy} onClick={() => setLink(null)}>Cancel</button>
          <button className={buttonClass} disabled={busy || available !== true} onClick={() => open()}>{busy ? 'Opening…' : 'Enable and open'}</button>
        </div>
      </div>
    </FormDialog>}
  </>;
}
