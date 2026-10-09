// Adapted from CC Switch ProviderCard.tsx / ProviderCardActions.tsx.
// Copyright (c) 2025 Jason Young. MIT; see THIRD_PARTY_NOTICES.md.
import {
  Check,
  Copy,
  FlaskConical,
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import { translate } from '@remote-codex/thread-ui/i18n';

type Props = {
  name: string;
  baseUrl: string;
  model: string;
  active: boolean;
  disabled: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onTest: () => void;
  onDelete: () => void;
};
const iconButton =
  'inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[var(--theme-border)] hover:bg-[var(--theme-hover)] disabled:opacity-40';

export function UpstreamProviderCard(p: Props) {
  return (
    <article
      className={`relative rounded-xl border bg-[var(--theme-panel)] p-3 transition ${p.active ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)]' : 'border-[var(--theme-border)] hover:border-[var(--theme-accent-border)]'}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] text-sm font-semibold"
        >
          {p.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 basis-32">
          <h4 className="truncate text-sm font-semibold" title={p.name}>
            {p.name}
          </h4>
          <p
            className="mt-1 truncate text-xs text-[var(--theme-fg-muted)]"
            title={p.baseUrl}
          >
            {p.baseUrl}
          </p>
          <p className="mt-1 break-all text-xs text-[var(--theme-fg-muted)]">
            {p.model}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {p.active && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--theme-accent-strong)]">
              <Check size={13} />
              {translate('settings.active')}
            </span>
          )}
          <button
            className={iconButton}
            disabled={p.disabled || p.active}
            aria-label={translate('settings.useUpstream')}
            title={translate('settings.useUpstream')}
            onClick={p.onActivate}
          >
            <Play size={15} />
          </button>
          <button
            className={iconButton}
            disabled={p.disabled || p.active}
            aria-label={translate('settings.edit')}
            title={translate('settings.edit')}
            onClick={p.onEdit}
          >
            <Pencil size={15} />
          </button>
          <details className="relative">
            <summary
              className={`${iconButton} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
              aria-label={translate('settings.upstreamsMoreActions', {
                name: p.name,
              })}
              title={translate('settings.upstreamsMoreActions', {
                name: p.name,
              })}
            >
              <MoreHorizontal size={16} />
            </summary>
            <div className="absolute right-0 top-12 z-10 min-w-48 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-1 shadow-lg">
              {[
                {
                  icon: Copy,
                  text: translate('settings.duplicate', { value1: p.name }),
                  action: p.onDuplicate,
                },
                {
                  icon: FlaskConical,
                  text: translate('settings.testConnection'),
                  action: p.onTest,
                },
                {
                  icon: Trash2,
                  text: translate('settings.delete', { value1: p.name }),
                  action: p.onDelete,
                },
              ].map(({ icon: Icon, text, action }) => (
                <button
                  key={text}
                  disabled={p.disabled}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs hover:bg-[var(--theme-hover)] disabled:opacity-40"
                  onClick={(event) => {
                    event.currentTarget
                      .closest('details')
                      ?.removeAttribute('open');
                    action();
                  }}
                >
                  <Icon size={14} />
                  {text}
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}
