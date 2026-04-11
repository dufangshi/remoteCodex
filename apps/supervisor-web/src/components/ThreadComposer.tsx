import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  CollaborationModeDto,
  ModelOptionDto,
  PromptAttachmentKindDto,
  ReasoningEffortDto,
  UpdateThreadSettingsInput,
} from '../../../../packages/shared/src/index';
import type { ThreadShellControlState } from './ThreadShellPanel';
import type { PromptAttachmentUpload } from '../lib/api';

interface ThreadComposerProps {
  activeView: 'chat' | 'shell';
  edgeToEdgeMobile?: boolean;
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
  shellControlState?: ThreadShellControlState | null;
  onSubmit: (input: {
    prompt: string;
    attachments?: PromptAttachmentUpload[];
  }) => Promise<void> | void;
  onInterrupt?: () => Promise<void> | void;
  onToggleFollow?: () => void;
  onUpdateSettings?: (input: UpdateThreadSettingsInput) => Promise<void> | void;
  onToggleView?: () => void;
  onToggleShellConnection?: () => Promise<void> | void;
  onShellCopy?: () => Promise<void> | void;
  onShellControl?: (
    action: 'ctrl_c' | 'ctrl_d' | 'esc' | 'tab' | 'up' | 'down' | 'clear',
  ) => Promise<void> | void;
  canInterrupt?: boolean;
}

type SettingsMenu = 'attachments' | 'model' | 'effort' | 'shellTools' | null;

interface ComposerAttachmentDraft extends PromptAttachmentUpload {}

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

function TerminalIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 5 2 2-2 2" />
      <path d="M7.75 9.5h4.25" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  );
}

function normalizedAttachmentFileName(file: File, kind: PromptAttachmentKindDto) {
  const trimmed = file.name.trim();
  if (trimmed) {
    return trimmed;
  }

  const fallbackExtension =
    kind === 'photo'
      ? file.type.includes('png')
        ? '.png'
        : file.type.includes('heic')
          ? '.heic'
          : file.type.includes('heif')
            ? '.heif'
            : file.type.includes('webp')
              ? '.webp'
              : '.jpg'
      : '';
  return `${kind === 'photo' ? 'photo' : 'file'}-${Date.now()}${fallbackExtension}`;
}

function normalizeAttachmentLabel(name: string) {
  const sanitized = name.replace(/[\r\n[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'attachment';
}

function ChatIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4.5A1.75 1.75 0 0 1 4.75 2.75h6.5A1.75 1.75 0 0 1 13 4.5v4A1.75 1.75 0 0 1 11.25 10.25H8l-2.75 2v-2H4.75A1.75 1.75 0 0 1 3 8.5v-4Z" />
    </svg>
  );
}

function ConnectionIcon({ connected }: { connected: boolean }) {
  if (!connected) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 fill-none stroke-current"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13.181 8.68a4.503 4.503 0 0 1 1.903 6.405m-9.768-2.782L3.56 14.06a4.5 4.5 0 0 0 6.364 6.365l3.129-3.129m5.614-5.615 1.757-1.757a4.5 4.5 0 0 0-6.364-6.365l-4.5 4.5c-.258.26-.479.541-.661.84m1.903 6.405a4.495 4.495 0 0 1-1.242-.88 4.483 4.483 0 0 1-1.062-1.683m6.587 2.345 5.907 5.907m-5.907-5.907L8.898 8.898M2.991 2.99 8.898 8.9" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    </svg>
  );
}

function WrenchScrewdriverIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5 fill-current"
    >
      <path
        fillRule="evenodd"
        d="M14.5 10C16.9853 10 19 7.98528 19 5.5C19 5.01783 18.9242 4.55338 18.7838 4.11791C18.6792 3.79367 18.2734 3.72683 18.0325 3.96772L15.3402 6.66002C15.2098 6.79041 15.0168 6.84163 14.8466 6.77074C14.1172 6.46695 13.5334 5.88351 13.2292 5.15431C13.1582 4.98403 13.2094 4.79088 13.3398 4.66042L16.0327 1.9676C16.2735 1.72672 16.2067 1.32092 15.8825 1.21636C15.4469 1.07588 14.9823 1 14.5 1C12.0147 1 10 3.01472 10 5.5C10 5.59783 10.0031 5.69494 10.0093 5.79122C10.065 6.66418 9.88174 7.59855 9.20974 8.15855L1.98017 14.1832C1.3591 14.7008 1 15.4674 1 16.2759C1 17.7804 2.21962 19 3.7241 19C4.53256 19 5.29925 18.6409 5.81681 18.0198L11.8414 10.7903C12.4014 10.1183 13.3358 9.93497 14.2088 9.99073C14.3051 9.99688 14.4022 10 14.5 10ZM5 16C5 16.5523 4.55228 17 4 17C3.44772 17 3 16.5523 3 16C3 15.4477 3.44772 15 4 15C4.55228 15 5 15.4477 5 16Z"
        clipRule="evenodd"
      />
      <path d="M14.5 11.5C14.6731 11.5 14.8445 11.4927 15.0138 11.4783L18.7678 15.2323C19.7441 16.2086 19.7441 17.7915 18.7678 18.7678C17.7915 19.7441 16.2086 19.7441 15.2323 18.7678L10.8216 14.3571L12.9938 11.7505C13.0455 11.6885 13.1413 11.6131 13.3357 11.5552C13.5378 11.4951 13.805 11.468 14.1132 11.4877C14.2413 11.4959 14.3702 11.5 14.5 11.5Z" />
      <path d="M6.00003 4.58582L8.33056 6.91635C8.3027 6.95627 8.27496 6.98497 8.24946 7.00622L6.79994 8.21415L4.58582 6.00003H3.30905C3.11966 6.00003 2.94653 5.89303 2.86184 5.72364L1.1612 2.32237C1.06495 2.12987 1.10268 1.89739 1.25486 1.74521L1.74521 1.25486C1.89739 1.10268 2.12987 1.06495 2.32237 1.1612L5.72364 2.86184C5.89303 2.94653 6.00003 3.11966 6.00003 3.30905V4.58582Z" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 3.25h5" />
      <path d="M6.4 2h3.2a.9.9 0 0 1 .9.9v.35h1.3a1.2 1.2 0 0 1 1.2 1.2v7.35a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 11.8V4.45a1.2 1.2 0 0 1 1.2-1.2h1.3V2.9a.9.9 0 0 1 .9-.9Z" />
    </svg>
  );
}

function ToolPill({
  label,
  tone = 'stone',
}: {
  label: string;
  tone?: 'stone' | 'rose' | 'sky';
}) {
  const toneClassName =
    tone === 'rose'
      ? 'border-rose-300/35 bg-rose-300/14 text-rose-50'
      : tone === 'sky'
        ? 'border-sky-300/35 bg-sky-300/14 text-sky-50'
        : 'border-stone-700/90 bg-stone-900/80 text-stone-100';

  return (
    <span
      className={`inline-flex min-w-[3rem] items-center justify-center rounded-full border px-2 py-1.5 text-[10px] font-medium tracking-[0.12em] ${toneClassName}`}
    >
      {label}
    </span>
  );
}

