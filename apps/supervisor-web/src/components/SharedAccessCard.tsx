import { useId, useState } from 'react';
import {
  ArrowUpRight,
  History,
  SlidersHorizontal,
  UserRound,
  UserRoundMinus,
} from 'lucide-react';
import { FormDialog } from './FormDialog';

type AccessEvent = {
  id: string;
  username: string;
  kind: string;
  accessedAt: string;
};
export function SharedAccessCard({
  title,
  subtitle,
  username,
  mode,
  permissions,
  events,
  lastAccessedAt,
  expanded,
  busy,
  onOpen,
  onEdit,
  onRevoke,
  onToggleAccess,
}: {
  title: string;
  subtitle: string;
  username: string;
  mode: 'incoming' | 'outgoing';
  permissions: string[];
  events: AccessEvent[];
  lastAccessedAt: string | null;
  expanded: boolean;
  busy: boolean;
  onOpen?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onRevoke?: (() => void) | undefined;
  onToggleAccess?: (() => void) | undefined;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const historyId = useId();
  const date = (value: string) =>
    new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  return (
    <article className="shared-access-card">
      <div className="shared-access-card-heading">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold" title={title}>
            {title}
          </h3>
          <p
            className="mt-1 truncate text-xs text-[var(--theme-fg-muted)]"
            title={subtitle}
          >
            {subtitle}
          </p>
        </div>
        <button type="button" className="shared-access-open" onClick={onOpen}>
          Open <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="shared-access-card-person">
        <button
          type="button"
          className="shared-profile-button"
          aria-label={`View ${username}'s profile`}
          onClick={() => setProfileOpen(true)}
        >
          <span className="shared-profile-avatar" aria-hidden="true">
            {Array.from(username).slice(0, 2).join('').toUpperCase()}
          </span>
          <span className="min-w-0 text-left">
            <span className="block text-[10px] text-[var(--theme-fg-muted)]">
              {mode === 'incoming' ? 'Shared by' : 'Shared with'}
            </span>
            <span className="block truncate text-xs font-medium">
              {username}
            </span>
          </span>
        </button>
        {mode === 'outgoing' && (
          <div className="shared-access-actions">
            <button
              type="button"
              className="product-icon-button"
              aria-label="Permissions"
              title="Edit permissions"
              disabled={busy}
              onClick={onEdit}
            >
              <SlidersHorizontal size={16} />
            </button>
            <button
              type="button"
              className="product-icon-button"
              aria-label="Access history"
              title="Recent access"
              aria-expanded={expanded}
              aria-controls={historyId}
              onClick={onToggleAccess}
            >
              <History size={16} />
            </button>
            <button
              type="button"
              className="product-icon-button shared-access-revoke"
              aria-label="Revoke"
              title="Revoke access"
              disabled={busy}
              onClick={onRevoke}
            >
              <UserRoundMinus size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="shared-access-card-footer">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {permissions.map((permission) => (
            <span className="shared-access-permission" key={permission}>
              {permission}
            </span>
          ))}
        </div>
        {mode === 'outgoing' && (
          <span className="shared-access-date">
            {lastAccessedAt
              ? `Visited ${date(lastAccessedAt)}`
              : 'No visits yet'}
          </span>
        )}
      </div>
      {mode === 'outgoing' && expanded && (
        <section
          id={historyId}
          className="shared-access-history"
          aria-label="Recent access"
        >
          <h4 className="mb-2 text-xs font-medium">Recent access</h4>
          {events.length ? (
            <ol>
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 py-2 text-xs"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{event.username}</span>
                    <span className="text-[var(--theme-fg-muted)]">
                      {event.kind.replaceAll('_', ' ')}
                    </span>
                  </span>
                  <time
                    className="shrink-0 text-[var(--theme-fg-muted)]"
                    dateTime={event.accessedAt}
                  >
                    {date(event.accessedAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-[var(--theme-fg-muted)]">
              No visits recorded yet.
            </p>
          )}
        </section>
      )}
      {profileOpen && (
        <FormDialog
          title={username}
          description={
            mode === 'incoming'
              ? 'This person shared access with you.'
              : 'You shared access with this person.'
          }
          onClose={() => setProfileOpen(false)}
        >
          <div className="flex items-center gap-3 py-3">
            <span className="shared-profile-avatar !h-14 !w-14">
              <UserRound size={24} />
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{username}</p>
              <p className="text-xs text-[var(--theme-fg-muted)]">
                Remote Codex account
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--theme-border)] p-4">
            <p className="break-words text-sm font-medium">{title}</p>
            <p className="mt-1 break-words text-xs text-[var(--theme-fg-muted)]">
              {subtitle}
            </p>
            <p className="mt-3 text-xs">{permissions.join(' · ')}</p>
          </div>
          {mode === 'outgoing' && (
            <button
              type="button"
              className="relay-button-secondary mt-4"
              onClick={() => {
                setProfileOpen(false);
                onEdit?.();
              }}
            >
              Edit permissions
            </button>
          )}
        </FormDialog>
      )}
    </article>
  );
}
