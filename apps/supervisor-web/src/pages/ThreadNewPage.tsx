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
  const requestedTitle = searchParams.get('title');

  function handleCancel() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    if (requestedWorkspaceId) {
      navigate(currentThreadsHref(requestedWorkspaceId));
      return;
    }

    navigate(currentWorkspacesHref());
  }

  return (
    <FloatingRoutePanel
      eyebrow="New Thread"
      title="Start a backend session"
      description="Choose the workspace, model, and approval mode that should back the new thread."
      maxWidthClassName="max-w-3xl"
    >
      <ThreadCreateForm
        initialWorkspaceId={requestedWorkspaceId}
        initialTitle={requestedTitle}
        onCancel={handleCancel}
        onCreated={(thread) => navigate(currentThreadHref(thread.id))}
      />
    </FloatingRoutePanel>
  );
}
