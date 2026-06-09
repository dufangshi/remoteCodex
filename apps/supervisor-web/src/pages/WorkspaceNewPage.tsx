import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { WorkspaceForm } from '../components/WorkspaceForm';
import { ApiError, createWorkspace } from '../lib/api';

export function WorkspaceNewPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(input: { absPath: string; label?: string } | { gitUrl: string; label?: string }) {
    setBusy(true);
    setError(null);

    try {
      const workspace = await createWorkspace(input);
      navigate(`/threads?workspaceId=${encodeURIComponent(workspace.id)}`);
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
        <p className="host-page-eyebrow text-xs uppercase tracking-[0.3em]">Add Workspace</p>
        <h2 className="host-page-title mt-2 text-3xl font-semibold">Create a workspace</h2>
        <p className="host-page-description mt-3 max-w-2xl text-sm leading-6">
          Register an existing local directory, create one missing child directory under dev home,
          or clone a Git repository into dev home.
        </p>
      </div>
      <WorkspaceForm busy={busy} error={error} submitLabel="Create Workspace" onSubmit={handleSubmit} />
    </div>
  );
}
