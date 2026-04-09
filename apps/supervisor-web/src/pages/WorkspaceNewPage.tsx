import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { WorkspaceForm } from '../components/WorkspaceForm';
import { ApiError, createWorkspace } from '../lib/api';

export function WorkspaceNewPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(input: { absPath: string; label?: string }) {
    setBusy(true);
    setError(null);

    try {
      const workspace = await createWorkspace(input);
      navigate(`/workspaces/${workspace.id}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.payload.message);
      } else {
        setError(caught instanceof Error ? caught.message : 'Unable to create workspace.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Add Workspace</p>
        <h2 className="mt-2 text-3xl font-semibold text-stone-100">Register a local directory</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-400">
          Phase 1 only accepts readable absolute directories within the configured workspace root.
        </p>
      </div>
      <WorkspaceForm busy={busy} error={error} submitLabel="Create Workspace" onSubmit={handleSubmit} />
    </div>
  );
}
