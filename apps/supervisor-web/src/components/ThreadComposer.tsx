import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import type {
  CollaborationModeDto,
  ModelOptionDto,
  ReasoningEffortDto,
  UpdateThreadSettingsInput,
} from '../../../../packages/shared/src/index';

interface ThreadComposerProps {
  busy?: boolean;
  settingsBusy?: boolean;
  error?: string | null;
  model?: string | null;
  reasoningEffort?: ReasoningEffortDto | null;
  collaborationMode?: CollaborationModeDto;
  modelOptions?: ModelOptionDto[];
  followTail?: boolean;
  disabled?: boolean;
  disabledPlaceholder?: string | undefined;
  onSubmit: (prompt: string) => Promise<void> | void;
  onInterrupt?: () => Promise<void> | void;
  onToggleFollow?: () => void;
  onUpdateSettings?: (input: UpdateThreadSettingsInput) => Promise<void> | void;
  canInterrupt?: boolean;
}

type SettingsMenu = 'model' | 'effort' | null;

function formatReasoningEffortLabel(value: ReasoningEffortDto | null | undefined) {
  if (!value) {
    return 'Auto';
  }

  switch (value) {
    case 'xhigh':
      return 'xhigh';
    default:
      return value;
  }
}

export function ThreadComposer({
  busy = false,
  settingsBusy = false,
  error,
  model = null,
  reasoningEffort = null,
  collaborationMode = 'default',
  modelOptions = [],
  followTail = false,
  disabled = false,
  disabledPlaceholder,
  onSubmit,
  onInterrupt,
  onToggleFollow,
  onUpdateSettings,
  canInterrupt = false,
}: ThreadComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [openMenu, setOpenMenu] = useState<SettingsMenu>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const currentModel = useMemo(
    () => modelOptions.find((entry) => entry.model === model) ?? null,
    [model, modelOptions],
  );
  const supportedEfforts = currentModel?.supportedReasoningEfforts ?? [];

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    if (openMenu) {
      window.addEventListener('mousedown', handlePointerDown);
      return () => {
        window.removeEventListener('mousedown', handlePointerDown);
      };
    }
  }, [openMenu]);

  async function submitPrompt() {
    if (!prompt.trim()) {
      return;
    }

    await onSubmit(prompt.trim());
    setPrompt('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPrompt();
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter') {
      return;
    }

    if (!event.metaKey && !event.ctrlKey) {
      return;
    }

    event.preventDefault();

    if (busy || disabled) {
      return;
    }

    void submitPrompt();
  }

  async function handleUpdateSettings(input: UpdateThreadSettingsInput) {
    await onUpdateSettings?.(input);
    setOpenMenu(null);
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={followTail ? 'Disable auto follow' : 'Enable auto follow'}
        title={followTail ? 'Disable auto follow' : 'Enable auto follow'}
        onClick={() => onToggleFollow?.()}
        className={`absolute left-4 top-0 z-[2] -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-lg shadow-stone-950/30 backdrop-blur transition ${
          followTail
            ? 'border-sky-300/40 bg-sky-300/16 text-sky-100'
            : 'border-stone-700 bg-stone-900/92 text-stone-300 hover:bg-stone-800'
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-4 w-4 fill-none stroke-current"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="4.5" />
          <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2" />
          <circle
            cx="8"
            cy="8"
            r="1.2"
            className={followTail ? 'fill-current stroke-none' : ''}
          />
        </svg>
      </button>

      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-stone-800 bg-stone-950/95 p-4 backdrop-blur sm:p-5"
      >
        <div className="relative">
          <textarea
            aria-label="Prompt"
            disabled={disabled}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            rows={3}
            placeholder={
              disabledPlaceholder ?? 'Ask Codex to inspect, modify, or explain code...'
            }
            className="min-h-14 w-full resize-y rounded-[1.5rem] border border-stone-700 bg-stone-900 px-4 pb-11 pr-16 pt-3 text-stone-100 outline-none transition focus:border-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:bg-stone-950 disabled:text-stone-500"
          />
          <button
            type="button"
            aria-label="Stop Current Turn"
            title="Stop Current Turn"
            onClick={() => void onInterrupt?.()}
            disabled={!canInterrupt}
            className={`absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur transition ${
              canInterrupt
                ? 'border-rose-300/35 bg-rose-300/12 text-rose-100 hover:bg-rose-300/18'
                : 'cursor-not-allowed border-stone-600/35 bg-stone-500/6 text-stone-500 opacity-55'
            }`}
          >
            <span
              aria-hidden="true"
              className="block h-2.5 w-2.5 rounded-[2px] bg-current"
            />
          </button>
          <button
            type="submit"
            aria-label="Send Prompt"
            disabled={busy || disabled}
            className="absolute bottom-3 right-3 rounded-full bg-amber-300/95 px-4 py-2 text-sm font-medium text-stone-950 shadow-lg shadow-stone-950/30 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
          >
            {busy ? 'Sending...' : 'Send'}
          </button>

          <div
            ref={menuRef}
            className="absolute bottom-3 left-4 z-[2] flex items-center gap-2 text-xs"
          >
            <div className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'model'}
                disabled={settingsBusy || modelOptions.length === 0}
                onClick={() =>
                  setOpenMenu((current) => (current === 'model' ? null : 'model'))
                }
                className="rounded-full px-2 py-1 text-stone-400 transition hover:bg-stone-800 hover:text-stone-100 disabled:cursor-not-allowed disabled:text-stone-600"
              >
                {model ?? 'Select model'}
              </button>
              {openMenu === 'model' && (
                <div className="absolute bottom-full left-0 mb-2 w-72 overflow-hidden rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl shadow-stone-950/40">
                  <div className="max-h-72 overflow-auto p-2">
                    {modelOptions.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() =>
                          void handleUpdateSettings({
                            model: entry.model,
                            reasoningEffort: entry.defaultReasoningEffort,
                          })
                        }
                        className={`block w-full rounded-xl px-3 py-2 text-left transition ${
                          entry.model === model
                            ? 'bg-amber-300/12 text-stone-100'
                            : 'text-stone-300 hover:bg-stone-800'
                        }`}
                      >
                        <p className="text-sm font-medium">{entry.displayName}</p>
                        <p className="mt-1 text-xs text-stone-500">{entry.model}</p>
                        <p className="mt-1 text-xs text-stone-400">{entry.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'effort'}
                disabled={settingsBusy || supportedEfforts.length === 0}
                onClick={() =>
                  setOpenMenu((current) => (current === 'effort' ? null : 'effort'))
                }
                className="rounded-full px-2 py-1 text-stone-500 transition hover:bg-stone-800 hover:text-stone-200 disabled:cursor-not-allowed disabled:text-stone-700"
              >
                {formatReasoningEffortLabel(reasoningEffort)}
              </button>
              {openMenu === 'effort' && (
                <div className="absolute bottom-full left-0 mb-2 w-64 overflow-hidden rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl shadow-stone-950/40">
                  <div className="max-h-72 overflow-auto p-2">
                    {supportedEfforts.map((entry) => (
                      <button
                        key={entry.reasoningEffort}
                        type="button"
                        onClick={() =>
                          void handleUpdateSettings({
                            reasoningEffort: entry.reasoningEffort,
                          })
                        }
                        className={`block w-full rounded-xl px-3 py-2 text-left transition ${
                          entry.reasoningEffort === reasoningEffort
                            ? 'bg-amber-300/12 text-stone-100'
                            : 'text-stone-300 hover:bg-stone-800'
                        }`}
                      >
                        <p className="text-sm font-medium">
                          {formatReasoningEffortLabel(entry.reasoningEffort)}
                        </p>
                        <p className="mt-1 text-xs text-stone-400">{entry.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              aria-pressed={collaborationMode === 'plan'}
              disabled={settingsBusy}
              onClick={() =>
                void handleUpdateSettings({
                  collaborationMode:
                    collaborationMode === 'plan' ? 'default' : 'plan',
                })
              }
              className={`rounded-full px-2.5 py-1 transition ${
                collaborationMode === 'plan'
                  ? 'bg-sky-300/18 text-sky-100'
                  : 'text-stone-500 hover:bg-stone-800 hover:text-stone-200'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              Plan
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
