import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type {
  ExportThreadPdfInput,
  ThreadExportFormatDto,
  ThreadExportTurnOptionDto,
  ThreadExportTurnOptionsDto,
} from '@remote-codex/shared';

type ExportMode = 'latest' | 'selected';
type ExportFormat = ThreadExportFormatDto;

interface ExportTranscriptDialogProps {
  open: boolean;
  busy?: boolean;
  turnsState: {
    status: 'idle' | 'loading' | 'ready' | 'failed';
    data: ThreadExportTurnOptionsDto | null;
    error: string | null;
  };
  onCancel: () => void;
  onLoadTurns: () => void | Promise<void>;
  onExport: (input: ExportThreadPdfInput) => void | Promise<void>;
}

function formatTurnTime(value: string | null) {
  if (!value) {
    return 'No time';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: ThreadExportTurnOptionDto['status']) {
  switch (status) {
    case 'inProgress':
      return 'running';
    case 'completed':
      return 'completed';
    case 'interrupted':
      return 'interrupted';
    case 'failed':
      return 'failed';
  }
}

export function ExportTranscriptDialog({
  open,
  busy = false,
  turnsState,
  onCancel,
  onLoadTurns,
  onExport,
}: ExportTranscriptDialogProps) {
  const turns = useMemo(() => turnsState.data?.turns ?? [], [turnsState.data?.turns]);
  const latestTurnIds = useMemo(
    () => turns.slice(0, 10).map((turn) => turn.turnId),
    [turns],
  );
  const [mode, setMode] = useState<ExportMode>('latest');
  const [selectedTurnIds, setSelectedTurnIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [includeTokenAndPrice, setIncludeTokenAndPrice] = useState(true);
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' &&
    !document.documentElement.classList.contains('dark')
      ? 'light'
      : 'dark',
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setMode('latest');
    setFormat('pdf');
    setIncludeTokenAndPrice(true);
    void onLoadTurns();
  }, [onLoadTurns, open]);

  useEffect(() => {
    if (open && turns.length > 0) {
      setSelectedTurnIds(new Set(latestTurnIds));
    }
  }, [latestTurnIds, open, turns.length]);

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
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const shell = document.querySelector<HTMLElement>('.thread-ui-shell');
    const readTheme = () => {
      if (!shell) {
        return document.documentElement.classList.contains('dark')
          ? 'dark'
          : 'light';
      }
      return shell.getAttribute('data-theme-effective') === 'dark' ||
        shell.classList.contains('dark') ||
        shell.classList.contains('thread-ui-theme-dark')
        ? 'dark'
        : 'light';
    };

    setEffectiveTheme(readTheme());
    if (!shell) {
      return;
    }

    const observer = new MutationObserver(() => setEffectiveTheme(readTheme()));
    observer.observe(shell, {
      attributes: true,
      attributeFilter: ['class', 'data-theme-effective'],
    });
    return () => observer.disconnect();
  }, [open]);

  if (!open) {
    return null;
  }

  const selectedCount =
    mode === 'latest' ? Math.min(10, turnsState.data?.totalTurnCount ?? 10) : selectedTurnIds.size;
  const canExport = !busy && (mode === 'latest' || selectedTurnIds.size > 0);

  function toggleTurn(turnId: string) {
    setSelectedTurnIds((current) => {
      const next = new Set(current);
      if (next.has(turnId)) {
        next.delete(turnId);
      } else {
        next.add(turnId);
      }
      return next;
    });
  }

  function handleExport() {
    const input: ExportThreadPdfInput = {
      format,
      mode,
      ...(mode === 'latest'
        ? { limit: 10 }
        : { turnIds: [...selectedTurnIds] }),
      profile: 'review',
      options: {
        includeTokenAndPrice,
      },
    };
    void onExport(input);
  }

  return createPortal(
    <div
      className={`thread-export-dialog-root thread-ui-theme-${effectiveTheme} fixed inset-0 z-[96] flex items-center justify-center p-3 sm:p-6`}
      data-theme-effective={effectiveTheme}
    >
      <button
        type="button"
        aria-label="Close export dialog"
        onClick={onCancel}
        disabled={busy}
        className="thread-export-dialog-backdrop absolute inset-0 backdrop-blur-sm disabled:cursor-not-allowed"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export transcript"
        className="thread-export-dialog-panel relative z-[1] flex max-h-[min(46rem,calc(100vh-2rem))] w-full max-w-2xl flex-col rounded-[1.6rem] border shadow-2xl"
      >
        <div className="thread-export-dialog-header flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <p className="thread-export-dialog-title text-sm font-semibold">Export transcript</p>
            <p className="thread-export-dialog-subtitle mt-1 text-xs">
              Default review copy summarizes command batches and file changes.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onCancel}
            disabled={busy}
            className="thread-export-dialog-icon-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-current">
              <path d="M3.22 2.47 8 7.25l4.78-4.78 1.06 1.06L9.06 8.31l4.78 4.78-1.06 1.06L8 9.37l-4.78 4.78-1.06-1.06 4.78-4.78-4.78-4.78 1.06-1.06Z" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="thread-export-dialog-segment inline-flex rounded-full border p-1">
            {[
              ['latest', 'Latest 10'],
              ['selected', 'Custom selection'],
            ].map(([entryMode, label]) => (
              <button
                key={entryMode}
                type="button"
                onClick={() => setMode(entryMode as ExportMode)}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  mode === entryMode
                    ? 'ui-status-warning'
                    : 'thread-export-dialog-muted-action'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="thread-export-dialog-segment mt-4 inline-flex rounded-full border p-1">
            {[
              ['pdf', 'PDF'],
              ['html', 'HTML'],
            ].map(([entryFormat, label]) => (
              <button
                key={entryFormat}
                type="button"
                onClick={() => setFormat(entryFormat as ExportFormat)}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  format === entryFormat
                    ? 'ui-status-warning'
                    : 'thread-export-dialog-muted-action'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'selected' ? (
            <div className="thread-export-dialog-box mt-4 rounded-2xl border">
              <div className="thread-export-dialog-box-header flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
                <p className="thread-export-dialog-subtitle text-xs">
                  Selected {selectedTurnIds.size} of {turnsState.data?.totalTurnCount ?? turns.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedTurnIds(new Set(turns.map((turn) => turn.turnId)))}
                    className="thread-export-dialog-secondary-button rounded-full border px-2.5 py-1 text-xs transition"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedTurnIds(new Set())}
                    className="thread-export-dialog-secondary-button rounded-full border px-2.5 py-1 text-xs transition"
                  >
                    Clear
                  </button>
                </div>
              </div>
              {turnsState.status === 'loading' ? (
                <p className="thread-export-dialog-subtitle px-3 py-6 text-sm">Loading turns...</p>
              ) : turnsState.status === 'failed' ? (
                <p className="px-3 py-6 text-sm text-rose-500 dark:text-rose-200">{turnsState.error}</p>
              ) : (
                <div className="max-h-80 overflow-auto p-2">
                  {turns.map((turn) => (
                    <label
                      key={turn.turnId}
                      className="thread-export-dialog-turn-row flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTurnIds.has(turn.turnId)}
                        onChange={() => toggleTurn(turn.turnId)}
                        className="thread-export-dialog-checkbox h-4 w-4"
                      />
                      <span className="thread-export-dialog-strong shrink-0 text-xs font-medium">
                        Turn {turn.turnNumber}
                      </span>
                      <span className="thread-export-dialog-subtitle shrink-0 text-xs">
                        {formatTurnTime(turn.startedAt)}
                      </span>
                      <span className="thread-export-dialog-body-text min-w-0 flex-1 truncate text-left">
                        {turn.userPromptPreview}
                      </span>
                      <span className="thread-export-dialog-status-pill hidden shrink-0 rounded-full border px-2 py-0.5 text-[10px] sm:inline">
                        {statusLabel(turn.status)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="thread-export-dialog-box thread-export-dialog-body-text mt-4 rounded-2xl border px-3 py-3 text-sm">
              Exports the latest 10 turns in chronological order.
            </p>
          )}

          <div className="thread-export-dialog-body-text mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <label className="thread-export-dialog-box flex items-center gap-2 rounded-xl border px-3 py-2">
              <input
                type="checkbox"
                checked={includeTokenAndPrice}
                onChange={(event) => setIncludeTokenAndPrice(event.target.checked)}
                className="thread-export-dialog-checkbox h-4 w-4"
              />
              Token and price
            </label>
            <p className="thread-export-dialog-box thread-export-dialog-subtitle flex items-center rounded-xl border px-3 py-2 text-xs">
              {format === 'html'
                ? 'HTML keeps the chat timeline styling and omits raw command output.'
                : 'Review exports keep message text readable and omit tool activity.'}
            </p>
          </div>
        </div>

        <div className="thread-export-dialog-footer flex items-center justify-between gap-3 border-t px-5 py-4">
          <p className="thread-export-dialog-subtitle min-w-0 text-xs">
            {selectedCount} {selectedCount === 1 ? 'turn' : 'turns'} will be exported.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="thread-export-dialog-secondary-button rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!canExport}
              className="ui-status-warning rounded-full px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Exporting...' : `Export ${format.toUpperCase()}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
