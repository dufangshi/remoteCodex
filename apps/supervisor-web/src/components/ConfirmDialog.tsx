import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { useDialogLifecycle } from './useDialogLifecycle';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  busyLabel = 'Deleting...',
  busy = false,
  error,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useDialogLifecycle({
    busy,
    containerRef: dialogRef,
    initialFocusRef: cancelRef,
    onClose: onCancel,
    open,
  });

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-6">
      <button
        aria-label="Close confirmation dialog"
        className="ui-overlay-scrim absolute inset-0 backdrop-blur-[2px] disabled:cursor-not-allowed"
        disabled={busy}
        onClick={onCancel}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="host-dialog relative z-[1] w-full max-w-md rounded-lg border p-5 shadow-[var(--theme-shadow)] sm:p-6"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="host-page-title text-base font-semibold" id={titleId}>
              {title}
            </h2>
            <p className="host-muted mt-2 text-sm leading-6" id={descriptionId}>
              {description}
            </p>
          </div>
          <button
            aria-label="Close dialog"
            className="host-icon-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <p className="host-error mt-4 rounded-md border px-3 py-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="host-secondary-button min-h-11 rounded-md border px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            Cancel
          </button>
          <button
            className="ui-action-danger min-h-11 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed"
            disabled={busy}
            onClick={() => void onConfirm()}
            type="button"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
