import { translate, useI18n } from '@remote-codex/thread-ui/i18n';
import { RelayNotifications } from '../components/RelayNotifications';
import {
  RelaySecurityPanel,
  SecurityVerification,
} from '../components/RelaySecurity';
import { securityRequest, type SecurityStatus } from '../lib/relaySecurity';
import { FormDialog } from '../components/FormDialog';
import { ArrowLeft, RefreshCw, Save, KeyRound } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { RelaySessionDto } from '@remote-codex/shared';
import {
  ApiError,
  enableRelayMode,
  fetchRelaySession,
  updateRelayAccount,
  updateRelayPassword,
} from '../lib/api';

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : fallback;
}

export function RelayAccountSettingsPanel({
  className = '',
}: {
  className?: string;
}) {
  const { locale: i18nLocale } = useI18n();
  const [session, setSession] = useState<RelaySessionDto | null>(null);
  const [username, setUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [verification, setVerification] = useState<SecurityStatus | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      enableRelayMode();
      const nextSession = await fetchRelaySession();
      setSession(nextSession);
      setUsername(nextSession.user?.username ?? '');
    } catch (caught) {
      setSession(null);
      setLoadError(errorMessage(caught, translate("auth.accountLoadFailed")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const user = await updateRelayAccount({ username: username.trim() });
      setSession((current) =>
        current?.authenticated ? { ...current, user } : current,
      );
      setUsername(user.username);
      setProfileMessage(translate("auth.profileSaved"));
    } catch (caught) {
      setProfileError(errorMessage(caught, translate("auth.profileSaveFailed")));
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(
    event?: FormEvent<HTMLFormElement>,
    verificationToken?: string,
  ) {
    event?.preventDefault();
    setSavingPassword(true);
    setPasswordError(null);
    setPasswordMessage(null);
    try {
      if (newPassword !== confirmPassword) {
        setPasswordError(translate("auth.newPasswordsDoNotMatch"));
        return;
      }
      await updateRelayPassword({
        currentPassword,
        newPassword,
        ...(verificationToken ? { verificationToken } : {}),
      });
      setPasswordOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage(translate("auth.passwordChanged"));
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.payload.code === 'reauthentication_required'
      ) {
        setVerification(await securityRequest<SecurityStatus>(''));
      } else
        setPasswordError(
          errorMessage(caught, translate("auth.unableToChangeYourPassword")),
        );
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <div
        aria-live="polite"
        className={`space-y-4 ${className}`.trim()}
        role="status"
      >
        <span className="sr-only">{translate("auth.loadingAccount")}</span>
        <div
          className="h-4 w-28 animate-pulse rounded bg-[var(--theme-muted)]"
          aria-hidden="true"
        />
        <div
          className="h-11 w-full max-w-md animate-pulse rounded-lg bg-[var(--theme-muted)]"
          aria-hidden="true"
        />
        <div
          className="h-11 w-full max-w-md animate-pulse rounded-lg bg-[var(--theme-muted)]"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (loadError) {
    return (
      <Notice className={className} tone="danger">
        <p className="font-medium">{translate("auth.accountDetailsCouldNotBeLoaded")}</p>
        <p className="mt-1 text-sm">{loadError}</p>
        <button
          className="relay-button-secondary mt-3 inline-flex h-11 items-center gap-2"
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          {translate("auth.retry")}</button>
      </Notice>
    );
  }

  if (!session?.authenticated) {
    return (
      <div className={className}>
        <h2 className="text-base font-semibold text-[var(--theme-fg)]">
          {translate("auth.signInRequired")}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--theme-fg-muted)]">
          {translate("auth.yourRelaySessionHasEndedSignIn")}</p>
        <Link
          className="relay-button-primary mt-4 inline-flex h-11"
          to="/relay-portal?returnTo=%2Frelay-account"
        >
          {translate("auth.signIn")}</Link>
      </div>
    );
  }

  const profileDirty = username.trim() !== (session.user?.username ?? '');

  return (
    <div
      className={`divide-y divide-[var(--theme-border)] border-y border-[var(--theme-border)] ${className}`.trim()}
    >
      <section className="grid gap-5 py-6 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8">
        <header>
          <h2 className="text-base font-semibold text-[var(--theme-fg)]">
            {translate("auth.profile")}</h2>
          <p className="mt-1 text-sm leading-5 text-[var(--theme-fg-muted)]">
            {translate("auth.yourRelayIdentity")}</p>
        </header>
        <div className="min-w-0 max-w-md">
          <div>
            <p className="text-sm text-[var(--theme-fg-soft)]">{translate("auth.email")}</p>
            <p className="mt-1 break-words text-sm font-medium text-[var(--theme-fg)]">
              {session.user?.email}
            </p>
          </div>
          <form className="mt-5 space-y-4" onSubmit={saveProfile}>
            <label className="block text-sm text-[var(--theme-fg-soft)]">
              {translate("auth.username")}<input
                autoComplete="username"
                className="relay-input mt-2 min-h-11 w-full disabled:cursor-wait disabled:opacity-60"
                disabled={savingProfile}
                name="username"
                onChange={(event) => {
                  setUsername(event.target.value);
                  setProfileError(null);
                  setProfileMessage(null);
                }}
                required
                value={username}
              />
            </label>
            {profileError ? (
              <Notice tone="danger">{profileError}</Notice>
            ) : null}
            {profileMessage ? (
              <Notice tone="success">{profileMessage}</Notice>
            ) : null}
            <button
              className="relay-button-primary inline-flex h-11 items-center gap-2"
              disabled={savingProfile || !username.trim() || !profileDirty}
              type="submit"
            >
              <Save aria-hidden="true" className="h-4 w-4" />
              {savingProfile ? translate("auth.saving") : translate("auth.saveProfile")}
            </button>
          </form>
        </div>
      </section>

      <section className="flex items-center justify-between gap-3 py-4">
        <h2 className="text-sm font-semibold">{translate("auth.password")}</h2>
        <button
          type="button"
          aria-label={translate("auth.changePassword")}
          title={translate("auth.changePassword")}
          className="host-icon-button inline-flex h-10 w-10 items-center justify-center rounded-md"
          onClick={() => {
            setPasswordError(null);
            setPasswordMessage(null);
            setPasswordOpen(true);
          }}
        >
          <KeyRound size={18} />
        </button>
      </section>
      {passwordMessage && <Notice tone="success">{passwordMessage}</Notice>}
      {passwordOpen && (
        <FormDialog
          title={translate("auth.changePassword")}
          busy={savingPassword || Boolean(verification)}
          onClose={() => {
            setPasswordOpen(false);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
          }}
        >
          <header>
            <p className="mt-1 text-sm leading-5 text-[var(--theme-fg-muted)]">
              {translate("auth.useAtLeast8Characters")}</p>
          </header>
          <form className="min-w-0 max-w-md space-y-4" onSubmit={savePassword}>
            <PasswordInput
              autoComplete="current-password"
              disabled={savingPassword}
              label={translate("auth.currentPassword")}
              name="currentPassword"
              onChange={(value) => {
                setCurrentPassword(value);
                setPasswordError(null);
                setPasswordMessage(null);
              }}
              value={currentPassword}
            />
            <PasswordInput
              autoComplete="new-password"
              disabled={savingPassword}
              label={translate("auth.newPassword")}
              minLength={8}
              name="newPassword"
              onChange={(value) => {
                setNewPassword(value);
                setPasswordError(null);
                setPasswordMessage(null);
              }}
              value={newPassword}
            />
            <PasswordInput
              autoComplete="new-password"
              disabled={savingPassword}
              label={translate("auth.confirmNewPassword")}
              minLength={8}
              name="confirmPassword"
              onChange={(value) => {
                setConfirmPassword(value);
                setPasswordError(null);
                setPasswordMessage(null);
              }}
              value={confirmPassword}
            />
            {passwordError ? (
              <Notice tone="danger">{passwordError}</Notice>
            ) : null}
            {passwordMessage ? (
              <Notice tone="success">{passwordMessage}</Notice>
            ) : null}
            <button
              className="relay-button-primary inline-flex h-11 items-center gap-2"
              disabled={
                savingPassword ||
                !currentPassword ||
                newPassword.length < 8 ||
                !confirmPassword
              }
              type="submit"
            >
              <Save aria-hidden="true" className="h-4 w-4" />
              {savingPassword ? translate("auth.changing") : translate("auth.changePassword")}
            </button>
          </form>
        </FormDialog>
      )}
      <RelayNotifications />
      <RelaySecurityPanel />
      {verification && (
        <SecurityVerification
          status={verification}
          onCancel={() => setVerification(null)}
          onVerified={async (token) => {
            setVerification(null);
            await savePassword(undefined, token);
          }}
        />
      )}
    </div>
  );
}

export function RelayAccountPage() {
  const { locale: i18nLocale } = useI18n();
  return (
    <div className="product-page !max-w-3xl">
      <header className="border-b border-[var(--theme-border)] pb-6">
        <Link
          className="relay-button-secondary inline-flex h-11 items-center gap-2"
          to="/relay-devices"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {translate("auth.devices")}</Link>
        <p className="mt-6 text-sm font-medium text-[var(--theme-accent-strong)]">
          {translate("auth.relayAccount")}</p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
          {translate("auth.accountSettings")}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--theme-fg-muted)]">
          {translate("auth.manageTheIdentityAndPasswordUsedTo")}</p>
      </header>
      <div className="py-2">
        <RelayAccountSettingsPanel />
      </div>
    </div>
  );
}

function PasswordInput({
  autoComplete,
  disabled = false,
  label,
  minLength,
  name,
  value,
  onChange,
}: {
  autoComplete: string;
  disabled?: boolean;
  label: string;
  minLength?: number;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { locale: i18nLocale } = useI18n();
  return (
    <label className="block text-sm text-[var(--theme-fg-soft)]">
      {label}
      <input
        autoComplete={autoComplete}
        className="relay-input mt-2 min-h-11 w-full disabled:cursor-wait disabled:opacity-60"
        disabled={disabled}
        minLength={minLength}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        required
        type="password"
        value={value}
      />
    </label>
  );
}

function Notice({
  tone,
  children,
  className = '',
}: {
  tone: 'danger' | 'success';
  children: React.ReactNode;
  className?: string;
}) {
  const { locale: i18nLocale } = useI18n();
  return (
    <div
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      className={`rounded-lg px-3 py-2 text-sm ${
        tone === 'danger'
          ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
          : 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
      } ${className}`.trim()}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
