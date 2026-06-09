import type { FormEvent } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, importThread } from '../lib/api';

export function ThreadImportPage() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const imported = await importThread(normalizedSessionId);
      navigate(`/threads/${imported.thread.id}`);
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
        <h2 className="host-page-title mt-2 text-3xl font-semibold">Bring in a local Codex session</h2>
        <p className="host-page-description mt-3 max-w-3xl text-sm leading-6">
          Paste a session ID from this machine. Supervisor will recover the workspace path, reuse
          an existing workspace when possible, or create one with the last folder name as the
          default label.
        </p>
        <p className="host-muted mt-2 max-w-3xl text-sm leading-6">
          Imported history appears immediately, but sending a new prompt still requires a manual
          Resume / Connect.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="host-panel space-y-5 rounded-3xl border p-6">
        <div>
          <label htmlFor="session-id" className="host-form-label text-sm font-medium">
            Local session ID
          </label>
          <input
            id="session-id"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            placeholder="019d6fb7-7033-7a30-a2c7-74d0919e87d4"
            className="host-form-control mt-2 w-full rounded-2xl border px-4 py-3 outline-none transition"
          />
        </div>

        {error && (
          <div className="host-error rounded-2xl border px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="ui-action-primary rounded-full px-5 py-3 font-medium transition disabled:cursor-not-allowed"
          >
            {busy ? 'Importing...' : 'Import Session'}
          </button>
        </div>
      </form>
    </div>
  );
}
