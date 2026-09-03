import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  WorkspaceForm,
  type WorkspaceFormInput,
} from '../components/WorkspaceForm';
import { FloatingRoutePanel } from '../components/FloatingRoutePanel';
import { ApiError, createWorkspace, fetchWorkspaceSettings } from '../lib/api';
import { currentThreadsHref, currentWorkspacesHref } from '../lib/relayRoutes';

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

  async function handleSubmit(input: WorkspaceFormInput) {
    setBusy(true);
    setError(null);

    try {
      const normalizedInput = input.mode === 'git'
        ? {
            gitUrl: input.gitUrl,
            ...(input.label ? { label: input.label } : {}),
          }
        : {
            absPath:
              input.mode === 'folder' && devHome
                ? `${devHome.replace(/[\\/]+$/, '')}/${input.absPath}`
                : input.absPath,
            ...(input.label ? { label: input.label } : {}),
          };
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

  function handleCancel() {
    navigate(currentWorkspacesHref());
  }

  return (
    <FloatingRoutePanel
      backLabel="Back to workspaces"
      eyebrow="Workspaces"
      title="Add a workspace"
      description="Choose a folder, existing path, or Git repository."
      onBack={handleCancel}
    >
      <WorkspaceForm
        busy={busy}
        error={error}
        newFolderRoot={devHome}
        surface={false}
        onCancel={handleCancel}
        onInputChange={() => setError(null)}
        onSubmit={handleSubmit}
      />
    </FloatingRoutePanel>
  );
}
