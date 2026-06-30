import { FormEvent, useEffect, useRef, useState } from 'react';

function inferWorkspaceLabel(absPath: string) {
  const trimmed = absPath.trim();
  const normalized = trimmed.replace(/[\\/]+$/, '');
  if (!normalized) {
    return '';
  }

  if (isGitInput(trimmed)) {
    const withoutQuery = normalized.split(/[?#]/)[0] ?? normalized;
    const rawName = withoutQuery.split(/[/:]/).filter(Boolean).at(-1) ?? '';
    return rawName.endsWith('.git') ? rawName.slice(0, -4) : rawName;
  }

  return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

function isGitInput(value: string) {
  const trimmed = value.trim();
  return (
    /^https?:\/\/.+/i.test(trimmed) ||
    /^ssh:\/\/.+/i.test(trimmed) ||
    /^git@[^:]+:.+/.test(trimmed)
  );
}

interface WorkspaceFormProps {
  initialPath?: string;
  initialLabel?: string;
  submitLabel?: string;
  error?: string | null;
  busy?: boolean;
  surface?: boolean;
  onSubmit: (input: { absPath: string; label?: string } | { gitUrl: string; label?: string }) => Promise<void> | void;
}

export function WorkspaceForm({
  initialPath = '',
  initialLabel = '',
  submitLabel = 'Save Workspace',
  error,
  busy = false,
  surface = true,
  onSubmit
}: WorkspaceFormProps) {
  const initialAutoLabel = inferWorkspaceLabel(initialPath);
  const [absPath, setAbsPath] = useState(initialPath);
  const [label, setLabel] = useState(initialLabel || initialAutoLabel);
  const [localError, setLocalError] = useState<string | null>(null);
  const previousAutoLabelRef = useRef(initialAutoLabel);

  useEffect(() => {
    const nextAutoLabel = inferWorkspaceLabel(absPath);
    setLabel((current) => {
      if (!current.trim() || current === previousAutoLabelRef.current) {
        return nextAutoLabel;
      }

      return current;
    });
    previousAutoLabelRef.current = nextAutoLabel;
  }, [absPath]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const rawTarget = absPath.trim();
    if (!rawTarget) {
      setLocalError('Workspace path or Git URL is required.');
      return;
    }

    setLocalError(null);
    const normalizedLabel = label.trim();
    const targetKey = isGitInput(rawTarget) ? 'gitUrl' : 'absPath';
    await onSubmit(
      normalizedLabel
        ? {
            [targetKey]: rawTarget,
            label: normalizedLabel
          } as { absPath: string; label: string } | { gitUrl: string; label: string }
        : {
            [targetKey]: rawTarget
          } as { absPath: string } | { gitUrl: string }
    );
  }

  const formClassName = surface
    ? 'host-panel space-y-5 rounded-3xl border p-6'
    : 'space-y-5';

  return (
    <form onSubmit={handleSubmit} className={formClassName}>
      <div>
        <label htmlFor="workspace-path" className="host-form-label text-sm font-medium">
          Path or Git URL
        </label>
        <input
          id="workspace-path"
          name="absPath"
          value={absPath}
          onChange={(event) => setAbsPath(event.target.value)}
          placeholder="/Users/name/project or https://github.com/owner/repo.git"
          className="host-form-control mt-2 w-full rounded-2xl border px-4 py-3 outline-none transition"
        />
        <p className="host-muted mt-2 text-xs">
          Absolute paths register local directories. Git URLs clone into the configured dev home.
        </p>
      </div>
      <div>
        <label htmlFor="workspace-label" className="host-form-label text-sm font-medium">
          Display label
        </label>
        <input
          id="workspace-label"
          name="label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Optional override"
          className="host-form-control mt-2 w-full rounded-2xl border px-4 py-3 outline-none transition"
        />
        <p className="host-muted mt-2 text-xs">
          Defaults to the last folder name. You can override it.
        </p>
      </div>
      {(localError || error) && (
        <div className="host-error rounded-2xl border px-4 py-3 text-sm">
          {localError ?? error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="ui-action-primary rounded-full px-5 py-3 font-medium transition disabled:cursor-not-allowed"
      >
        {busy ? 'Saving...' : submitLabel}
      </button>
    </form>
  );
}
