import { FormEvent, useState } from 'react';

interface ThreadComposerProps {
  busy?: boolean;
  error?: string | null;
  model?: string | null;
  followTail?: boolean;
  disabled?: boolean;
  disabledPlaceholder?: string | undefined;
  onSubmit: (prompt: string) => Promise<void> | void;
  onInterrupt?: () => Promise<void> | void;
  onToggleFollow?: () => void;
  canInterrupt?: boolean;
}

export function ThreadComposer({
  busy = false,
  error,
  model = null,
  followTail = false,
  disabled = false,
  disabledPlaceholder,
  onSubmit,
  onInterrupt,
  onToggleFollow,
  canInterrupt = false,
}: ThreadComposerProps) {
  const [prompt, setPrompt] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) {
      return;
    }

    await onSubmit(prompt.trim());
    setPrompt('');
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={followTail ? 'Disable auto follow' : 'Enable auto follow'}
        title={followTail ? 'Disable auto follow' : 'Enable auto follow'}
        onClick={() => onToggleFollow?.()}
        className={`absolute left-4 top-0 z-[1] -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-lg shadow-stone-950/30 backdrop-blur transition ${
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
            rows={3}
            placeholder={
              disabledPlaceholder ?? 'Ask Codex to inspect, modify, or explain code...'
            }
            className="min-h-20 w-full resize-y rounded-[1.5rem] border border-stone-700 bg-stone-900 px-4 pb-12 pr-16 pt-4 text-stone-100 outline-none transition focus:border-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:bg-stone-950 disabled:text-stone-500"
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
            className="absolute bottom-3 right-3 rounded-full bg-amber-200/95 px-4 py-2 text-sm font-medium text-stone-950 shadow-lg shadow-stone-950/30 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
          >
            {busy ? 'Sending...' : 'Send'}
          </button>
          {model && (
            <div className="pointer-events-none absolute bottom-3 left-4 text-xs text-stone-500">
              {model}
            </div>
          )}
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
