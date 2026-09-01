import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  AgentBackendDto,
  AgentBackendIdDto,
  ImportThreadCandidateDto,
  ModelOptionDto,
} from '@remote-codex/shared';
import { agentBackendMetadata, defaultAgentBackendId } from '@remote-codex/shared';
import {
  ApiError,
  fetchAgentBackends,
  fetchAgentBackendAgents,
  fetchImportThreadCandidates,
  importThread,
} from '../lib/api';
import { currentThreadHref } from '../lib/relayRoutes';

export function ThreadImportPage() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState('');
  const [provider, setProvider] = useState<AgentBackendIdDto>(defaultAgentBackendId);
  const [backends, setBackends] = useState<AgentBackendDto[]>([]);
  const [backendsLoading, setBackendsLoading] = useState(true);
  const [agents, setAgents] = useState<ModelOptionDto[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [candidates, setCandidates] = useState<ImportThreadCandidateDto[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBackendsLoading(true);
    fetchAgentBackends()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setBackends(loaded);
        const preferred =
          loaded.find((backend) => backend.isDefault && backend.enabled)?.provider ??
          loaded.find((backend) => backend.enabled)?.provider ??
          defaultAgentBackendId;
        setProvider(preferred);
      })
      .catch(() => {
        if (!cancelled) {
          setBackends([]);
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
  }, []);

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

  const backendOptions = useMemo(() => {
    if (backends.length > 0) {
      return backends;
    }
    return [
      {
        provider: defaultAgentBackendId,
        displayName: agentBackendMetadata[defaultAgentBackendId].displayName,
        enabled: true,
      } as AgentBackendDto,
    ];
  }, [backends]);
  const selectedCandidate = candidates.find(
    (candidate) => candidate.sessionId === sessionId.trim(),
  ) ?? null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      setError('Session ID is required.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const imported = await importThread({
        sessionId: normalizedSessionId,
        provider,
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

  return (
    <div className="space-y-6">
      <div>
        <p className="host-page-eyebrow text-xs uppercase tracking-[0.3em]">Import Session</p>
        <h2 className="host-page-title mt-2 text-3xl font-semibold">Bring in a local backend session</h2>
        <p className="host-page-description mt-3 max-w-3xl text-sm leading-6">
          Select the backend and paste a session ID from this machine. Supervisor will recover the workspace path, reuse
          an existing workspace when possible, or create one with the last folder name as the
          default label.
        </p>
        <p className="host-muted mt-2 max-w-3xl text-sm leading-6">
          Imported history appears immediately, but sending a new prompt still requires a manual
          Resume / Connect.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="host-panel space-y-5 rounded-lg border p-5 sm:p-6">
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
            }}
            disabled={busy || backendsLoading}
            className="host-form-control mt-2 w-full rounded-lg border px-4 py-3 outline-none transition"
          >
            {backendOptions.map((backend) => (
              <option key={backend.provider} value={backend.provider}>
                {backend.displayName || agentBackendMetadata[backend.provider].displayName}
                {backend.enabled ? '' : ' (not ready)'}
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
              }}
              disabled={busy || agentsLoading || agents.length === 0}
              className="host-form-control mt-2 w-full rounded-lg border px-4 py-3 outline-none transition"
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
        <div>
          <label htmlFor="available-session" className="host-form-label text-sm font-medium">
            Available sessions
          </label>
          <select
            id="available-session"
            value={selectedCandidate?.sessionId ?? ''}
            onChange={(event) => setSessionId(event.target.value)}
            disabled={busy || candidatesLoading || candidates.length === 0}
            className="host-form-control mt-2 w-full rounded-lg border px-4 py-3 outline-none transition"
          >
            <option value="">
              {candidatesLoading
                ? 'Loading sessions...'
                : candidates.length === 0
                  ? 'No unmanaged sessions found'
                  : 'Select a session'}
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.sessionId} value={candidate.sessionId}>
                {candidate.title} · {candidate.sessionId}
              </option>
            ))}
          </select>
          {selectedCandidate && (
            <div className="host-muted mt-2 space-y-1 text-xs">
              <p className="break-all">{selectedCandidate.cwd}</p>
              {selectedCandidate.preview && (
                <p className="line-clamp-2">{selectedCandidate.preview}</p>
              )}
            </div>
          )}
          {candidatesError && (
            <p className="host-muted mt-2 text-xs">
              Session discovery unavailable. Manual import is still available.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="session-id" className="host-form-label text-sm font-medium">
            Session ID
          </label>
          <input
            id="session-id"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            placeholder="019d6fb7-7033-7a30-a2c7-74d0919e87d4"
            className="host-form-control mt-2 w-full rounded-lg border px-4 py-3 outline-none transition"
          />
        </div>

        {error && (
          <div className="host-error rounded-lg border px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
              className="ui-action-primary rounded-lg px-5 py-3 font-medium transition disabled:cursor-not-allowed"
          >
            {busy ? 'Importing...' : 'Import Session'}
          </button>
        </div>
      </form>
    </div>
  );
}
