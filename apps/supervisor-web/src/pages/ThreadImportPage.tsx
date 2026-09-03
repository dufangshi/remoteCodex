import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import type {
  AgentBackendDto,
  AgentBackendIdDto,
  ImportThreadCandidateDto,
  ModelOptionDto,
} from '@remote-codex/shared';
import { defaultAgentBackendId } from '@remote-codex/shared';
import {
  ApiError,
  fetchAgentBackends,
  fetchAgentBackendAgents,
  fetchImportThreadCandidates,
  importThread,
} from '../lib/api';
import { parseSessionRef, providerForImportedAgent } from '../lib/importSessionId';
import { currentThreadHref, currentWorkspacesHref } from '../lib/relayRoutes';

function canImportFromBackend(backend: AgentBackendDto) {
  return backend.enabled && backend.capabilities.sessions.importLocal;
}

export function ThreadImportPage() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState('');
  const [provider, setProvider] = useState<AgentBackendIdDto>(defaultAgentBackendId);
  const [backends, setBackends] = useState<AgentBackendDto[]>([]);
  const [backendsLoading, setBackendsLoading] = useState(true);
  const [backendsError, setBackendsError] = useState<string | null>(null);
  const [backendLoadAttempt, setBackendLoadAttempt] = useState(0);
  const [agents, setAgents] = useState<ModelOptionDto[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [candidates, setCandidates] = useState<ImportThreadCandidateDto[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBackendsLoading(true);
    setBackendsError(null);
    fetchAgentBackends()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setBackends(loaded);
        const preferred =
          loaded.find((backend) => backend.isDefault && canImportFromBackend(backend))?.provider ??
          loaded.find(canImportFromBackend)?.provider ??
          loaded[0]?.provider ??
          defaultAgentBackendId;
        setProvider(preferred);
      })
      .catch((caught) => {
        if (!cancelled) {
          setBackends([]);
          setBackendsError(
            caught instanceof Error ? caught.message : 'Unable to load backends.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBackendsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [backendLoadAttempt]);

  useEffect(() => {
    let cancelled = false;
    if (provider !== 'acp') {
      setAgents([]);
      setAgentId(null);
      setAgentsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setAgentsLoading(true);
    fetchAgentBackendAgents('acp')
      .then((loaded) => {
        if (cancelled) return;
        setAgents(loaded);
        setAgentId((current) => {
          if (current && loaded.some((agent) => agent.id === current)) {
            return current;
          }
          return loaded.find((agent) => agent.acpAgent?.availability === 'ready')?.id ?? null;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAgents([]);
          setAgentId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    if (provider === 'acp' && !agentId) {
      setCandidates([]);
      setCandidatesLoading(agentsLoading);
      return () => {
        cancelled = true;
      };
    }
    setCandidatesLoading(true);
    setCandidatesError(null);
    fetchImportThreadCandidates(provider, agentId)
      .then((loaded) => {
        if (!cancelled) {
          setCandidates(loaded);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setCandidates([]);
          setCandidatesError(
            caught instanceof Error ? caught.message : 'Unable to list local sessions.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCandidatesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, agentsLoading, provider]);

  const backendOptions = backends;
  const selectedBackend = backendOptions.find((backend) => backend.provider === provider) ?? null;
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;
  const canImportSelection = Boolean(
    selectedBackend &&
      canImportFromBackend(selectedBackend) &&
      (provider !== 'acp' || selectedAgent?.acpAgent?.availability === 'ready'),
  );
  const normalizedCandidateQuery = candidateQuery.trim().toLocaleLowerCase();
  const filteredCandidates = useMemo(
    () =>
      normalizedCandidateQuery
        ? candidates.filter((candidate) =>
            `${candidate.title} ${candidate.sessionId} ${candidate.cwd ?? ''} ${candidate.preview ?? ''}`
              .toLocaleLowerCase()
              .includes(normalizedCandidateQuery),
          )
        : candidates,
    [candidates, normalizedCandidateQuery],
  );
  const parsedSession = parseSessionRef(sessionId);
  const selectedCandidate = candidates.find(
    (candidate) => candidate.sessionId === parsedSession.rawId,
  ) ?? null;

  function applyPastedSession(value: string) {
    setError(null);
    const parsed = parseSessionRef(value);
    const looksComplete =
      Boolean(parsed.rawId) &&
      parsed.rawId !== value.trim() &&
      /[0-9a-f]{8}-[0-9a-f-]{4,}/i.test(parsed.rawId);
    setSessionId(looksComplete ? parsed.rawId : value);
    if (!parsed.agentId || !looksComplete) {
      return;
    }
    const nextProvider = providerForImportedAgent(
      parsed.agentId,
      backendOptions.map((backend) => backend.provider),
    );
    if (nextProvider && nextProvider !== provider) {
      setProvider(nextProvider);
    }
    if (nextProvider === 'acp' || provider === 'acp') {
      setAgentId(parsed.agentId);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseSessionRef(sessionId);
    const normalizedSessionId = parsed.rawId;
    if (!normalizedSessionId) {
      setError('Session ID is required.');
      return;
    }
    if (!canImportSelection) {
      setError(
        provider === 'acp'
          ? 'Choose a ready ACP agent before importing this session.'
          : 'Choose a backend that supports local session import.',
      );
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const imported = await importThread({
        sessionId: normalizedSessionId,
        provider,
        agentId: provider === 'acp' ? agentId : provider,
      });
      navigate(currentThreadHref(imported.thread.id));
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.payload.message);
      } else {
        setError(caught instanceof Error ? caught.message : 'Unable to import session.');
      }
    } finally {
      setBusy(false);
    }
  }

  function cancelImport() {
    navigate(currentWorkspacesHref());
  }

  return (
    <div className="product-page !max-w-3xl pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:pt-4">
      <div className="product-topbar">
        <button
          aria-label="Back to workspaces"
          className="product-icon-button"
          onClick={cancelImport}
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-[var(--theme-fg)]">Import session</span>
      </div>

      <header className="product-page-header">
        <div>
          <p className="product-eyebrow">Session library</p>
          <h1 className="product-title mt-1.5">Import a backend session</h1>
          <p className="product-description mt-2">
            Resume a session discovered on this supervisor, or paste its session ID.
          </p>
        </div>
      </header>

      <form className="divide-y divide-[var(--theme-border)]" onSubmit={handleSubmit}>
        <section className="product-divider-section space-y-5">
          {backendsError ? (
            <div className="host-error flex flex-col gap-3 rounded-md border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" role="alert">
              <span>Backends could not be loaded. {backendsError}</span>
              <button
                className="host-secondary-button inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold"
                onClick={() => setBackendLoadAttempt((attempt) => attempt + 1)}
                type="button"
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                Retry
              </button>
            </div>
          ) : null}

          <div>
          <label htmlFor="backend-provider" className="host-form-label text-sm font-medium">
            Backend
          </label>
          <select
            id="backend-provider"
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as AgentBackendIdDto);
              setSessionId('');
              setError(null);
            }}
            disabled={busy || backendsLoading || backendOptions.length === 0}
            className="host-form-control mt-2 w-full rounded-md border px-3 outline-none transition"
          >
            {backendsLoading ? <option value="">Loading backends...</option> : null}
            {!backendsLoading && backendOptions.length === 0 ? <option value="">No backends available</option> : null}
            {backendOptions.map((backend) => (
              <option disabled={!canImportFromBackend(backend)} key={backend.provider} value={backend.provider}>
                {backend.displayName}
                {canImportFromBackend(backend) ? '' : ' (import unavailable)'}
              </option>
            ))}
          </select>
          </div>
          {provider === 'acp' && (
            <div>
            <label htmlFor="acp-agent" className="host-form-label text-sm font-medium">
              ACP agent
            </label>
            <select
              id="acp-agent"
              value={agentId ?? ''}
              onChange={(event) => {
                setAgentId(event.target.value || null);
                setSessionId('');
                setError(null);
              }}
              disabled={busy || agentsLoading || agents.length === 0}
              className="host-form-control mt-2 w-full rounded-md border px-3 outline-none transition"
            >
              <option value="">
                {agentsLoading ? 'Loading agents...' : 'No ready ACP agent'}
              </option>
              {agents.map((agent) => (
                <option
                  key={agent.id}
                  value={agent.id}
                  disabled={agent.acpAgent?.availability !== 'ready'}
                >
                  {agent.displayName}
                  {agent.acpAgent?.availability === 'ready'
                    ? ''
                    : ` (${agent.acpAgent?.availability ?? 'unavailable'})`}
                </option>
              ))}
            </select>
            </div>
          )}
        </section>

        <section className="product-divider-section space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--theme-fg)]">Recent sessions</h2>
              <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                {candidatesLoading ? 'Scanning this supervisor...' : `${filteredCandidates.length} of ${candidates.length} sessions`}
              </p>
            </div>
          </div>
          {candidates.length > 8 ? (
            <label className="relative block">
              <span className="sr-only">Search sessions</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--theme-fg-muted)]" />
              <input
                className="host-form-control w-full rounded-md border pl-9 pr-3 text-sm outline-none transition"
                disabled={busy}
                onChange={(event) => {
                  setCandidateQuery(event.target.value);
                  setError(null);
                }}
                placeholder="Search title, ID, or workspace"
                type="search"
                value={candidateQuery}
              />
            </label>
          ) : null}
          <label className="block" htmlFor="available-session">
            <span className="host-form-label text-sm font-medium">Available session</span>
          <select
            id="available-session"
            value={selectedCandidate?.sessionId ?? ''}
            onChange={(event) => {
              setSessionId(event.target.value);
              setError(null);
            }}
            disabled={busy || candidatesLoading || filteredCandidates.length === 0}
            className="host-form-control mt-2 w-full rounded-md border px-3 outline-none transition"
          >
            <option value="">
              {candidatesLoading
                ? 'Loading sessions...'
                : filteredCandidates.length === 0
                  ? candidateQuery
                    ? 'No matching sessions'
                    : 'No unmanaged sessions found'
                  : 'Select a session'}
            </option>
            {filteredCandidates.map((candidate) => (
              <option key={candidate.sessionId} value={candidate.sessionId}>
                {candidate.title} · {candidate.sessionId}
              </option>
            ))}
          </select>
          </label>
          {selectedCandidate && (
            <div className="host-muted space-y-1 text-xs">
              <p className="break-all">{selectedCandidate.cwd}</p>
              {selectedCandidate.preview && (
                <p className="line-clamp-2">{selectedCandidate.preview}</p>
              )}
            </div>
          )}
          {candidatesError && (
            <p className="text-xs text-[var(--status-warning-fg)]" role="status">
              Session discovery unavailable. Manual import is still available.
            </p>
          )}
        </section>

        <section className="product-divider-section">
          <label htmlFor="session-id" className="host-form-label text-sm font-medium">
            Session ID
          </label>
          <input
            id="session-id"
            aria-describedby={error ? 'import-session-error' : undefined}
            aria-invalid={error ? true : undefined}
            disabled={busy}
            value={sessionId}
            onChange={(event) => applyPastedSession(event.target.value)}
            placeholder="codex://threads/01a0634a-23df-7191-acd2-1fca43a10418"
            className="host-form-control mt-2 w-full rounded-md border px-3 outline-none transition"
          />
          <p className="mt-2 text-xs leading-5 text-[var(--theme-fg-muted)]">
            Full Codex links and supported backend prefixes are accepted.
          </p>

          {error ? (
            <div className="host-error mt-4 rounded-md border px-4 py-3 text-sm" id="import-session-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
            <button
              className="host-secondary-button min-h-11 rounded-md border px-5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={cancelImport}
              type="button"
            >
              Cancel
            </button>
            <button
              className="ui-action-primary min-h-11 rounded-md px-5 text-sm font-semibold transition disabled:cursor-not-allowed"
              disabled={busy || !parseSessionRef(sessionId).rawId || !canImportSelection}
              type="submit"
            >
              {busy ? 'Importing...' : 'Import session'}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}
