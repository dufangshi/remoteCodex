import { useDialogLifecycle } from './useDialogLifecycle';
import { request } from '../lib/api';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  Copy,
  Download,
  Fingerprint,
  KeyRound,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  authenticatePasskey,
  fetchChallenge,
  registerPasskey,
  securityError,
  securityRequest,
  verifyLoginCode,
  type Enrollment,
  type LoginChallenge,
  type SecurityStatus,
  type SecurityRealm,
} from '../lib/relaySecurity';

const input = 'relay-input min-h-11 w-full';
const secondary =
  'relay-button-secondary inline-flex min-h-10 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50';
function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-[var(--status-danger-fg)]">
      {error}
    </p>
  ) : null;
}

export function LoginVerification({
  challenge,
  onSuccess,
  onBack,
}: {
  challenge: LoginChallenge;
  onSuccess: () => Promise<void>;
  onBack: () => void;
}) {
  const [code, setCode] = useState(''),
    [remember, setRemember] = useState(true),
    [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function verify(passkey = false) {
    setBusy(true);
    setError(null);
    try {
      if (passkey) await authenticatePasskey('login', remember);
      else await verifyLoginCode(code, remember && !recovery);
      await onSuccess();
    } catch (e) {
      setError(securityError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="w-full max-w-md space-y-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-6 shadow-[var(--theme-shadow)]">
      <ShieldCheck
        className="h-8 w-8 text-[var(--theme-accent-strong)]"
        aria-hidden="true"
      />
      <div>
        <h1 className="text-xl font-semibold">Verify it’s you</h1>
        <p className="mt-2 text-sm text-[var(--theme-fg-muted)]">
          One more step for this browser.
        </p>
      </div>
      {challenge.passkey && (
        <button
          className={`${secondary} w-full`}
          disabled={busy}
          onClick={() => void verify(true)}
        >
          <Fingerprint size={18} /> Use a passkey
        </button>
      )}
      {(challenge.authenticator || recovery) && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <label className="block text-sm">
            {recovery ? 'Recovery code' : 'Authenticator code'}
            <input
              autoFocus
              autoComplete="one-time-code"
              inputMode={recovery ? 'text' : 'numeric'}
              className={`${input} mt-2 font-mono tracking-widest`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={recovery ? 24 : 6}
              disabled={busy}
              required
            />
          </label>
          {!recovery && (
            <label className="flex items-center gap-2 text-sm text-[var(--theme-fg-muted)]">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />{' '}
              Trust this browser for 30 days
            </label>
          )}
          <button
            className="relay-button-primary min-h-11 w-full"
            disabled={busy || !code.trim()}
          >
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      )}
      {!challenge.authenticator && !recovery && (
        <label className="flex items-center gap-2 text-sm text-[var(--theme-fg-muted)]">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />{' '}
          Trust this browser for 30 days
        </label>
      )}
      <ErrorText error={error} />
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <button
          type="button"
          className="text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg)]"
          onClick={() => {
            setRecovery(!recovery);
            setCode('');
            setError(null);
          }}
        >
          {recovery ? 'Use another method' : 'Use a recovery code'}
        </button>
        <button
          type="button"
          className="text-[var(--theme-fg-muted)]"
          disabled={busy}
          onClick={() =>
            void request(
              '/relay/auth/challenge',
              { method: 'DELETE' },
              { auth: 'none' },
            )
              .then(onBack)
              .catch((e) => setError(securityError(e)))
          }
        >
          Back to sign in
        </button>
      </div>
    </section>
  );
}

export function usePendingLogin() {
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  useEffect(() => {
    let active = true;
    void fetchChallenge()
      .then((value) => {
        if (active && value.challengeRequired === true) setChallenge(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return [challenge, setChallenge] as const;
}

export function SecurityVerification({
  status,
  onVerified,
  onCancel,
  realm = 'default',
}: {
  realm?: SecurityRealm;
  status: Pick<SecurityStatus, 'authenticatorEnabled' | 'passkeys'>;
  onVerified: () => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogLifecycle({
    busy,
    containerRef: dialogRef,
    onClose: onCancel,
    open: true,
  });
  const factor = status.authenticatorEnabled || status.passkeys.length > 0;
  async function verify(passkey = false) {
    setBusy(true);
    setError(null);
    try {
      if (passkey) await authenticatePasskey('reauth', false, realm);
      else
        await securityRequest(
          '/reauth',
          'POST',
          factor ? { code: value } : { password: value },
          realm,
        );
      await onVerified();
    } catch (e) {
      setError(securityError(e));
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/55 p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Verify your identity"
        className="w-full max-w-sm space-y-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Verify your identity</h2>
        <p className="text-sm text-[var(--theme-fg-muted)]">
          Confirm this security change. Verification lasts 10 minutes.
        </p>
        {status.passkeys.length > 0 && (
          <button
            className={`${secondary} w-full`}
            disabled={busy}
            onClick={() => void verify(true)}
          >
            <Fingerprint size={16} /> Use a passkey
          </button>
        )}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <label className="block text-sm">
            {factor ? 'Authenticator or recovery code' : 'Password'}
            <input
              autoFocus
              className={`${input} mt-2`}
              type={factor ? 'text' : 'password'}
              autoComplete={factor ? 'one-time-code' : 'current-password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
              required
            />
          </label>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={secondary}
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="relay-button-primary min-h-10 px-4"
              disabled={busy || !value}
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}

function RecoveryCodes({
  codes,
  onClose,
}: {
  codes: string[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState<string | null>(null);
  const text = `Remote Codex recovery codes\nKeep these somewhere private. Each code works once.\n\n${codes.join('\n')}\n`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setSaved(true);
    } catch {
      setError('Copy was unavailable. Download the codes instead.');
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'remote-codex-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  }
  return (
    <div
      className="space-y-4 rounded-lg border border-[var(--theme-accent-strong)] p-4"
      role="region"
      aria-label="Save recovery codes"
    >
      <h3 className="font-medium">Save your recovery codes</h3>
      <p className="text-sm text-[var(--theme-fg-muted)]">
        Use these if you lose your authenticator or passkey. Each code works
        once. These codes won’t be shown again.
      </p>
      <div className="grid gap-2 rounded-md bg-[var(--theme-bg)] p-3 font-mono text-sm sm:grid-cols-2">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <ErrorText error={error} />
      <div className="flex flex-wrap gap-2">
        <button className={secondary} onClick={() => void copy()}>
          {copied ? <Check size={15} /> : <Copy size={15} />} Copy
        </button>
        <button className={secondary} onClick={download}>
          <Download size={15} /> Download
        </button>
        <button
          className="relay-button-primary px-4"
          disabled={!saved}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}

export function RelaySecurityPanel({
  realm = 'default',
}: {
  realm?: SecurityRealm;
}) {
  const call = <T,>(path: string, method = 'GET', body?: unknown) =>
    securityRequest<T>(path, method, body, realm);
  const [status, setStatus] = useState<SecurityStatus | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null),
    [code, setCode] = useState(''),
    [codes, setCodes] = useState<string[] | null>(null);
  const [keyName, setKeyName] = useState(''),
    [addingKey, setAddingKey] = useState(false),
    [editing, setEditing] = useState<string | null>(null);
  const [verifyAction, setVerifyAction] = useState<
    (() => Promise<void>) | null
  >(null);
  async function load() {
    const value = await call<SecurityStatus>('');
    setStatus(value);
  }
  useEffect(() => {
    void load().catch((e) => setError(securityError(e)));
  }, []);
  async function run(action: () => Promise<void>, verified = false) {
    if (!verified && status && !status.recentlyVerified) {
      setVerifyAction(() => action);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      if (
        e instanceof Error &&
        'payload' in e &&
        (e as { payload?: { code?: string } }).payload?.code ===
          'reauthentication_required'
      )
        setVerifyAction(() => action);
      else if (
        e instanceof Error &&
        'payload' in e &&
        (e as { payload?: { code?: string } }).payload?.code === 'unauthorized'
      )
        location.assign('/relay');
      else setError(securityError(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await call<{ recoveryCodes: string[] }>(
        '/authenticator/confirm',
        'POST',
        { code },
      );
      setEnrollment(null);
      setCode('');
      setCodes(result.recoveryCodes);
    });
  }
  const date = (value: number) => new Date(value).toLocaleDateString();
  return (
    <section className="grid gap-5 py-6 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8">
      <header>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck size={18} /> Security
        </h2>
        <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
          Protect your account and devices.
        </p>
      </header>
      <div className="min-w-0 space-y-5">
        <ErrorText error={error} />
        {!status && !error && (
          <p role="status" className="text-sm text-[var(--theme-fg-muted)]">
            Loading security settings…
          </p>
        )}
        {status && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 font-medium">
                  <Smartphone size={17} /> Authenticator app{' '}
                  {status.authenticatorEnabled && (
                    <Check
                      size={15}
                      className="text-[var(--status-success-fg)]"
                    />
                  )}
                </h3>
                <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
                  Google Authenticator and compatible apps.
                </p>
              </div>
              <button
                className={secondary}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (status.authenticatorEnabled)
                      await call('/authenticator', 'DELETE');
                    else
                      setEnrollment(
                        await call<Enrollment>('/authenticator/enroll', 'POST'),
                      );
                  })
                }
              >
                {status.authenticatorEnabled ? 'Disable' : 'Set up'}
              </button>
            </div>
            {enrollment && (
              <form
                onSubmit={(e) => void confirm(e)}
                className="space-y-4 rounded-lg border border-[var(--theme-border)] p-4"
              >
                <p className="text-sm">
                  Scan this code in your authenticator, then enter its six-digit
                  code.
                </p>
                <img
                  alt="Authenticator setup QR code"
                  className="h-44 w-44 rounded-md bg-white"
                  src={`data:image/svg+xml;base64,${btoa(enrollment.qrSvg)}`}
                />
                <details className="text-sm">
                  <summary className="cursor-pointer text-[var(--theme-fg-muted)]">
                    Can’t scan the code?
                  </summary>
                  <code className="mt-2 block break-all select-all rounded bg-[var(--theme-bg)] p-2">
                    {enrollment.secret}
                  </code>
                </details>
                <input
                  aria-label="Setup verification code"
                  className={`${input} max-w-xs font-mono tracking-widest`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={6}
                  required
                />
                <div className="flex gap-2">
                  <button
                    className="relay-button-primary min-h-10 px-4"
                    disabled={busy || code.length !== 6}
                  >
                    Enable authenticator
                  </button>
                  <button
                    className={secondary}
                    type="button"
                    onClick={() => {
                      setEnrollment(null);
                      setCode('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {codes && (
              <RecoveryCodes codes={codes} onClose={() => setCodes(null)} />
            )}
            <div className="border-t border-[var(--theme-border)] pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 font-medium">
                  <Fingerprint size={17} /> Passkeys
                </h3>
                {status.passkeyAvailable && (
                  <button
                    className={secondary}
                    disabled={busy}
                    onClick={() => {
                      setAddingKey(true);
                      setKeyName('');
                    }}
                  >
                    Add passkey
                  </button>
                )}
              </div>
              {!status.passkeyAvailable && (
                <p className="mt-2 text-sm text-[var(--theme-fg-muted)]">
                  Passkey setup is unavailable on this relay.
                </p>
              )}
              {addingKey && (
                <form
                  className="mt-3 flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const result = await registerPasskey(keyName, realm);
                      setAddingKey(false);
                      setKeyName('');
                      if (result.recoveryCodes) setCodes(result.recoveryCodes);
                    });
                  }}
                >
                  <input
                    aria-label="Passkey name"
                    placeholder="e.g. My phone"
                    className={`${input} min-w-0 flex-1`}
                    maxLength={80}
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    required
                  />
                  <button
                    className={secondary}
                    disabled={busy || !keyName.trim()}
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    className={secondary}
                    onClick={() => setAddingKey(false)}
                    aria-label="Cancel passkey setup"
                  >
                    <X size={15} />
                  </button>
                </form>
              )}
              <ul className="mt-2 divide-y divide-[var(--theme-border)]">
                {status.passkeys.map((key) => (
                  <li
                    key={key.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm">{key.name}</p>
                      <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                        Added {date(key.createdAt)}
                        {key.lastUsedAt
                          ? ` · Used ${date(key.lastUsedAt)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {editing === key.id ? (
                        <form
                          className="flex gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void run(async () => {
                              await call(
                                `/passkeys/${encodeURIComponent(key.id)}`,
                                'PATCH',
                                { name: keyName },
                              );
                              setEditing(null);
                            });
                          }}
                        >
                          <input
                            aria-label="Rename passkey"
                            className={input}
                            value={keyName}
                            maxLength={80}
                            onChange={(e) => setKeyName(e.target.value)}
                          />
                          <button className={secondary}>Save</button>
                        </form>
                      ) : (
                        <button
                          className={secondary}
                          onClick={() => {
                            setEditing(key.id);
                            setKeyName(key.name);
                          }}
                        >
                          Rename
                        </button>
                      )}
                      <button
                        className={secondary}
                        aria-label={`Remove ${key.name}`}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await call(
                              `/passkeys/${encodeURIComponent(key.id)}`,
                              'DELETE',
                            );
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            {(status.authenticatorEnabled || status.passkeys.length > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--theme-border)] pt-4">
                <div>
                  <h3 className="flex items-center gap-2 font-medium">
                    <KeyRound size={17} /> Recovery codes
                  </h3>
                  <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
                    {status.recoveryCodesRemaining} unused · New codes replace
                    the previous set.
                  </p>
                </div>
                <button
                  className={secondary}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await call<{ recoveryCodes: string[] }>(
                        '/recovery-codes',
                        'POST',
                      );
                      setCodes(result.recoveryCodes);
                    })
                  }
                >
                  Generate new codes
                </button>
              </div>
            )}
            <div className="border-t border-[var(--theme-border)] pt-4">
              <h3 className="font-medium">Trusted browsers</h3>
              <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
                No repeated codes on trusted browsers for 30 days.
              </p>
              {status.trustedBrowsers.length === 0 && (
                <p className="mt-2 text-sm text-[var(--theme-fg-muted)]">
                  No trusted browsers yet.
                </p>
              )}
              <ul className="divide-y divide-[var(--theme-border)]">
                {status.trustedBrowsers.map((browser) => (
                  <li
                    key={browser.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm">{browser.name}</p>
                      <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                        Expires {date(browser.expiresAt)}
                      </p>
                    </div>
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await call(`/browsers/${browser.id}`, 'DELETE');
                        })
                      }
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-[var(--theme-border)] pt-4">
              <h3 className="font-medium">Active sessions</h3>
              <ul className="divide-y divide-[var(--theme-border)]">
                {status.sessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm">
                        {session.name || 'Browser'}
                        {session.current && (
                          <span className="ml-2 text-xs text-[var(--theme-accent-strong)]">
                            This session
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                        Signed in {date(session.createdAt)}
                      </p>
                    </div>
                    {!session.current && (
                      <button
                        className={secondary}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await call(`/sessions/${session.id}`, 'DELETE');
                          })
                        }
                      >
                        Sign out
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        {verifyAction && status && (
          <SecurityVerification
            realm={realm}
            status={status}
            onCancel={() => setVerifyAction(null)}
            onVerified={async () => {
              const action = verifyAction;
              setVerifyAction(null);
              await run(action, true);
            }}
          />
        )}
      </div>
    </section>
  );
}
