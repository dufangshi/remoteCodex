import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { enableRelayMode } from '../lib/api';

const setupCommand = [
  'REMOTE_CODEX_RELAY_SERVER_URL=wss://remote-codex.example.com \\',
  'REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_... \\',
  'REMOTE_CODEX_RELAY_SUPERVISOR_PORT=45679 \\',
  'remote-codex relay-supervisor',
].join('\n');

const connectionModes = [
  {
    title: 'Local mode',
    detail: 'For the same machine, an emulator, LAN, or Tailscale network. No relay account is needed.',
  },
  {
    title: 'Server mode',
    detail: 'For a directly exposed supervisor protected by its own server login on a trusted private server.',
  },
  {
    title: 'Relay mode',
    detail: 'For a machine that should accept no inbound connection. The supervisor opens an outbound tunnel.',
  },
];

const relaySteps = [
  {
    title: 'Register or sign in',
    detail: 'Open the relay portal, then create or enter your relay account.',
  },
  {
    title: 'Create a device',
    detail: 'In Devices, choose a recognizable name and create a one-time token for the private supervisor.',
  },
  {
    title: 'Copy the setup command',
    detail: 'Use Copy setup. The generated command includes the relay URL, device token, and supervisor port.',
  },
  {
    title: 'Start the supervisor',
    detail: 'Run the command on the workspace host. When tmux is available, Remote Codex keeps it detached by default.',
  },
  {
    title: 'Connect and work',
    detail: 'Return to Devices, wait for Online, then connect. Workspaces and threads use the selected device.',
  },
  {
    title: 'Share when needed',
    detail: 'From a thread, open sharing, enter a relay username, and choose thread and workspace permissions.',
  },
];

export function RelayGuidePage() {
  useEffect(() => {
    enableRelayMode();
  }, []);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--app-bg)] px-4 py-5 text-[var(--app-fg)] sm:px-6 sm:py-6">
      <article className="mx-auto w-full min-w-0 max-w-3xl">
        <header className="border-b border-[var(--theme-border)] pb-6">
          <Link className="relay-button-secondary mb-6 inline-flex h-11 items-center gap-2" to="/">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Relay home
          </Link>
          <p className="text-sm font-medium text-[var(--theme-accent-strong)]">Setup guide</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-[var(--theme-fg)] sm:text-3xl">
            Connect a private supervisor
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--theme-fg-soft)]">
            Pick the mode that matches your network, then follow the relay steps when the private machine should only
            connect outward.
          </p>
        </header>

        <section className="py-8" aria-labelledby="connection-modes-heading">
          <h2 id="connection-modes-heading" className="text-lg font-semibold text-[var(--theme-fg)]">
            Connection modes
          </h2>
          <dl className="mt-4 divide-y divide-[var(--theme-border)] border-y border-[var(--theme-border)]">
            {connectionModes.map((mode) => (
              <div className="grid gap-1 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-5" key={mode.title}>
                <dt className="text-sm font-medium text-[var(--theme-fg)]">{mode.title}</dt>
                <dd className="text-sm leading-6 text-[var(--theme-fg-muted)]">{mode.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-[var(--theme-border)] py-8" aria-labelledby="relay-steps-heading">
          <h2 id="relay-steps-heading" className="text-lg font-semibold text-[var(--theme-fg)]">
            Relay setup
          </h2>
          <ol className="mt-4 divide-y divide-[var(--theme-border)] border-y border-[var(--theme-border)]">
            {relaySteps.map((step, index) => (
              <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 py-4" key={step.title}>
                <span
                  aria-hidden="true"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--theme-muted)] font-mono text-xs font-semibold text-[var(--theme-fg-soft)]"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--theme-fg)]">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--theme-fg-muted)]">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="min-w-0 border-t border-[var(--theme-border)] py-8" aria-labelledby="example-command-heading">
          <h2 id="example-command-heading" className="text-lg font-semibold text-[var(--theme-fg)]">
            Example supervisor command
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--theme-fg-muted)]">
            Devices generates the real command. Treat its token as a secret.
          </p>
          <pre className="mt-4 block w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] p-3 text-xs leading-5 text-[var(--theme-fg)]">
            <code className="block min-w-max">{setupCommand}</code>
          </pre>
        </section>

        <section className="border-t border-[var(--theme-border)] py-8" aria-labelledby="after-setup-heading">
          <h2 id="after-setup-heading" className="text-lg font-semibold text-[var(--theme-fg)]">
            After setup
          </h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-[var(--theme-fg-muted)]">
            <GuideOutcome>Use Devices to switch between supervisor machines.</GuideOutcome>
            <GuideOutcome>Use Shared with me to open sessions other users shared.</GuideOutcome>
            <GuideOutcome>Use Shared by me to review access, change permissions, or revoke a share.</GuideOutcome>
          </ul>
        </section>
      </article>
    </main>
  );
}

function GuideOutcome({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <CheckCircle2
        aria-hidden="true"
        className="mt-1 h-4 w-4 shrink-0 text-[var(--status-success-fg)]"
      />
      <span>{children}</span>
    </li>
  );
}
