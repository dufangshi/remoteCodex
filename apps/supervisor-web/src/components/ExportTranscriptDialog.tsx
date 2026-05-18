import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type {
  ExportThreadPdfInput,
  ThreadExportFormatDto,
  ThreadExportTurnOptionDto,
  ThreadExportTurnOptionsDto,
} from '../../../../packages/shared/src/index';

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
  const turns = turnsState.data?.turns ?? [];
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
    <div className="fixed inset-0 z-[96] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close export dialog"
        onClick={onCancel}
        disabled={busy}
        className="absolute inset-0 bg-stone-950/78 backdrop-blur-sm disabled:cursor-not-allowed"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export transcript"
        className="relative z-[1] flex max-h-[min(46rem,calc(100vh-2rem))] w-full max-w-2xl flex-col rounded-[1.6rem] border border-stone-700 bg-stone-900 shadow-2xl shadow-stone-950/40"
      >
        <div className="flex items-start justify-between gap-3 border-b border-stone-800 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-100">Export transcript</p>
            <p className="mt-1 text-xs text-stone-500">
              Default review copy summarizes command batches and file changes.
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

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="inline-flex rounded-full border border-stone-700 bg-stone-950/60 p-1">
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
                    : 'text-stone-400 hover:text-stone-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 inline-flex rounded-full border border-stone-700 bg-stone-950/60 p-1">
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
                    : 'text-stone-400 hover:text-stone-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'selected' ? (
            <div className="mt-4 rounded-2xl border border-stone-800 bg-stone-950/40">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-800 px-3 py-2.5">
                <p className="text-xs text-stone-400">
                  Selected {selectedTurnIds.size} of {turnsState.data?.totalTurnCount ?? turns.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedTurnIds(new Set(turns.map((turn) => turn.turnId)))}
                    className="rounded-full border border-stone-700 px-2.5 py-1 text-xs text-stone-300 transition hover:bg-stone-800"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedTurnIds(new Set())}
                    className="rounded-full border border-stone-700 px-2.5 py-1 text-xs text-stone-300 transition hover:bg-stone-800"
                  >
                    Clear
                  </button>
                </div>
              </div>
              {turnsState.status === 'loading' ? (
                <p className="px-3 py-6 text-sm text-stone-400">Loading turns...</p>
              ) : turnsState.status === 'failed' ? (
                <p className="px-3 py-6 text-sm text-rose-100">{turnsState.error}</p>
              ) : (
                <div className="max-h-80 overflow-auto p-2">
                  {turns.map((turn) => (
                    <label
                      key={turn.turnId}
                      className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition hover:bg-stone-800/70"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTurnIds.has(turn.turnId)}
                        onChange={() => toggleTurn(turn.turnId)}
                        className="h-4 w-4 accent-amber-300"
                      />
                      <span className="shrink-0 text-xs font-medium text-stone-300">
                        Turn {turn.turnNumber}
                      </span>
                      <span className="shrink-0 text-xs text-stone-500">
                        {formatTurnTime(turn.startedAt)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left text-stone-200">
                        {turn.userPromptPreview}
                      </span>
                      <span className="hidden shrink-0 rounded-full border border-stone-700 px-2 py-0.5 text-[10px] text-stone-400 sm:inline">
                        {statusLabel(turn.status)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 rounded-2xl border border-stone-800 bg-stone-950/40 px-3 py-3 text-sm text-stone-300">
              Exports the latest 10 turns in chronological order.
            </p>
          )}

          <div className="mt-4 grid gap-2 text-sm text-stone-300 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl border border-stone-800 bg-stone-950/35 px-3 py-2">
              <input
                type="checkbox"
                checked={includeTokenAndPrice}
                onChange={(event) => setIncludeTokenAndPrice(event.target.checked)}
                className="h-4 w-4 accent-amber-300"
              />
              Token and price
            </label>
            <p className="flex items-center rounded-xl border border-stone-800 bg-stone-950/35 px-3 py-2 text-xs text-stone-500">
              {format === 'html'
                ? 'HTML keeps the chat timeline styling and omits raw command output.'
                : 'Review exports keep message text readable and omit tool activity.'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-stone-800 px-5 py-4">
          <p className="min-w-0 text-xs text-stone-500">
            {selectedCount} {selectedCount === 1 ? 'turn' : 'turns'} will be exported.
          </p>
          <div className="flex items-center gap-2">
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
