import { useAppShellNav } from './AppShellNavContext';

export function ComposerShortcutSettings() {
  const nav = useAppShellNav();
  const disabled =
    !nav?.setSendShortcut || nav.sendShortcutLoading || nav.sendShortcutSaving;
  return (
    <fieldset className="py-5">
      <legend className="text-sm font-semibold">Message shortcuts</legend>
      <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
        Saved to your account and applied across devices and browsers. On Mac,
        Command also works in place of Ctrl.
      </p>
      <div className="mt-3 space-y-2">
        {(
          [
            {
              value: 'ctrlEnter',
              label: 'Ctrl+Enter to send',
              description:
                'Enter inserts a new line. Ctrl+Shift+Enter sends directly as steer.',
            },
            {
              value: 'enter',
              label: 'Enter to send',
              description:
                'Shift+Enter inserts a new line. Ctrl+Enter sends directly as steer.',
            },
          ] as const
        ).map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 items-start gap-3 rounded-md border border-[var(--theme-border)] p-3"
          >
            <input
              type="radio"
              name="settings-send-shortcut"
              value={option.value}
              checked={(nav?.sendShortcut ?? 'ctrlEnter') === option.value}
              disabled={disabled}
              onChange={() => {
                void nav?.setSendShortcut?.(option.value);
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--theme-accent-solid)]"
            />
            <span>
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-1 block text-xs text-[var(--theme-fg-muted)]">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">
        {nav?.sendShortcutSaving
          ? 'Saving...'
          : nav?.sendShortcutLoading
            ? 'Loading...'
            : !nav?.setSendShortcut
              ? 'Sign in through Relay to change your account shortcuts.'
              : 'Steer delivers to the running turn immediately. When idle, it starts a new turn.'}
      </p>
      {nav?.sendShortcutError ? (
        <div className="mt-2 text-xs">
          <p className="host-error" role="alert">
            {nav.sendShortcutError}
          </p>
          <button
            type="button"
            className="mt-2 underline"
            onClick={() => {
              void nav.refreshSendShortcut?.();
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
