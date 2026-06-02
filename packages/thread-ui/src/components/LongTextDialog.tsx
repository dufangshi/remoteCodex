import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface LongTextDialogProps {
  open: boolean;
  title: string;
  text: string;
  onClose: () => void;
}

export function LongTextDialog({
  open,
  title,
  text,
  onClose,
}: LongTextDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close full text"
        onClick={onClose}
        className="absolute inset-0 bg-stone-950/78 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-[1] flex max-h-[min(82vh,52rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[1.8rem] border border-stone-700 bg-stone-900 shadow-2xl shadow-stone-950/40"
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-800 px-4 py-3 sm:px-5">
          <p className="truncate text-sm font-medium text-stone-100">{title}</p>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-700 text-stone-300 transition hover:bg-stone-800"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-4 w-4 fill-current"
            >
              <path d="M3.22 2.47 8 7.25l4.78-4.78 1.06 1.06L9.06 8.31l4.78 4.78-1.06 1.06L8 9.37l-4.78 4.78-1.06-1.06 4.78-4.78-4.78-4.78 1.06-1.06Z" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5">
          <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-stone-200">
            {text}
          </pre>
        </div>
      </div>
    </div>,
    document.body,
  );
}
