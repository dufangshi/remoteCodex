import type { FormEvent } from 'react';

import type {
  ControlPlaneAuth,
  ControlPlaneHarnessUsageEvent,
  ControlPlaneHarnessUsageSummary,
  ControlPlaneUsageEvent,
  ControlPlaneUsageSummary,
  ControlPlaneUser,
} from '../../lib/api';
import { ActionButton, CopyField, Field, statusLabel } from '../controlPlanePresentation';

export function ControlPlaneAccountMenu({
  accountInitial,
  open,
  user,
  auth,
  busy,
  profileName,
  usage,
  usageEvents,
  harnessUsage,
  harnessUsageEvents,
  totalTokens,
  totalCostUsd,
  controlPlaneBaseUrl,
  usageEventsLoading,
  onToggle,
  onProfileNameChange,
  onProfileSave,
  onLogout,
}: {
  accountInitial: string;
  open: boolean;
  user: ControlPlaneUser | null;
  auth: ControlPlaneAuth | null;
  busy: string | null;
  profileName: string;
  usage: ControlPlaneUsageSummary | null;
  usageEvents: ControlPlaneUsageEvent[];
  harnessUsage: ControlPlaneHarnessUsageSummary | null;
  harnessUsageEvents: ControlPlaneHarnessUsageEvent[];
  totalTokens: number;
  totalCostUsd: number;
  controlPlaneBaseUrl: string;
  usageEventsLoading: boolean;
  onToggle: () => void;
  onProfileNameChange: (value: string) => void;
  onProfileSave: (event: FormEvent) => void;
  onLogout: () => void;
}) {
  return (
    <div className="control-account-menu">
      <button
        type="button"
        className="control-avatar-button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
      >
        {accountInitial}
      </button>
      {open ? (
        <div className="control-account-popover" role="menu">
          <div className="control-account-identity">
            <span className="control-avatar-badge">{accountInitial}</span>
            <div>
              <strong>{user?.displayName || user?.email || 'Account'}</strong>
              <span>{user?.email ?? 'Loading account'}</span>
            </div>
          </div>
          <dl className="control-detail-list compact two">
            <div><dt>Status</dt><dd>{statusLabel(user?.status ?? 'loading')}</dd></div>
            <div><dt>Plan</dt><dd>{user?.plan ?? 'developer'}</dd></div>
            <div><dt>Quota</dt><dd>{user?.quotaProfile ?? 'default'}</dd></div>
          </dl>
          <form onSubmit={onProfileSave} className="control-inline-form">
            <Field label="Display name" value={profileName} onChange={onProfileNameChange} />
            <ActionButton type="submit" disabled={!auth || busy === 'Update profile'}>
              Save
            </ActionButton>
          </form>
          <div className="control-usage-grid compact">
            <div><span>Requests</span><strong>{usage?.requestCount ?? 0}</strong></div>
            <div><span>Tokens</span><strong>{totalTokens}</strong></div>
            <div><span>Total cost</span><strong>${totalCostUsd.toFixed(2)}</strong></div>
            <div><span>Harness</span><strong>{harnessUsage?.eventCount ?? 0}</strong></div>
            <div><span>Compute</span><strong>{Number(harnessUsage?.computeUnits ?? 0).toFixed(1)}</strong></div>
            <div><span>LLM cost</span><strong>${Number(usage?.costUsd ?? 0).toFixed(2)}</strong></div>
            <div><span>Harness cost</span><strong>${Number(harnessUsage?.costUsd ?? 0).toFixed(2)}</strong></div>
          </div>
          <details className="control-account-disclosure">
            <summary>Account details</summary>
            <dl className="control-detail-list compact">
              <CopyField label="Control plane API" value={controlPlaneBaseUrl} />
            </dl>
          </details>
          <details className="control-account-disclosure">
            <summary>Usage history</summary>
            <div className="control-usage-events compact">
              {usageEventsLoading ? (
                <p className="control-empty">Loading LLM usage...</p>
              ) : usageEvents.length === 0 ? (
                <p className="control-empty">No LLM usage events yet.</p>
              ) : (
                usageEvents.slice(0, 4).map((event) => (
                  <div key={event.id}>
                    <strong>{event.model}</strong>
                    <span>{event.provider}, {event.inputTokens + event.outputTokens} tokens, ${Number(event.costUsd).toFixed(2)}</span>
                    <small>{event.occurredAt}</small>
                  </div>
                ))
              )}
            </div>
            <div className="control-usage-events compact">
              {usageEventsLoading ? (
                <p className="control-empty">Loading Harness usage...</p>
              ) : harnessUsageEvents.length === 0 ? (
                <p className="control-empty">No Harness usage events yet.</p>
              ) : (
                harnessUsageEvents.slice(0, 4).map((event) => (
                  <div key={event.id}>
                    <strong>{event.tool ?? event.module}</strong>
                    <span>{event.module}, {event.status}, ${Number(event.costUsd).toFixed(2)}</span>
                    <small>{event.occurredAt}</small>
                  </div>
                ))
              )}
            </div>
          </details>
          <ActionButton onClick={onLogout}>
            Sign out
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}
