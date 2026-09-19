import { useEffect, useRef, useState } from 'react';
import { Copy, Link2, Trash2, Check } from 'lucide-react';
import { request } from '../lib/api';
import { loadExportSnapshot } from '../lib/transcriptExport';
interface SnapshotLink {
  id: string;
  createdAt: string;
  turnCount: number;
}
export function ThreadPublicLinks({
  deviceId,
  threadId,
  createOnOpen = false,
}: {
  deviceId: string;
  threadId: string;
  createOnOpen?: boolean;
}) {
  const [links, setLinks] = useState<SnapshotLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const createdFor = useRef<string | null>(null);
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
    if (!createOnOpen || createdFor.current === path) return;
    createdFor.current = path;
    void create();
  }, [createOnOpen, path]);
  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(`${location.origin}/s/${id}`);
      setCopied(id);
    } catch {
      setError('Link created. Copy it using the copy button, or select the URL.');
    }
  }
  async function create() {
    setBusy(true);
    setError('');
    try {
      const snapshot = await loadExportSnapshot(threadId, { mode: 'latest', limit: 100 }, true);
      const link = await request<SnapshotLink>('/relay/thread-links', {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          threadId,
          snapshot,
          theme:
            document.querySelector('.thread-ui-shell')?.getAttribute('data-theme-effective') ===
            'light'
              ? 'light'
              : 'dark',
        }),
      });
      setLinks((current) => [link, ...current]);
      await copy(link.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create link.');
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
      setError(e instanceof Error ? e.message : 'Unable to revoke link.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="thread-public-links space-y-4">
      <p className="thread-export-dialog-subtitle text-sm">
        Anyone with the link can read the prompts and final replies captured
        now. Later messages stay private.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void create()}
        className="thread-public-link-create thread-export-dialog-secondary-button flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"
      >
        <Link2 size={17} />
        {busy ? 'Creating link…' : 'Create & copy link'}
      </button>
      {copied && <p role="status" className="thread-export-dialog-subtitle flex items-center gap-2"><Check size={14} />Read-only link copied</p>}
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
              {link.turnCount} turns ·{' '}
              {new Date(link.createdAt).toLocaleString()}
            </span>
            <button
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--theme-bg)]"
              aria-label="Revoke share link"
              title="Revoke link"
              disabled={busy}
              onClick={() => void revoke(link.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label="Public share URL"
              className="min-w-0 flex-1 rounded border border-[var(--theme-border)] bg-transparent p-2 text-xs"
              value={`${location.origin}/s/${link.id}`}
            />
            <button
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--theme-bg)]"
              aria-label="Copy share link"
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
