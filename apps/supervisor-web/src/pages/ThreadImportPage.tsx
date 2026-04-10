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
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Import Session</p>
        <h2 className="mt-2 text-3xl font-semibold text-stone-100">Bring in a local Codex session</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-400">
          Paste a session ID from this machine. Supervisor will recover the workspace path, reuse
          an existing workspace when possible, or create one with the last folder name as the
          default label.
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-500">
          Imported history appears immediately, but sending a new prompt still requires a manual
          Resume / Connect.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl border border-stone-800 bg-stone-900 p-6">
        <div>
          <label htmlFor="session-id" className="text-sm font-medium text-stone-200">
            Local session ID
          </label>
          <input
            id="session-id"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            placeholder="019d6fb7-7033-7a30-a2c7-74d0919e87d4"
            className="mt-2 w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
          />
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-amber-200 px-5 py-3 font-medium text-stone-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
          >
            {busy ? 'Importing...' : 'Import Session'}
          </button>
        </div>
      </form>
    </div>
  );
}
