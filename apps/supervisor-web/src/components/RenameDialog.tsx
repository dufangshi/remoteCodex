import { FormEvent, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface RenameDialogProps {
  open: boolean;
  title: string;
  label: string;
  value: string;
  busy?: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
}

export function RenameDialog({
  open,
  title,
  label,
  value,
  busy = false,
  onChange,
  onCancel,
  onSubmit,
}: RenameDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [busy, onCancel, open]);

  if (!open) {
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit();
  }

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close rename dialog"
        onClick={onCancel}
        disabled={busy}
        className="absolute inset-0 bg-stone-950/78 backdrop-blur-sm disabled:cursor-not-allowed"
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={handleSubmit}
        className="relative z-[1] w-full max-w-md rounded-[1.6rem] border border-stone-700 bg-stone-900 p-5 shadow-2xl shadow-stone-950/40 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-stone-100">{title}</p>
            <p className="mt-1 text-sm text-stone-500">
              Changes are saved only after confirmation.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-700 text-stone-300 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-current">
              <path d="M3.22 2.47 8 7.25l4.78-4.78 1.06 1.06L9.06 8.31l4.78 4.78-1.06 1.06L8 9.37l-4.78 4.78-1.06-1.06 4.78-4.78-4.78-4.78 1.06-1.06Z" />
            </svg>
          </button>
        </div>

        <div className="mt-5">
          <label htmlFor="rename-dialog-input" className="text-sm font-medium text-stone-200">
            {label}
          </label>
          <input
            id="rename-dialog-input"
            aria-label={label}
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
          />
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-stone-700 px-4 py-2 text-sm font-medium text-stone-300 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-medium text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
          >
            Save
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
