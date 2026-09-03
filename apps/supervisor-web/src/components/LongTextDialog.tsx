import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { useDialogLifecycle } from './useDialogLifecycle';

interface LongTextDialogProps {
  open: boolean;
  title: string;
  text: string;
  onClose: () => void;
}

export function LongTextDialog({ open, title, text, onClose }: LongTextDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useDialogLifecycle({
    containerRef: dialogRef,
    initialFocusRef: closeRef,
    onClose,
    open,
  });

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6">
      <button
        aria-label="Close full text"
        className="ui-overlay-scrim absolute inset-0 backdrop-blur-[2px]"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="host-dialog relative z-[1] flex max-h-[min(82vh,52rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border shadow-[var(--theme-shadow)]"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--theme-border)] px-4 sm:px-5">
          <h2 className="host-page-title truncate text-sm font-semibold" id={titleId}>
            {title}
          </h2>
          <button
            aria-label="Close dialog"
            className="host-icon-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition sm:h-9 sm:w-9"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5">
          <pre className="host-soft whitespace-pre-wrap break-words text-sm leading-6">
            {text}
          </pre>
        </div>
      </div>
    </div>,
    document.body,
  );
}