export function ThreadComposer({
  activeView,
  edgeToEdgeMobile = false,
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
  shellControlState = null,
  onSubmit,
  onInterrupt,
  onToggleFollow,
  onUpdateSettings,
  onToggleView,
  onToggleShellConnection,
  onShellCopy,
  onShellControl,
  canInterrupt = false,
}: ThreadComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachmentDraft[]>([]);
  const [openMenu, setOpenMenu] = useState<SettingsMenu>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isShellView = activeView === 'shell';
  const isMobileShell = Boolean(isShellView && shellControlState?.isMobileShell);
  const shellPromptLabel = shellControlState?.promptLabel ?? null;

  const currentModel = useMemo(
    () => modelOptions.find((entry) => entry.model === model) ?? null,
    [model, modelOptions],
  );
  const supportedEfforts = currentModel?.supportedReasoningEfforts ?? [];

  function buildAttachmentPlaceholder(
    kind: PromptAttachmentKindDto,
    name: string,
    usedPlaceholders: Set<string>,
  ) {
    const token = kind === 'photo' ? 'PHOTO' : 'FILE';
    let suffix = 0;

    while (true) {
      const label = suffix === 0 ? name : `${name} (${suffix + 1})`;
      const placeholder = `[${token} ${label}]`;
      if (!usedPlaceholders.has(placeholder)) {
        return placeholder;
      }
      suffix += 1;
    }
  }

  function buildClientId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function appendAttachments(
    files: FileList | null,
    kind: PromptAttachmentKindDto,
  ) {
    if (!files || files.length === 0) {
      return;
    }

    const nextFiles = Array.from(files);
    const usedPlaceholders = new Set<string>(attachments.map((entry) => entry.placeholder));
    const nextAttachments: ComposerAttachmentDraft[] = nextFiles.map((file) => {
      const originalName = normalizedAttachmentFileName(file, kind);
      const placeholder = buildAttachmentPlaceholder(
        kind,
        normalizeAttachmentLabel(originalName),
        usedPlaceholders,
      );
      usedPlaceholders.add(placeholder);
      return {
        clientId: buildClientId(),
        kind,
        originalName,
        placeholder,
        file
      };
    });

    setAttachments((current) => [...current, ...nextAttachments]);
    setPrompt((current) => {
      const suffix = nextAttachments.map((entry) => entry.placeholder).join(' ');
      const normalized = current.trimEnd();
      return normalized ? `${normalized} ${suffix}` : suffix;
    });
    setOpenMenu(null);
  }

  useEffect(() => {
    function handleWindowClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    if (openMenu) {
      window.addEventListener('click', handleWindowClick);
      return () => {
        window.removeEventListener('click', handleWindowClick);
      };
    }
  }, [openMenu]);

  function dismissPromptFocus() {
    promptRef.current?.blur();
    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
    ) {
      document.activeElement.blur();
    }
  }

  async function pasteClipboardIntoPrompt() {
    dismissPromptFocus();
    setOpenMenu(null);

    if (!navigator.clipboard?.readText) {
      return;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText) {
        return;
      }

      setPrompt((current) => `${current}${clipboardText}`);
    } catch {
      return;
    }
  }

  async function submitPrompt() {
    if (!isShellView && !prompt.trim()) {
      return;
    }

    const normalizedPrompt = isShellView ? prompt : prompt.trim();
    const activeAttachments = isShellView
      ? []
      : attachments.filter((attachment) => normalizedPrompt.includes(attachment.placeholder));

    await onSubmit(
      activeAttachments.length > 0
        ? { prompt: normalizedPrompt, attachments: activeAttachments }
        : { prompt: normalizedPrompt }
    );
    setPrompt('');
    setAttachments([]);
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

  const connectionEnabled = shellControlState?.connectionButtonDisabled !== true;
  const connectionActive = shellControlState?.status === 'attached';
  const connectionButtonClassName = connectionActive
    ? 'border-emerald-300/45 bg-emerald-300/18 text-emerald-50 ring-1 ring-emerald-300/20 hover:bg-emerald-300/24'
    : 'border-stone-600 bg-stone-800/90 text-stone-100 hover:border-stone-500 hover:bg-stone-800';
  const promptPlaceholder =
    disabledPlaceholder ??
    (isShellView
      ? 'Send shell input to the attached terminal...'
      : 'Ask Codex to inspect, modify, or explain code...');
  const interruptLabel = isShellView ? 'Send Ctrl-C' : 'Stop Current Turn';
  const formClassName = edgeToEdgeMobile || isMobileShell
    ? 'relative z-20 shrink-0 bg-transparent px-3 pb-0 pt-3 sm:p-4'
    : 'relative z-20 shrink-0 border-t border-stone-800 bg-stone-950/95 p-3 backdrop-blur sm:p-4';

  return (
    <div className="relative z-20 shrink-0">
      {activeView === 'chat' && (
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
      )}

      <form
        onSubmit={handleSubmit}
        className={formClassName}
      >
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            appendAttachments(event.target.files, 'photo');
            event.target.value = '';
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            appendAttachments(event.target.files, 'file');
            event.target.value = '';
          }}
        />
        <div className="relative">
          <textarea
            ref={promptRef}
            aria-label="Prompt"
            disabled={activeView === 'chat' ? disabled : false}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            rows={2}
            placeholder={promptPlaceholder}
            className="min-h-12 w-full resize-y rounded-[1.25rem] border border-stone-700 bg-stone-900 px-4 pb-10 pr-14 pt-2.5 text-stone-100 outline-none transition focus:border-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:bg-stone-950 disabled:text-stone-500"
          />
          <button
            type="button"
            aria-label={interruptLabel}
            title={interruptLabel}
            onClick={() => void onInterrupt?.()}
            disabled={!canInterrupt}
            className={`absolute right-2.5 top-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition ${
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
            aria-label={isShellView ? 'Send Shell Input' : 'Send Prompt'}
            disabled={busy || (activeView === 'chat' ? disabled : false)}
            className="absolute bottom-2.5 right-2.5 rounded-full bg-amber-300/95 px-3.5 py-1.5 text-sm font-medium text-stone-950 shadow-lg shadow-stone-950/30 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
          >
            {busy && !isShellView ? 'Sending...' : 'Send'}
          </button>

          <div
            ref={menuRef}
            className="absolute bottom-2.5 left-3 z-30 flex max-w-[calc(100%-7rem)] items-center gap-1.5 text-xs"
          >
            {!isShellView && (
              <>
                <button
                  type="button"
                  aria-label="Add attachment"
                  title="Add attachment"
                  onClick={() =>
                    setOpenMenu((current) =>
                      current === 'attachments' ? null : 'attachments',
                    )
                  }
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-700 bg-stone-900/92 text-stone-200 transition hover:bg-stone-800"
                >
                  <PlusIcon />
                </button>

                {openMenu === 'attachments' && (
                  <div className="absolute bottom-full left-0 mb-2 w-32 overflow-hidden rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl shadow-stone-950/40">
                    <div className="p-2">
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-stone-200 transition hover:bg-stone-800"
                      >
                        Photo
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-1 block w-full rounded-xl px-3 py-2 text-left text-sm text-stone-200 transition hover:bg-stone-800"
                      >
                        File
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <button
              type="button"
              aria-label={isShellView ? 'Switch to chat' : 'Switch to shell'}
              title={isShellView ? 'Switch to chat' : 'Switch to shell'}
              onClick={() => onToggleView?.()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-700 bg-stone-900/92 text-stone-200 transition hover:bg-stone-800"
            >
              {isShellView ? <ChatIcon /> : <TerminalIcon />}
            </button>

            <button
              type="button"
              aria-label={shellControlState?.connectionButtonLabel ?? 'Toggle shell connection'}
              title={shellControlState?.connectionButtonLabel ?? 'Toggle shell connection'}
              disabled={!connectionEnabled}
              onClick={() => void onToggleShellConnection?.()}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${connectionButtonClassName}`}
            >
              <ConnectionIcon connected={connectionActive} />
            </button>

            {isShellView && shellPromptLabel && (
              <span
                className="min-w-0 max-w-[11rem] truncate rounded-full px-1.5 py-1 text-stone-400"
                title={shellPromptLabel}
              >
                {shellPromptLabel}
              </span>
            )}

            {!isShellView && (
              <>
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
              </>
            )}

            {isMobileShell && (
              <div className="relative">
                <button
                  type="button"
                  aria-label={openMenu === 'shellTools' ? 'Close shell tools' : 'Open shell tools'}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'shellTools'}
                  title={openMenu === 'shellTools' ? 'Close shell tools' : 'Open shell tools'}
                  onClick={() => {
                    dismissPromptFocus();
                    setOpenMenu((current) => (current === 'shellTools' ? null : 'shellTools'))
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-700 bg-stone-900/92 text-stone-200 transition hover:bg-stone-800"
                >
                  <WrenchScrewdriverIcon />
                </button>
                {openMenu === 'shellTools' && (
                  <div
                    className="absolute bottom-full right-0 z-40 mb-2 w-[11.5rem] max-w-[calc(100vw-1.5rem)] rounded-[1rem] border border-stone-700/90 bg-stone-950/96 p-2 shadow-2xl shadow-stone-950/40 sm:w-48"
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onTouchStart={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void pasteClipboardIntoPrompt()}
                        className="inline-flex items-center justify-center rounded-full border border-sky-300/35 bg-sky-300/12 px-2 py-2 text-sky-50"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <ClipboardIcon />
                          <span className="text-[10px] font-medium tracking-[0.12em]">
                            Paste
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellCopy?.();
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-stone-700/90 bg-stone-900/80 px-2 py-2 text-stone-100"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <ClipboardIcon />
                          <span className="text-[10px] font-medium tracking-[0.12em]">
                            Copy
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onSubmit({ prompt: 'clear' });
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="CLEAR" tone="sky" />
                      </button>
                      <button
                        type="button"
                        disabled={
                          !shellControlState?.shellInputEnabled ||
                          !shellControlState?.isCommandRunning
                        }
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('ctrl_c');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="CTRL-C" tone="rose" />
                      </button>
                      <button
                        type="button"
                        disabled={!shellControlState?.shellInputEnabled}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('ctrl_d');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="CTRL-D" />
                      </button>
                      <button
                        type="button"
                        disabled={!shellControlState?.shellInputEnabled}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('esc');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="ESC" />
                      </button>
                      <button
                        type="button"
                        disabled={!shellControlState?.shellInputEnabled}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('tab');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="TAB" />
                      </button>
                      <button
                        type="button"
                        disabled={!shellControlState?.shellInputEnabled}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('up');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="UP" />
                      </button>
                      <button
                        type="button"
                        disabled={!shellControlState?.shellInputEnabled}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('down');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="DOWN" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {error && (
          <div className="mt-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
