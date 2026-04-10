import { FormEvent, useEffect, useRef, useState } from 'react';

function inferWorkspaceLabel(absPath: string) {
  const normalized = absPath.trim().replace(/[\\/]+$/, '');
  if (!normalized) {
    return '';
  }

  return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

interface WorkspaceFormProps {
  initialPath?: string;
  initialLabel?: string;
  submitLabel?: string;
  error?: string | null;
  busy?: boolean;
  onSubmit: (input: { absPath: string; label?: string }) => Promise<void> | void;
}

export function WorkspaceForm({
  initialPath = '',
  initialLabel = '',
  submitLabel = 'Save Workspace',
  error,
  busy = false,
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

    if (!absPath.trim()) {
      setLocalError('Absolute path is required.');
      return;
    }

    setLocalError(null);
    const normalizedLabel = label.trim();
    await onSubmit(
      normalizedLabel
        ? {
            absPath: absPath.trim(),
            label: normalizedLabel
          }
        : {
            absPath: absPath.trim()
          }
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl border border-stone-800 bg-stone-900 p-6">
      <div>
        <label htmlFor="workspace-path" className="text-sm font-medium text-stone-200">
          Absolute path
        </label>
        <input
          id="workspace-path"
          name="absPath"
          value={absPath}
          onChange={(event) => setAbsPath(event.target.value)}
          placeholder="/Users/name/project"
          className="mt-2 w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
        />
      </div>
      <div>
        <label htmlFor="workspace-label" className="text-sm font-medium text-stone-200">
          Display label
        </label>
        <input
          id="workspace-label"
          name="label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Optional override"
          className="mt-2 w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
        />
        <p className="mt-2 text-xs text-stone-500">
          Defaults to the last folder name. You can override it.
        </p>
      </div>
      {(localError || error) && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {localError ?? error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-amber-300 px-5 py-3 font-medium text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
      >
        {busy ? 'Saving...' : submitLabel}
      </button>
    </form>
  );
}
