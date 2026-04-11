import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
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

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close confirmation dialog"
        onClick={onCancel}
        disabled={busy}
        className="absolute inset-0 bg-stone-950/78 backdrop-blur-sm disabled:cursor-not-allowed"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-[1] w-full max-w-md rounded-[1.6rem] border border-stone-700 bg-stone-900 p-5 shadow-2xl shadow-stone-950/40 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-stone-100">{title}</p>
            <p className="mt-2 text-sm leading-6 text-stone-400">{description}</p>
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
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy}
            className="rounded-full bg-rose-300 px-4 py-2 text-sm font-medium text-stone-950 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
          >
            {busy ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
