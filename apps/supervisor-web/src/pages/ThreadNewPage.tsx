import { useNavigate, useSearchParams } from 'react-router-dom';

import { FloatingRoutePanel } from '../components/FloatingRoutePanel';
import {
  currentThreadHref,
  currentThreadsHref,
  currentWorkspacesHref,
} from '../lib/relayRoutes';
import { ThreadCreateForm } from './thread-create/ThreadCreateForm';

export function ThreadNewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedWorkspaceId = searchParams.get('workspaceId');

  function handleCancel() {
    if (requestedWorkspaceId) {
      navigate(currentThreadsHref(requestedWorkspaceId));
      return;
    }

    navigate(currentWorkspacesHref());
  }

  return (
    <FloatingRoutePanel
      backLabel={requestedWorkspaceId ? 'Back to threads' : 'Back to workspaces'}
      eyebrow="New Thread"
      title="Start a backend session"
      description="Choose a workspace, backend, model, and approval mode."
      maxWidthClassName="!max-w-3xl"
      onBack={handleCancel}
    >
      <ThreadCreateForm
        initialWorkspaceId={requestedWorkspaceId}
        onCancel={handleCancel}
        onCreated={(thread) => navigate(currentThreadHref(thread.id))}
      />
    </FloatingRoutePanel>
  );
}
