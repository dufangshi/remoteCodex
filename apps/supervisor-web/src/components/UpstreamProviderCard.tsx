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
  ArrowUp,
  ArrowDown,
  Gauge,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { translate } from '@pockymoe/thread-ui/i18n';
type Props = {
  name: string;
  baseUrl: string;
  model: string;
  active: boolean;
  disabled: boolean;
  canActivate: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onTest: () => void;
  onSpeed: () => void;
  onDelete: () => void;
  onMove: (direction: 'up' | 'down') => void;
};
const iconButton =
  'inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[var(--theme-border)] hover:bg-[var(--theme-hover)] disabled:opacity-40';
export function UpstreamProviderCard(p: Props) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
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
          <button
            className={`${iconButton} gap-1.5 px-3 text-xs ${p.active ? 'text-[var(--theme-accent-strong)]' : ''}`}
            style={p.active ? { opacity: 1 } : undefined}
            disabled={p.disabled || p.active || !p.canActivate}
            onClick={p.onActivate}
          >
            {p.active ? <Check size={14} /> : <Play size={14} />}{' '}
            {translate(
              p.active ? 'settings.upstreamsUsing' : 'settings.upstreamsEnable',
            )}
          </button>
          <button
            className={iconButton}
            disabled={p.disabled}
            aria-label={translate('settings.edit')}
            onClick={p.onEdit}
          >
            <Pencil size={15} />
          </button>
          <div className="relative" ref={menu}>
            <button
              className={iconButton}
              aria-label={translate('settings.upstreamsMoreActions', {
                name: p.name,
              })}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <MoreHorizontal size={16} />
            </button>
            {open && (
              <div
                className="absolute right-0 top-12 z-10 min-w-48 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-1 shadow-lg"
                role="group"
                aria-label={translate('settings.upstreamsMoreActions', {
                  name: p.name,
                })}
              >
                {[
                  {
                    icon: Copy,
                    text: translate('settings.duplicate', { value1: p.name }),
                    action: p.onDuplicate,
                    disabled: false,
                  },
                  {
                    icon: ArrowUp,
                    text: translate('settings.upstreamsMoveUp'),
                    action: () => p.onMove('up'),
                    disabled: !p.canMoveUp,
                  },
                  {
                    icon: ArrowDown,
                    text: translate('settings.upstreamsMoveDown'),
                    action: () => p.onMove('down'),
                    disabled: !p.canMoveDown,
                  },
                  {
                    icon: Gauge,
                    text: translate('settings.upstreamsSpeedTest'),
                    action: p.onSpeed,
                    disabled: false,
                  },
                  {
                    icon: FlaskConical,
                    text: translate('settings.testConnection'),
                    action: p.onTest,
                    disabled: false,
                  },
                  {
                    icon: Trash2,
                    text: translate('settings.delete', { value1: p.name }),
                    action: p.onDelete,
                    disabled: false,
                  },
                ].map(({ icon: Icon, text, action, disabled }) => (
                  <button
                    key={text}
                    disabled={p.disabled || disabled}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs hover:bg-[var(--theme-hover)] disabled:opacity-40"
                    onClick={() => {
                      setOpen(false);
                      action();
                    }}
                  >
                    <Icon size={14} />
                    {text}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
