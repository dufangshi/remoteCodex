import { getLocale } from '@remote-codex/thread-ui/i18n';
import { translate, useI18n } from '@remote-codex/thread-ui/i18n';
import { useEffect, useState } from 'react';
import type { ThreadExportTurnOptionDto } from '@remote-codex/shared';
import { Copy, Link2, Trash2, Check } from 'lucide-react';
import { request, fetchThreadExportTurns } from '../lib/api';
import { loadExportSnapshot } from '../lib/transcriptExport';
interface SnapshotLink {
  id: string;
  createdAt: string;
  turnCount: number;
  live?: boolean;
}
export function ThreadPublicLinks({
  deviceId,
  threadId,
}: {
  deviceId: string;
  threadId: string;
}) {
  useI18n();
  const [links, setLinks] = useState<SnapshotLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [turns, setTurns] = useState<ThreadExportTurnOptionDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scope, setScope] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [liveUpdates, setLiveUpdates] = useState(false);
  const path = `/relay/thread-links?${new URLSearchParams({ deviceId, threadId })}`;
  useEffect(() => {
    let live = true;
    request<SnapshotLink[]>(path)
      .then((value) => {
        if (live) setLinks((current) => [...current, ...value.filter((link) => !current.some((existing) => existing.id === link.id))]);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [path]);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    fetchThreadExportTurns(threadId).then(value => {
      if (active) { setTurns(value.turns); setSelected(new Set(value.turns.map(turn => turn.turnId))); setLoaded(true); }
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [threadId]);
  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(`${location.origin}/s/${id}`);
      setCopied(id);
    } catch {
      setError(translate("sharing.linkCreatedCopyItUsingTheCopy"));
    }
  }
  async function create() {
    setBusy(true);
    setError('');
    let publicationToken: string | undefined;
    try {
      const turnIds = scope === 'all' ? turns.map(turn => turn.turnId) : [...selected];
      if (!turnIds.length) throw new Error(translate("sharing.selectAtLeastOneTurn"));
      const theme = document.querySelector('.thread-ui-shell')?.getAttribute('data-theme-effective') === 'light' ? 'light' : 'dark';
      let snapshot;
      if (liveUpdates) {
        try {
          const publication = await request<{ token: string; snapshot: unknown }>(`/api/threads/${threadId}/publications`, { method: 'POST', body: JSON.stringify({ turnIds, theme }) });
          publicationToken = publication.token;
          snapshot = publication.snapshot;
        } catch (error) {
          throw new Error(translate("sharing.unableToEnableLiveSharingMakeSure", { value1: error instanceof Error ? error.message : '' }));
        }
      } else {
        snapshot = await loadExportSnapshot(threadId, { mode: 'selected', turnIds });
      }
      const link = await request<SnapshotLink>('/relay/thread-links', {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          threadId,
          snapshot,
          publicationToken,
          theme,
        }),
      });
      publicationToken = undefined;
      setLinks((current) => [link, ...current]);
      await copy(link.id);
    } catch (e) {
      if (publicationToken) await request(`/api/publications/${publicationToken}`, { method: 'DELETE' }).catch(() => {});
      setError(e instanceof Error ? e.message : translate("sharing.unableToCreateLink"));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError('');
    try {
      await request(`/relay/public-links/${id}`, { method: 'DELETE' });
      setLinks((current) => current.filter((link) => link.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : translate("sharing.unableToRevokeLink"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="thread-public-links space-y-4">
      <p className="thread-export-dialog-subtitle text-sm">
        {translate("sharing.anyoneWithTheLinkCanReadThe")}</p>
      <fieldset className="thread-public-link-options" disabled={busy}>
        <legend>{translate("sharing.turnsToShare")}</legend>
        <div className="thread-public-link-scope">
          <label><input type="radio" name="public-link-scope" checked={scope === 'all'} onChange={() => setScope('all')} />{translate("sharing.allCurrentTurns")} {loaded ? `(${turns.length})` : ''}</label>
          <label><input type="radio" name="public-link-scope" checked={scope === 'selected'} onChange={() => setScope('selected')} />{translate("sharing.chooseTurns")}</label>
        </div>
        {!loaded && <p role="status">{translate("sharing.loadingTurns")}</p>}
        {scope === 'selected' && loaded && <div className="thread-public-link-turns" aria-label={translate("sharing.turnsToShare")}>
          <div className="thread-public-link-selection"><span>{selected.size} {translate("sharing.selected")}</span><button type="button" onClick={() => setSelected(new Set())}>{translate("sharing.clearSelection")}</button></div>
          {turns.map(turn => <label key={turn.turnId}>
            <input type="checkbox" checked={selected.has(turn.turnId)} aria-label={translate("sharing.shareTurn", { value1: turn.turnNumber })} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(turn.turnId); else next.delete(turn.turnId); return next; })} />
            <span><strong>{translate("sharing.turn")} {turn.turnNumber}</strong><span>{turn.userPromptPreview || translate("sharing.noPromptText")}</span></span>
          </label>)}
        </div>}
        <label className="thread-public-link-live"><input type="checkbox" checked={liveUpdates} onChange={event => setLiveUpdates(event.target.checked)} /><span><strong>{translate("sharing.keepUpdatedWithNewTurns")}</strong><span>{liveUpdates ? translate("sharing.alsoPublishesFutureTurnsAutomaticallyEvenAfter") : translate("sharing.saveAFixedSnapshotLaterMessagesWill")}</span></span></label>
      </fieldset>
      <button
        type="button"
        disabled={busy || !loaded || !(scope === 'all' ? turns.length : selected.size)}
        onClick={() => void create()}
        className="thread-public-link-create matter-dialog-primary flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"
      >
        <Link2 size={17} />
        {busy ? translate("sharing.creatingLink") : translate("sharing.createCopyLink")}
      </button>
      {copied && <p role="status" className="thread-export-dialog-subtitle flex items-center gap-2"><Check size={14} />{translate("sharing.readOnlyLinkCopied")}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      {links.map((link) => (
        <div
          key={link.id}
          className="thread-export-dialog-box rounded-lg border p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs">
              {link.live ? translate("sharing.live") : translate("sharing.snapshot")} · {link.turnCount} {translate("sharing.turns")}{' '}
              {new Date(link.createdAt).toLocaleString(getLocale())}
            </span>
            <button
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--theme-bg)]"
              aria-label={translate("sharing.revokeShareLink")}
              title={translate("sharing.revokeLink")}
              disabled={busy}
              onClick={() => void revoke(link.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label={translate("sharing.publicShareURL")}
              className="min-w-0 flex-1 rounded border border-[var(--theme-border)] bg-transparent p-2 text-xs"
              value={`${location.origin}/s/${link.id}`}
            />
            <button
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--theme-bg)]"
              aria-label={translate("sharing.copyShareLink")}
              onClick={() => void copy(link.id)}
            >
              {copied === link.id ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
