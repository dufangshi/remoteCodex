import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { WorkspaceForm } from '../components/WorkspaceForm';
import { FloatingRoutePanel } from '../components/FloatingRoutePanel';
import { ApiError, createWorkspace } from '../lib/api';
import { currentThreadsHref } from '../lib/relayRoutes';

export function WorkspaceNewPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(input: { absPath: string; label?: string } | { gitUrl: string; label?: string }) {
    setBusy(true);
    setError(null);

    try {
      const workspace = await createWorkspace(input);
      navigate(currentThreadsHref(workspace.id));
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
    <FloatingRoutePanel
      eyebrow="Add Workspace"
      title="Create a workspace"
      description="Enter a folder name to create it under the workspace directory, register an absolute path, or clone a Git repository."
    >
      <WorkspaceForm
        busy={busy}
        error={error}
        submitLabel="Create Workspace"
        surface={false}
        onSubmit={handleSubmit}
      />
    </FloatingRoutePanel>
  );
}
