import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Upload,
  Download,
  Check,
  FlaskConical,
  RotateCcw,
  Copy,
  Trash2,
} from 'lucide-react';
import { request } from '../lib/api';
import { FormDialog } from './FormDialog';
import { UpstreamModelPicker } from './UpstreamModelPicker';

type Profile = {
  id: string;
  name: string;
  harness: string;
  baseUrl: string;
  model: string;
  apiType: string;
  authType?: string;
  contextWindow: number;
  hasApiKey?: boolean;
  apiKey?: string;
};
type Snapshot = {
  profiles: Profile[];
  active: Record<string, string>;
  backups: { id: string; harness: string; createdAt: string }[];
};
type Job = { state: string; error?: string; completed?: string[] };
const labels: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  grok: 'Grok Build',
};
const button =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-xs hover:bg-[var(--theme-hover)] disabled:opacity-40';
const field =
  'host-input mt-1 w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel)] p-2 text-sm';
const blank = (): Profile => ({
  id: '',
  name: '',
  harness: 'codex',
  baseUrl: '',
  model: '',
  apiKey: '',
  apiType: 'responses',
  authType: 'api_key',
  contextWindow: 500000,
});
function snapshot(value: Snapshot) {
  if (
    !Array.isArray(value?.profiles) ||
    !Array.isArray(value?.backups) ||
    !value?.active
  )
    throw Error(
      'Update this Supervisor to enable upstream and template management.',
    );
  return value;
}
const sample = {
  schemaVersion: 1,
  harnesses: ['codex'],
  profiles: [
    {
      name: 'My upstream',
      harness: 'codex',
      baseUrl: 'https://example.com/v1',
      apiKey: '',
      apiType: 'responses',
    },
  ],
};
export function UpstreamManagement({
  apiRoot,
  harness,
  templatesOnly = false,
}: {
  apiRoot: string;
  harness?: string;
  templatesOnly?: boolean;
}) {
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [data, setData] = useState<Snapshot>({
    profiles: [],
    active: {},
    backups: [],
  });
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Profile | null>(null),
    [mode, setMode] = useState<'config' | 'template' | null>(null);
  const [text, setText] = useState(''),
    [importHarness, setImportHarness] = useState(harness ?? 'codex'),
    [importName, setImportName] = useState('Imported upstream'),
    [importKey, setImportKey] = useState('');
  const [preview, setPreview] = useState<{
      harnesses: string[];
      profiles: Profile[];
    } | null>(null),
    [job, setJob] = useState<Job | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const api = <T,>(suffix: string, body?: unknown, method?: string) =>
    request<T>(
      `${apiRoot}/management/${suffix}`,
      body !== undefined
        ? { method: method ?? 'POST', body: JSON.stringify(body) }
        : { method: method ?? 'GET', cache: 'no-store' },
    );
  async function load() {
    const value = snapshot(await api<Snapshot>('upstreams'));
    setData(value);
    setLoaded(true);
  }
  useEffect(() => {
    let alive = true;
    void api<Record<string, Job>>('jobs')
      .then((jobs) => {
        if (alive && jobs.template) setJob(jobs.template);
      })
      .catch(() => {});
    void api<Snapshot>('upstreams')
      .then(snapshot)
      .then((v) => {
        if (alive) {
          setData(v);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive)
          setError(
            'Update this Supervisor to enable upstream and template management.',
          );
      });
    return () => {
      alive = false;
    };
  }, [apiRoot]);
  useEffect(() => {
    if (job?.state !== 'running') return;
    let alive = true,
      inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const jobs = await api<Record<string, Job>>('jobs');
        if (alive && jobs.template) {
          setJob(jobs.template);
          if (jobs.template.state !== 'running') await load();
        }
      } catch {
      } finally {
        inFlight = false;
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [job?.state, apiRoot]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unable to save upstream settings',
      );
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || job?.state === 'running';
  function download() {
    const template = {
      schemaVersion: 1,
      harnesses: [
        ...new Set(
          data.profiles
            .filter((p) => data.active[p.harness] === p.id)
            .map((p) => p.harness),
        ),
      ],
      profiles: data.profiles
        .filter((p) => data.active[p.harness] === p.id)
        .map(({ id, hasApiKey, model, ...p }) => ({ ...p, apiKey: '' })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(template, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'remote-codex-template.json';
    a.click();
    URL.revokeObjectURL(url);
    setNotice(
      'Template exported without API keys. Fill them in before importing on another device.',
    );
  }
  function openImport(next: 'config' | 'template') {
    setMode(next);
    setText(next === 'template' ? JSON.stringify(sample, null, 2) : '');
    setPreview(null);
    setError('');
    setImportKey('');
  }
  return (
    <section
      className="mt-6 border-t border-[var(--theme-border)] pt-5"
      aria-label={templatesOnly ? 'Device templates' : 'Upstream management'}
    >
      {!templatesOnly && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                {harness ? `${labels[harness]} upstreams` : 'Upstreams'}
              </h3>
              <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                Saved on this device. Switch providers without opening its
                terminal.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={!loaded || disabled}
                onClick={() => openImport('config')}
              >
                <Upload size={14} />
                Import config
              </button>
              <button
                className={button}
                disabled={!loaded || disabled}
                onClick={() =>
                  setEditor({ ...blank(), harness: harness ?? 'codex' })
                }
              >
                <Plus size={14} />
                Add upstream
              </button>
            </div>
          </div>
          {loaded &&
            !data.profiles.some((p) => !harness || p.harness === harness) && (
              <p className="my-5 rounded-lg border border-dashed border-[var(--theme-border)] p-4 text-sm text-[var(--theme-fg-muted)]">
                Add an API provider or import an existing configuration to get
                started.
              </p>
            )}
          <div className="mt-3 space-y-3">
            {data.profiles
              .filter((p) => !harness || p.harness === harness)
              .map((p) => (
                <article
                  key={p.id}
                  className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="flex items-center gap-2 text-sm font-medium">
                        {p.name}
                        {data.active[p.harness] === p.id && (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--theme-accent-strong)]">
                            <Check size={13} />
                            Active
                          </span>
                        )}
                      </h4>
                      <p className="mt-1 break-all text-xs text-[var(--theme-fg-muted)]">
                        {labels[p.harness]} · {p.model}
                      </p>
                      <p className="mt-1 break-all text-xs text-[var(--theme-fg-muted)]">
                        {p.baseUrl}
                      </p>
                    </div>
                    <button
                      className={button}
                      disabled={disabled}
                      aria-label={`Duplicate ${p.name}`}
                      onClick={() => setEditor({ ...p, id: '', apiKey: '' })}
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className={button}
                      disabled={disabled || data.active[p.harness] === p.id}
                      onClick={() =>
                        void perform(async () => {
                          await api(`upstreams/${p.id}`, {
                            action: 'activate',
                          });
                          await load();
                          setNotice(
                            `${labels[p.harness]} configuration applied. Idle sessions were restarted; the next turn uses this upstream.`,
                          );
                        })
                      }
                    >
                      Use upstream
                    </button>
                    <button
                      className={button}
                      disabled={disabled}
                      title="Sends a small request using this model; API charges may apply"
                      onClick={() =>
                        void perform(async () => {
                          const r = await api<{ latencyMs: number }>(
                            `upstreams/${p.id}`,
                            { action: 'test' },
                          );
                          setNotice(
                            `${p.name}: connection succeeded (${r.latencyMs} ms).`,
                          );
                        })
                      }
                    >
                      <FlaskConical size={13} />
                      Test connection
                    </button>
                    <button
                      className={button}
                      disabled={disabled || data.active[p.harness] === p.id}
                      onClick={() => setEditor({ ...p, apiKey: '' })}
                    >
                      Edit
                    </button>
                    <button
                      className={button}
                      disabled={disabled}
                      aria-label={`Delete ${p.name}`}
                      onClick={() => setDeleting(p)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </article>
              ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--theme-fg-muted)]">
            Switch after current tasks finish. Existing MCP and skill settings
            are preserved. Connection tests send a small model request and may
            incur API charges.
          </p>
          {!!data.backups.length && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer py-2">
                Configuration backups
              </summary>
              {Object.keys(labels)
                .filter((h) => !harness || h === harness)
                .map((h) => {
                  const b = [...data.backups]
                    .reverse()
                    .find((v) => v.harness === h);
                  return (
                    b && (
                      <div
                        key={h}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <span>
                          {labels[h]} · {new Date(b.createdAt).toLocaleString()}
                        </span>
                        <button
                          className={button}
                          disabled={disabled}
                          onClick={() =>
                            void perform(async () => {
                              await api(`upstreams/${b.id}`, {
                                action: 'restore',
                              });
                              await load();
                              setNotice(
                                'Previous configuration restored. The next turn reloads it.',
                              );
                            })
                          }
                        >
                          <RotateCcw size={13} />
                          Restore previous
                        </button>
                      </div>
                    )
                  );
                })}
            </details>
          )}
        </>
      )}
      {templatesOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Device templates</h3>
            <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
              Install harnesses and configure their upstreams together.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={!loaded || disabled}
              onClick={() => openImport('template')}
            >
              <Upload size={14} />
              Import template
            </button>
            <button
              className={button}
              disabled={!loaded || disabled || !Object.keys(data.active).length}
              onClick={download}
            >
              <Download size={14} />
              Export template
            </button>
          </div>
        </div>
      )}
      {deleting && (
        <FormDialog
          title={
            data.active[deleting.harness] === deleting.id
              ? 'Deactivate and delete upstream'
              : 'Delete upstream'
          }
          onClose={() => setDeleting(null)}
          busy={busy}
        >
          <p className="text-sm leading-6">
            {data.active[deleting.harness] === deleting.id
              ? 'This restores the native configuration from before managed upstreams were enabled. Running tasks must finish first. Other saved upstreams remain available.'
              : 'Remove this saved upstream from the device.'}
          </p>
          <p className="my-3 text-sm font-medium">{deleting.name}</p>
          {error && (
            <p
              role="alert"
              className="mb-3 text-xs text-[var(--status-danger-fg)]"
            >
              {error}
            </p>
          )}
          <button
            className="relay-button-primary min-h-10"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await api(`upstreams/${deleting.id}`, undefined, 'DELETE');
                await load();
                setDeleting(null);
                setNotice('Upstream removed.');
              })
            }
          >
            {busy ? 'Removing…' : 'Delete upstream'}
          </button>
        </FormDialog>
      )}
      {job && (
        <div role={job.error ? 'alert' : 'status'} className="mt-3 text-xs">
          <p>
            {job.state === 'running'
              ? 'Installing and configuring this device…'
              : (job.error ?? 'Template applied. This device is ready.')}
          </p>
          {job.completed?.map((v) => (
            <p key={v}>{v}</p>
          ))}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="mt-3 text-xs text-[var(--theme-accent-strong)]"
        >
          {notice}
        </p>
      )}
      {error && !editor && !mode && (
        <p role="alert" className="mt-3 text-xs text-[var(--status-danger-fg)]">
          {error}
        </p>
      )}
      {editor && (
        <FormDialog
          title={editor.id ? 'Edit upstream' : 'Add upstream'}
          onClose={() => setEditor(null)}
          busy={busy}
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await api(
                  'upstreams',
                  Object.fromEntries(
                    Object.entries(editor).filter(([k]) => k !== 'hasApiKey'),
                  ),
                );
                await load();
                setEditor(null);
              });
            }}
          >
            <label className="block text-sm">
              Name
              <input
                className={field}
                required
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              Harness
              <select
                className={field}
                value={editor.harness}
                onChange={(e) =>
                  setEditor({ ...editor, harness: e.target.value, model: '' })
                }
              >
                {Object.entries(labels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Base URL
              <input
                className={field}
                type="url"
                required
                placeholder="https://api.example.com/v1"
                value={editor.baseUrl}
                onChange={(e) =>
                  setEditor({ ...editor, baseUrl: e.target.value, model: '' })
                }
              />
            </label>
            <label className="block text-sm">
              API key
              <input
                className={field}
                type="password"
                autoComplete="off"
                placeholder={
                  editor.id && editor.hasApiKey
                    ? 'Leave empty to keep the saved key'
                    : ''
                }
                required={!editor.id || !editor.hasApiKey}
                value={editor.apiKey}
                onChange={(e) =>
                  setEditor({ ...editor, apiKey: e.target.value, model: '' })
                }
              />
            </label>
            <UpstreamModelPicker
              key={JSON.stringify([
                apiRoot,
                editor.id,
                editor.harness,
                editor.baseUrl,
                editor.apiKey,
                editor.authType,
              ])}
              apiRoot={apiRoot}
              connection={editor}
              value={editor.model}
              onChange={(model) => setEditor({ ...editor, model })}
            />
            {editor.harness === 'claude' && (
              <label className="block text-sm">
                Authentication
                <select
                  className={field}
                  value={editor.authType ?? 'api_key'}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      authType: e.target.value,
                      model: '',
                    })
                  }
                >
                  <option value="api_key">API key (x-api-key)</option>
                  <option value="bearer">Bearer token</option>
                </select>
              </label>
            )}
            {editor.harness === 'grok' && (
              <>
                <label className="block text-sm">
                  API format
                  <select
                    className={field}
                    value={editor.apiType}
                    onChange={(e) =>
                      setEditor({ ...editor, apiType: e.target.value })
                    }
                  >
                    <option value="responses">Responses</option>
                    <option value="chat_completions">Chat completions</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Context window
                  <input
                    type="number"
                    min="1"
                    className={field}
                    value={editor.contextWindow}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        contextWindow: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </>
            )}
            {error && (
              <p
                role="alert"
                className="text-xs text-[var(--status-danger-fg)]"
              >
                {error}
              </p>
            )}
            <button
              className="relay-button-primary min-h-10"
              disabled={busy || !editor.model}
              type="submit"
            >
              {busy ? 'Saving…' : 'Save upstream'}
            </button>
          </form>
        </FormDialog>
      )}
      {mode && (
        <FormDialog
          title={
            mode === 'config'
              ? 'Import upstream configuration'
              : 'Import device template'
          }
          onClose={() => setMode(null)}
          busy={busy}
        >
          <div className="space-y-3">
            {mode === 'config' && (
              <>
                <label className="block text-sm">
                  Harness
                  <select
                    className={field}
                    value={importHarness}
                    onChange={(e) => setImportHarness(e.target.value)}
                  >
                    {Object.entries(labels).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Name
                  <input
                    className={field}
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  API key (if absent from the file)
                  <input
                    type="password"
                    autoComplete="off"
                    className={field}
                    value={importKey}
                    onChange={(e) => setImportKey(e.target.value)}
                  />
                </label>
                <p className="text-xs text-[var(--theme-fg-muted)]">
                  Paste native TOML/JSON or a CC Switch provider settingsConfig.
                  Only provider fields are imported.
                </p>
              </>
            )}
            <input
              ref={file}
              type="file"
              accept=".json,.toml,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  if (f.size > 256000) {
                    setError('Configuration must be smaller than 256 KB.');
                    return;
                  }
                  void f.text().then((v) => {
                    setText(v);
                    setPreview(null);
                  });
                }
              }}
            />
            <button className={button} onClick={() => file.current?.click()}>
              <Upload size={14} />
              Choose file
            </button>
            <textarea
              aria-label="Configuration JSON or TOML"
              className={`${field} min-h-56 font-mono text-xs`}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPreview(null);
              }}
            />
            {preview && (
              <div className="rounded-md border border-[var(--theme-border)] p-3 text-xs">
                <p>
                  Install if missing: {preview.harnesses.join(', ') || 'none'}
                </p>
                {preview.profiles.map((p) => (
                  <p className="mt-2 break-all" key={p.harness}>
                    {p.name} · {labels[p.harness]} · {p.model || '自动探测模型'}
                    <br />
                    {p.baseUrl}
                  </p>
                ))}
                <p className="mt-2">
                  Each completed step is retained if a later step fails.
                  Existing configuration is backed up before switching.
                </p>
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="text-xs text-[var(--status-danger-fg)]"
              >
                {error}
              </p>
            )}
            <button
              className="relay-button-primary min-h-10"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  if (mode === 'config') {
                    await api('upstreams/import', {
                      harness: importHarness,
                      name: importName,
                      config: text,
                      apiKey: importKey,
                    });
                    await load();
                    setMode(null);
                    setText('');
                    setImportKey('');
                  } else {
                    const template = JSON.parse(text);
                    if (!preview) {
                      setPreview(
                        await api('templates', { template, apply: false }),
                      );
                    } else {
                      await api('templates', { template, apply: true });
                      setJob({ state: 'running' });
                      setMode(null);
                      setText('');
                    }
                  }
                })
              }
            >
              {busy
                ? 'Working…'
                : mode === 'config'
                  ? 'Import upstream'
                  : preview
                    ? 'Apply template'
                    : 'Preview template'}
            </button>
          </div>
        </FormDialog>
      )}
    </section>
  );
}
