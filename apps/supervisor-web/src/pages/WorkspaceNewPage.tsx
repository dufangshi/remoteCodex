import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { WorkspaceForm } from '../components/WorkspaceForm';
import { FloatingRoutePanel } from '../components/FloatingRoutePanel';
import { ApiError, createWorkspace, fetchWorkspaceSettings } from '../lib/api';
import { currentThreadsHref } from '../lib/relayRoutes';

export function WorkspaceNewPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devHome, setDevHome] = useState<string | null>(null);

  useEffect(() => {
    fetchWorkspaceSettings()
      .then((settings) => setDevHome(settings.devHome))
      .catch(() => setDevHome(null));
  }, []);

  async function handleSubmit(input: { absPath: string; label?: string } | { gitUrl: string; label?: string }) {
    setBusy(true);
    setError(null);

    try {
      const normalizedInput =
        'absPath' in input &&
        devHome &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.absPath)
          ? { ...input, absPath: `${devHome.replace(/\/$/, '')}/${input.absPath}` }
          : input;
      const workspace = await createWorkspace(normalizedInput);
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
