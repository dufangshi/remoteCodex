import type { AgentBackendIdDto } from '@remote-codex/shared';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ControlPlaneAccountMenu } from './control-plane/ControlPlaneAccountMenu';
import { ControlPlaneAlerts } from './control-plane/ControlPlaneAlerts';
import { ControlPlaneExplorerPanel } from './control-plane/ControlPlaneExplorerPanel';
import { ControlPlaneInspector } from './control-plane/ControlPlaneInspector';
import { ControlPlaneShell } from './control-plane/ControlPlaneShell';
import { ControlPlaneSidebar } from './control-plane/ControlPlaneSidebar';
import { ControlPlaneTopBar } from './control-plane/ControlPlaneTopBar';
import {
  ActionButton,
  CopyField,
  Field,
  HARNESS_MODULE_LABELS,
  MetadataDisclosure,
  ProjectTreeIcon,
  SessionStatusBadge,
  SessionTreeIcon,
  TreeChevron,
  TreeEntityActions,
  TreeRenameForm,
  WorkspaceTreeIcon,
  connectionLabel,
  entityKey,
  formatRelativeTime,
  harnessState,
  harnessTone,
  payloadItemLabel,
  payloadItemMeta,
  payloadItems,
  payloadPreview,
  providerLabel,
  sandboxActionPresentation,
  sandboxBanner,
  sandboxHealthLabel,
  sandboxStageLabel,
  sessionRuntimeLabel,
  slugFromName,
  statusLabel,
  statusTone,
  workspaceSourceLabel,
  workspaceTreeLabel,
  type InspectorTab,
} from './controlPlanePresentation';
import { useControlPlanePageController } from './useControlPlanePageController';

export function ControlPlanePage() {
  const controller = useControlPlanePageController();
  const {
    auth,
    user,
    sandbox,
    adminSandboxDetail,
    usage,
    billing,
    usageEvents,
    harnessUsage,
    harnessUsageEvents,
    projects,
    workspaces,
    sessions,
    selectedProjectId,
    selectedWorkspaceId,
    selectedSessionId,
    openSessionMenuId,
    routeToken,
    workerSocketUrl,
    harnessStatus,
    selectedHarnessModule,
    harnessTools,
    harnessRuns,
    harnessError,
    projectName,
    workspaceName,
    sessionTitle,
    sessionProvider,
    editingEntity,
    editingName,
    pendingDelete,
    busy,
    error,
    message,
    accountMenuOpen,
    createPanelOpen,
    inspectorOpen,
    inspectorTab,
    profileName,
    gatewayUnavailable,
    quotaExceeded,
    disabledAccount,
    expiredSession,
    sandboxOffline,
    adminUsersForbidden,
    metadataLoading,
    workerConnectionState,
    canUseControlPlane,
    sandboxReady,
    sandboxActions,
    sandboxProvisioning,
    selectedProject,
    selectedWorkspace,
    selectedSession,
    canCreateWorkspace,
    canCreateSession,
    sandboxNotice,
    workspaceCreateBlocker,
    sessionCreateBlocker,
    sessionConnectBlocker,
    createTarget,
    createTargetLabel,
    createPanelTitle,
    createPanelBlocker,
    selectedPath,
    harnessStatusText,
    harnessModules,
    harnessToolItems,
    harnessRunItems,
    harnessToolsPreview,
    harnessRunsPreview,
    accountInitial,
    totalTokens,
    totalCostUsd,
    activeSessions,
    sessionsNeedingStart,
    failedSessions,
    sessionFilters,
    controlPlaneBaseUrl,
    selectedSessionActivity,
    sandboxActivity,
    sandboxProgressLabel,
    sandboxHealthSummary,
    toolbarTitle,
    toolbarSubtitle,
    setSelectedProjectId,
    setSelectedWorkspaceId,
    setSelectedSessionId,
    setOpenSessionMenuId,
    setRouteToken,
    setWorkerSocketUrl,
    setProjectName,
    setWorkspaceName,
    setSessionTitle,
    setSessionProvider,
    setEditingName,
    setPendingDelete,
    setAccountMenuOpen,
    setCreatePanelOpen,
    setInspectorOpen,
    setInspectorTab,
    setProfileName,
    setSessions,
    setWorkerConnectionState,
    refresh,
    refreshHarness,
    closeWorkerSocket,
    clearRouteTokenRefreshTimer,
    handleLogout,
    handleProfileSave,
    handleCreateProject,
    handleCreateWorkspace,
    handleCreateSession,
    sandboxAction,
    handleHarnessModuleSelect,
    handleInspectSandbox,
    handleRouteToken,
    handleOpenSession,
    handleShowSessionDetails,
    handleCopySessionField,
    startEditEntity,
    cancelEditEntity,
    saveEditEntity,
    confirmDeleteEntity,
    handleCloseSession,
    handleResumeSession,
    deleteCopy,
  } = controller;

  const topBar = (
      <ControlPlaneTopBar
        title={toolbarTitle}
        subtitle={toolbarSubtitle}
        actions={
          <>
          {sandbox ? (
            <span className={`control-status-pill ${statusTone(sandbox.state)}`}>
              {statusLabel(sandbox.state)}
            </span>
          ) : null}
          <ActionButton onClick={() => void refresh(auth)} disabled={!auth || busy === 'Load control plane'}>
            Refresh
          </ActionButton>
          <ActionButton
            onClick={() => setInspectorOpen((open) => !open)}
            ariaLabel={inspectorOpen ? 'Hide details inspector' : 'Show details inspector'}
          >
            Inspector
          </ActionButton>
          <ControlPlaneAccountMenu
            accountInitial={accountInitial}
            open={accountMenuOpen}
            user={user}
            auth={auth}
            busy={busy}
            profileName={profileName}
            usage={usage}
            usageEvents={usageEvents}
            harnessUsage={harnessUsage}
            harnessUsageEvents={harnessUsageEvents}
            totalTokens={totalTokens}
            totalCostUsd={totalCostUsd}
            controlPlaneBaseUrl={controlPlaneBaseUrl}
            usageEventsLoading={metadataLoading.usageEvents}
            onToggle={() => setAccountMenuOpen((open) => !open)}
            onProfileNameChange={setProfileName}
            onProfileSave={handleProfileSave}
            onLogout={handleLogout}
          />
          </>
        }
      />
  );

  const alerts = (
    <ControlPlaneAlerts
      error={error}
      message={message}
      gatewayUnavailable={gatewayUnavailable}
      quotaExceeded={quotaExceeded}
      disabledAccount={disabledAccount}
      expiredSession={expiredSession}
      adminUsersForbidden={adminUsersForbidden}
      workerConnectionState={workerConnectionState}
      sandboxOffline={sandboxOffline}
      sandboxNotice={sandboxNotice}
    />
  );


  return (
    <>
    <ControlPlaneShell
      topBar={topBar}
      alerts={alerts}
      sidebar={null}
      main={null}
      inspector={null}
      inspectorOpen={inspectorOpen}
    >
        <ControlPlaneExplorerPanel controller={controller} />

        <main className="control-main-column">
          <section className="control-workspace-hero" aria-label="Current control plane context">
            <div>
              <span>Current workspace</span>
              <h2>{selectedWorkspace?.name ?? selectedProject?.name ?? 'Select a workspace'}</h2>
              <p>
                {selectedWorkspace
                  ? `${selectedProject?.name ?? 'Project'} · ${workspaceSourceLabel(selectedWorkspace.sourceType)}`
                  : 'Pick a project and workspace before creating sessions.'}
              </p>
            </div>
            <div className="control-workspace-hero-actions">
              <span className={`control-status-pill ${statusTone(sandbox?.state ?? 'unknown')}`}>
                {statusLabel(sandbox?.state)}
              </span>
              <ActionButton
                onClick={() => void sandboxAction('start')}
                disabled={sandboxActions.start.disabled}
                title={sandboxActions.start.title}
                ariaLabel={`Sandbox ${sandboxActions.start.label}`}
              >
                {sandboxActions.start.label}
              </ActionButton>
              <ActionButton
                onClick={() => void sandboxAction('restart')}
                disabled={sandboxActions.restart.disabled}
                title={sandboxActions.restart.title}
                ariaLabel="Sandbox restart"
              >
                {sandboxActions.restart.label}
              </ActionButton>
              <ActionButton
                onClick={() => void sandboxAction('health')}
                disabled={sandboxActions.health.disabled}
                title={sandboxActions.health.title}
                ariaLabel="Sandbox health"
              >
                {sandboxActions.health.label}
              </ActionButton>
              <ActionButton
                onClick={() => setCreatePanelOpen(createTarget)}
                disabled={createTarget === 'workspace' ? !canCreateWorkspace : createTarget === 'session' ? !canCreateSession : !canUseControlPlane}
                title={createTarget === 'workspace' ? workspaceCreateBlocker : createTarget === 'session' ? sessionCreateBlocker : undefined}
              >
                New {createTargetLabel}
              </ActionButton>
            </div>
          </section>

          <section className="control-overview-strip" aria-label="Control plane overview">
            <div>
              <span>Projects</span>
              <strong>{projects.length}</strong>
            </div>
            <div>
              <span>Workspaces</span>
              <strong>{workspaces.length}</strong>
            </div>
            <div>
              <span>Active sessions</span>
              <strong>{activeSessions}</strong>
            </div>
            <div>
              <span>Sandbox</span>
              <strong>{statusLabel(sandbox?.state)}</strong>
            </div>
          </section>

          <section className="control-panel control-session-list-panel">
            <div className="control-panel-heading">
              <h2>Sessions</h2>
              <span>
                {selectedWorkspace
                  ? `${sessions.length} in workspace`
                  : 'Select workspace'}
              </span>
            </div>
            {selectedWorkspace ? (
              <>
                {sessionCreateBlocker ? <p className="control-rule-note">{sessionCreateBlocker}</p> : null}
                {metadataLoading.sessions ? (
                  <p className="control-empty">Loading sessions...</p>
                ) : sessions.length === 0 ? (
                  <p className="control-empty">No sessions in this workspace. Start the sandbox, then create a session.</p>
                ) : (
                  <div className="control-session-list" role="list" aria-label="Workspace sessions">
                    {sessions.map((session) => (
                      <article
                        key={session.id}
                        role="listitem"
                        className={`control-session-row ${selectedSessionId === session.id ? 'selected' : ''}`}
                      >
                        <button
                          type="button"
                          aria-label={`Open session ${session.title} summary`}
                          className="control-session-row-main"
                          onClick={() => void handleOpenSession(session)}
                        >
                          <strong>{session.title}</strong>
                          <span>{providerLabel(session.provider)} · {formatRelativeTime(session.lastActivityAt ?? session.updatedAt)}</span>
                        </button>
                        <div className="control-session-row-state">
                          <SessionStatusBadge status={session.status} />
                          <span>{sessionRuntimeLabel(session)}</span>
                        </div>
                        <div className="control-session-row-actions">
                          <ActionButton
                            onClick={() => void handleResumeSession(session)}
                            disabled={!auth || !sandboxReady}
                            title={!sandboxReady ? 'Start the sandbox before opening this session.' : undefined}
                            ariaLabel={`${session.workerSessionId ? 'Resume' : 'Start'} session ${session.title} from summary`}
                          >
                            {session.workerSessionId ? 'Resume' : 'Start'}
                          </ActionButton>
                          <div className="control-row-menu">
                            <button
                              type="button"
                              className="control-row-menu-trigger"
                              aria-label={`More actions for session ${session.title}`}
                              aria-haspopup="menu"
                              aria-expanded={openSessionMenuId === session.id}
                              onClick={() =>
                                setOpenSessionMenuId((current) => (current === session.id ? null : session.id))
                              }
                            >
                              ...
                            </button>
                            {openSessionMenuId === session.id ? (
                              <div className="control-row-menu-popover" role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => handleShowSessionDetails(session)}
                                >
                                  Show details
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => handleCopySessionField('Session ID', session.id)}
                                >
                                  Copy session ID
                                </button>
                                {session.sandboxId ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => handleCopySessionField('Sandbox ID', session.sandboxId)}
                                  >
                                    Copy sandbox ID
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={!auth || !session.workerSessionId || !sandboxReady}
                                  title={!session.workerSessionId ? 'Session has not been started yet.' : undefined}
                                  onClick={() => {
                                    setOpenSessionMenuId(null);
                                    void handleCloseSession(session);
                                  }}
                                >
                                  Close session
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <div className="control-action-row start">
                  <ActionButton
                    onClick={() => setCreatePanelOpen('session')}
                    disabled={!canCreateSession}
                    title={sessionCreateBlocker}
                  >
                    Create session
                  </ActionButton>
                </div>
              </>
            ) : (
              <p className="control-empty">Choose a workspace from the browser to see its sessions.</p>
            )}
          </section>

          <section className="control-panel control-selected-panel control-context-summary-panel">
            <div className="control-panel-heading">
              <h2>{selectedSession ? 'Selected session' : selectedWorkspace ? 'Workspace context' : selectedProject ? 'Project context' : 'Selection'}</h2>
              <span>
                {selectedSession
                  ? statusLabel(selectedSession.status)
                  : selectedWorkspace
                    ? workspaceSourceLabel(selectedWorkspace.sourceType)
                    : selectedProject
                      ? statusLabel(selectedProject.status)
                      : 'Root'}
              </span>
            </div>

            {selectedSession ? (
              <>
                <dl className="control-detail-list compact summary">
                  <div><dt>Title</dt><dd>{selectedSession.title}</dd></div>
                  <div><dt>Provider</dt><dd>{providerLabel(selectedSession.provider)}</dd></div>
                  <div><dt>Status</dt><dd><span className={`control-status-pill compact ${statusTone(selectedSession.status)}`}>{statusLabel(selectedSession.status)}</span></dd></div>
                  <div><dt>Last activity</dt><dd>{formatRelativeTime(selectedSessionActivity)}</dd></div>
                  <div><dt>Sandbox</dt><dd>{sandboxReady ? 'Ready' : statusLabel(sandbox?.state)}</dd></div>
                  <div><dt>Runtime</dt><dd>{sessionRuntimeLabel(selectedSession)}</dd></div>
                </dl>
                <div className="control-action-row start">
                  <ActionButton
                    onClick={() => void handleResumeSession(selectedSession)}
                    disabled={!auth || !sandboxReady}
                    title={!sandboxReady ? 'Start the sandbox before opening this session.' : undefined}
                    ariaLabel={`${selectedSession.workerSessionId ? 'Resume' : 'Start'} session ${selectedSession.title} from detail`}
                  >
                    {selectedSession.workerSessionId ? 'Resume' : 'Start sandbox session'}
                  </ActionButton>
                  <ActionButton
                    onClick={() => {
                      setInspectorTab('metadata');
                      setInspectorOpen(true);
                    }}
                  >
                    Details
                  </ActionButton>
                </div>
              </>
            ) : selectedWorkspace ? (
              <>
                <dl className="control-detail-list compact summary">
                  <div><dt>Workspace</dt><dd>{selectedWorkspace.name}</dd></div>
                  <div><dt>Project</dt><dd>{selectedProject?.name ?? selectedWorkspace.projectId}</dd></div>
                  <div><dt>Source</dt><dd>{workspaceSourceLabel(selectedWorkspace.sourceType)}</dd></div>
                  <div><dt>Sessions</dt><dd>{sessions.length}</dd></div>
                  <div><dt>Active</dt><dd>{activeSessions}</dd></div>
                  <div><dt>Not started</dt><dd>{sessionsNeedingStart}</dd></div>
                  <div><dt>Sandbox</dt><dd>{statusLabel(sandbox?.state)}</dd></div>
                </dl>
              </>
            ) : selectedProject ? (
              <>
                <dl className="control-detail-list compact summary">
                  <div><dt>Selected project</dt><dd>{selectedProject.name}</dd></div>
                  <div><dt>Status</dt><dd>{statusLabel(selectedProject.status)}</dd></div>
                  <div><dt>Workspaces</dt><dd>{workspaces.length}</dd></div>
                  <div><dt>Path</dt><dd>{selectedPath}</dd></div>
                </dl>
                <div className="control-action-row start">
                  <ActionButton
                    onClick={() => setCreatePanelOpen('workspace')}
                    disabled={!canCreateWorkspace}
                    title={workspaceCreateBlocker}
                  >
                    Create workspace
                  </ActionButton>
                </div>
              </>
            ) : (
              <p className="control-empty">Select a project to open the workspace hierarchy.</p>
            )}
          </section>

        </main>

        {inspectorOpen ? (
          <button
            type="button"
            className="control-inspector-scrim"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setInspectorOpen(false)}
          />
        ) : null}
        <ControlPlaneInspector
          eyebrow={selectedSession ? 'Session' : selectedWorkspace ? 'Workspace' : selectedProject ? 'Project' : 'Sandbox'}
          hidden={!inspectorOpen}
          onClose={() => setInspectorOpen(false)}
        >

            <div className="control-inspector-tabs" role="tablist" aria-label="Inspector sections">
              {(['summary', 'metadata', 'route', 'logs'] as InspectorTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === tab}
                  className={inspectorTab === tab ? 'selected' : ''}
                  onClick={() => setInspectorTab(tab)}
                >
                  {tab === 'summary' ? 'Summary' : tab === 'metadata' ? 'Metadata' : tab === 'route' ? 'Route' : 'Logs'}
                </button>
              ))}
            </div>

            {inspectorTab === 'summary' ? (
              <div className="control-inspector-tab-panel" role="tabpanel">
                <div className="control-inspector-section">
                  <div className="control-panel-heading compact">
                    <h2>Sandbox</h2>
                    {sandbox ? <span>{sandbox.resourceProfile}</span> : null}
                  </div>
                  {sandbox ? (
                    <dl className="control-detail-list compact summary">
                      <div><dt>State</dt><dd><span className={`control-status-pill compact ${statusTone(sandbox.state)}`}>{statusLabel(sandbox.state)}</span></dd></div>
                      <div><dt>Stage</dt><dd>{sandboxProgressLabel}</dd></div>
                      <div><dt>Health</dt><dd>{sandboxHealthSummary}</dd></div>
                      <div><dt>Last seen</dt><dd>{formatRelativeTime(sandboxActivity)}</dd></div>
                    </dl>
                  ) : (
                    <p className="control-empty">Loading sandbox registry.</p>
                  )}
                </div>
                <div className="control-action-row">
                  <ActionButton
                    onClick={() => void sandboxAction('stop')}
                    disabled={sandboxActions.stop.disabled}
                    title={sandboxActions.stop.title}
                  >
                    {sandboxActions.stop.label}
                  </ActionButton>
                  <ActionButton
                    onClick={handleInspectSandbox}
                    disabled={sandboxActions.inspect.disabled}
                    title={sandboxActions.inspect.title}
                  >
                    {sandboxActions.inspect.label}
                  </ActionButton>
                </div>
                {sandbox && typeof sandbox.startupProgress === 'number' && sandbox.startupProgress > 0 && sandbox.startupProgress < 100 ? (
                  <div className="control-progress">
                    <span>{sandboxProgressLabel}</span>
                    <span>{sandbox.startupProgress}%</span>
                    <div><i style={{ width: `${sandbox.startupProgress}%` }} /></div>
                  </div>
                ) : null}
                {selectedSession || selectedWorkspace || selectedProject ? (
                  <div className="control-inspector-section">
                    <div className="control-panel-heading compact">
                      <h2>{selectedSession ? 'Session' : selectedWorkspace ? 'Workspace' : 'Project'}</h2>
                      <span>{selectedSession ? statusLabel(selectedSession.status) : selectedWorkspace ? workspaceSourceLabel(selectedWorkspace.sourceType) : statusLabel(selectedProject?.status)}</span>
                    </div>
                    <dl className="control-detail-list compact summary">
                      {selectedSession ? (
                        <>
                          <div><dt>Title</dt><dd>{selectedSession.title}</dd></div>
                          <div><dt>Provider</dt><dd>{providerLabel(selectedSession.provider)}</dd></div>
                          <div><dt>Runtime</dt><dd>{sessionRuntimeLabel(selectedSession)}</dd></div>
                        </>
                      ) : selectedWorkspace ? (
                        <>
                          <div><dt>Workspace</dt><dd>{selectedWorkspace.name}</dd></div>
                          <div><dt>Sessions</dt><dd>{sessions.length}</dd></div>
                          <div><dt>Active</dt><dd>{activeSessions}</dd></div>
                        </>
                      ) : selectedProject ? (
                        <>
                          <div><dt>Project</dt><dd>{selectedProject.name}</dd></div>
                          <div><dt>Workspaces</dt><dd>{workspaces.length}</dd></div>
                          <div><dt>Status</dt><dd>{statusLabel(selectedProject.status)}</dd></div>
                        </>
                      ) : null}
                    </dl>
                  </div>
                ) : (
                  <div className="control-inspector-empty">
                    <strong>No object selected</strong>
                    <span>Select a project, workspace, or session to inspect its metadata.</span>
                  </div>
                )}
                <div className="control-inspector-section">
                  <div className="control-panel-heading compact">
                    <h2>Harness</h2>
                    <span className={`control-status-pill ${harnessTone(harnessStatusText)}`}>
                      {statusLabel(harnessStatusText)}
                    </span>
                  </div>
                  {!sandboxReady ? (
                    <p className="control-empty">Start the sandbox to inspect Harness tools.</p>
                  ) : (
                    <>
                      <div className="control-action-row">
                        <ActionButton
                          onClick={() => void refreshHarness(auth, selectedHarnessModule)}
                          disabled={!auth || metadataLoading.harness}
                        >
                          {metadataLoading.harness ? 'Checking...' : 'Refresh'}
                        </ActionButton>
                      </div>
                      {harnessError ? (
                        <div className="control-alert warning">Harness unavailable: {harnessError}</div>
                      ) : null}
                      <dl className="control-detail-list compact summary">
                        <div><dt>Key</dt><dd>{harnessStatus?.keyPresent ? 'Present' : 'Not present'}</dd></div>
                        <div><dt>Chemistry</dt><dd>{harnessStatus?.chemistryToolsEnabled ? 'Enabled' : 'Disabled'}</dd></div>
                        <div><dt>Health</dt><dd>{harnessStatus?.health ? 'OK' : 'Not available'}</dd></div>
                        <div><dt>Module</dt><dd>{HARNESS_MODULE_LABELS[selectedHarnessModule]}</dd></div>
                        <div><dt>Tools</dt><dd>{harnessToolItems.length || 'folder index'}</dd></div>
                        <div><dt>Runs</dt><dd>{harnessRunItems.length || 'history available'}</dd></div>
                      </dl>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {inspectorTab === 'metadata' ? (
              <div className="control-inspector-tab-panel" role="tabpanel">
                {selectedSession ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact"><h2>Session metadata</h2></div>
                    <dl className="control-detail-list">
                      <CopyField label="Session ID" value={selectedSession.id} />
                      <CopyField label="Worker session" value={selectedSession.workerSessionId} />
                      <CopyField label="Workspace ID" value={selectedSession.workspaceId} />
                      <CopyField label="Sandbox ID" value={selectedSession.sandboxId} />
                      <div><dt>Created</dt><dd>{selectedSession.createdAt}</dd></div>
                      <div><dt>Updated</dt><dd>{selectedSession.updatedAt}</dd></div>
                    </dl>
                  </section>
                ) : null}
                {selectedWorkspace ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact"><h2>Workspace metadata</h2></div>
                    <dl className="control-detail-list">
                      <CopyField label="Workspace ID" value={selectedWorkspace.id} />
                      <CopyField label="Project ID" value={selectedWorkspace.projectId} />
                      <CopyField label="Path" value={selectedWorkspace.path} />
                      <div><dt>Slug</dt><dd>{selectedWorkspace.slug}</dd></div>
                      <div><dt>Created</dt><dd>{selectedWorkspace.createdAt}</dd></div>
                      <div><dt>Updated</dt><dd>{selectedWorkspace.updatedAt}</dd></div>
                    </dl>
                  </section>
                ) : null}
                {selectedProject ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact"><h2>Project metadata</h2></div>
                    <dl className="control-detail-list">
                      <CopyField label="Project ID" value={selectedProject.id} />
                      <div><dt>Slug</dt><dd>{selectedProject.slug}</dd></div>
                      <div><dt>Created</dt><dd>{selectedProject.createdAt}</dd></div>
                      <div><dt>Updated</dt><dd>{selectedProject.updatedAt}</dd></div>
                    </dl>
                  </section>
                ) : null}
                {sandbox ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact"><h2>Sandbox metadata</h2></div>
                    <dl className="control-detail-list">
                      <CopyField label="Sandbox ID" value={sandbox.id} />
                      <CopyField label="Image" value={sandbox.image} />
                      <CopyField label="Worker ID" value={sandbox.workerServiceName} />
                      <CopyField label="S3 prefix" value={sandbox.s3Prefix} />
                      {sandbox.statusReason ? <div><dt>Status</dt><dd>{sandbox.statusReason}</dd></div> : null}
                      {sandbox.lastFailureCode ? <div><dt>Failure</dt><dd>{sandbox.lastFailureCode}</dd></div> : null}
                      {sandbox.lastFailureMessage ? <div><dt>Failure message</dt><dd>{sandbox.lastFailureMessage}</dd></div> : null}
                      <div><dt>Created</dt><dd>{sandbox.createdAt}</dd></div>
                      <div><dt>Updated</dt><dd>{sandbox.updatedAt}</dd></div>
                    </dl>
                  </section>
                ) : null}
              </div>
            ) : null}

            {inspectorTab === 'route' ? (
              <div className="control-inspector-tab-panel" role="tabpanel">
                <section className="control-inspector-section">
                  <div className="control-panel-heading compact">
                    <h2>Route</h2>
                    <ActionButton
                      onClick={() => void handleRouteToken('connecting', selectedSessionId)}
                      disabled={!sandboxReady || !selectedSession}
                      title={sessionConnectBlocker}
                    >
                      Create route token
                    </ActionButton>
                  </div>
                  {routeToken ? (
                    <dl className="control-detail-list compact summary route-token">
                      <div><dt>Session</dt><dd>{selectedSession?.title ?? selectedSessionId}</dd></div>
                      <div><dt>Connection</dt><dd>{connectionLabel(workerConnectionState)}</dd></div>
                      <div><dt>Token</dt><dd>{formatRelativeTime(routeToken.expiresAt)} expiry</dd></div>
                    </dl>
                  ) : (
                    <p className="control-empty">
                      {selectedSession ? `Selected session: ${selectedSession.title}. Create a route token after the sandbox is running.` : 'Select a session before creating a route token.'}
                    </p>
                  )}
                </section>
                {routeToken ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact"><h2>Route metadata</h2></div>
                    <dl className="control-detail-list">
                      <CopyField label="Router URL" value={routeToken.routerBaseUrl} />
                      <CopyField label="WebSocket URL" value={routeToken.wsBaseUrl} />
                      <CopyField label="Worker socket" value={workerSocketUrl} />
                      <div><dt>Connection</dt><dd>{connectionLabel(workerConnectionState)}</dd></div>
                      <div><dt>Expires</dt><dd>{routeToken.expiresAt}</dd></div>
                    </dl>
                  </section>
                ) : null}
              </div>
            ) : null}

            {inspectorTab === 'logs' ? (
              <div className="control-inspector-tab-panel" role="tabpanel">
                <section className="control-inspector-section">
                  <div className="control-panel-heading compact">
                    <h2>Harness details</h2>
                    <span className={`control-status-pill ${harnessTone(harnessStatusText)}`}>
                      {statusLabel(harnessStatusText)}
                    </span>
                  </div>
                  {sandboxReady ? (
                    <>
                      <div className="control-segment-row" role="tablist" aria-label="Harness modules">
                        {harnessModules.map((module) => (
                          <button
                            key={module}
                            type="button"
                            role="tab"
                            aria-selected={selectedHarnessModule === module}
                            className={selectedHarnessModule === module ? 'selected' : ''}
                            onClick={() => void handleHarnessModuleSelect(module)}
                            disabled={metadataLoading.harness || !harnessStatus?.enabled || !harnessStatus.keyPresent}
                          >
                            {HARNESS_MODULE_LABELS[module]}
                          </button>
                        ))}
                      </div>
                      <dl className="control-detail-list">
                        <CopyField label="Base URL" value={harnessStatus?.baseUrl} />
                        <div><dt>Enabled</dt><dd>{harnessStatus?.enabled ? 'yes' : 'no'}</dd></div>
                        <div><dt>Modules</dt><dd>{harnessModules.map((module) => HARNESS_MODULE_LABELS[module]).join(', ')}</dd></div>
                      </dl>
                      <div className="control-usage-events compact">
                        <div>
                          <strong>{HARNESS_MODULE_LABELS[selectedHarnessModule]} tools</strong>
                          <small>{harnessToolItems.length} advertised</small>
                        </div>
                        {harnessToolItems.slice(0, 5).map((item, index) => (
                          <div key={`${selectedHarnessModule}-tool-${index}`}>
                            <strong>{payloadItemLabel(item, `tool-${index + 1}`)}</strong>
                            <span>{payloadItemMeta(item) || 'tool'}</span>
                          </div>
                        ))}
                        {harnessToolItems.length === 0 && harnessToolsPreview ? (
                          <div><span>{harnessToolsPreview.slice(0, 180)}</span></div>
                        ) : null}
                        {harnessToolItems.length === 0 && !harnessToolsPreview ? (
                          <p className="control-empty">No tools reported for this module.</p>
                        ) : null}
                      </div>
                      <div className="control-usage-events compact">
                        <div>
                          <strong>Recent runs</strong>
                          <small>{harnessRunItems.length} reported</small>
                        </div>
                        {harnessRunItems.slice(0, 4).map((item, index) => (
                          <div key={`${selectedHarnessModule}-run-${index}`}>
                            <strong>{payloadItemLabel(item, `run-${index + 1}`)}</strong>
                            <span>{payloadItemMeta(item) || 'run'}</span>
                          </div>
                        ))}
                        {harnessRunItems.length === 0 && harnessRunsPreview ? (
                          <div><span>{harnessRunsPreview.slice(0, 180)}</span></div>
                        ) : null}
                        {harnessRunItems.length === 0 && !harnessRunsPreview ? (
                          <p className="control-empty">No runs reported yet.</p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="control-empty">Start the sandbox to inspect Harness tools.</p>
                  )}
                </section>
                {adminSandboxDetail ? (
                  <section className="control-inspector-section">
                    <div className="control-panel-heading compact">
                      <h2>Admin inspection</h2>
                      <span>{statusLabel(adminSandboxDetail.runtimeStatus.state)}</span>
                    </div>
                    <dl className="control-detail-list">
                      <div><dt>Namespace</dt><dd>{adminSandboxDetail.sandbox.k8sNamespace ?? adminSandboxDetail.runtimeStatus.k8sNamespace ?? 'not assigned'}</dd></div>
                      <div><dt>Pod</dt><dd>{adminSandboxDetail.sandbox.k8sPodName ?? adminSandboxDetail.runtimeStatus.k8sPodName ?? 'not assigned'}</dd></div>
                      <div><dt>Endpoint</dt><dd>{adminSandboxDetail.endpoint.routerBaseUrl ?? 'not assigned'}</dd></div>
                      <div><dt>Worker URL</dt><dd>{adminSandboxDetail.workerBaseUrl ?? 'not assigned'}</dd></div>
                    </dl>
                    {adminSandboxDetail.runtimeStatus.statusReason ? (
                      <p className="control-empty">{adminSandboxDetail.runtimeStatus.statusReason}</p>
                    ) : null}
                    <div className="control-usage-events">
                      {adminSandboxDetail.recentLifecycleErrors.length === 0 ? (
                        <p className="control-empty">No lifecycle audit entries.</p>
                      ) : (
                        adminSandboxDetail.recentLifecycleErrors.slice(0, 5).map((entry) => (
                          <div key={entry.id}>
                            <strong>{entry.action}</strong>
                            <small>{entry.createdAt}</small>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                ) : (
                  <div className="control-inspector-empty">
                    <strong>No admin inspection loaded</strong>
                    <span>Use Inspect from Summary to load sandbox runtime diagnostics.</span>
                  </div>
                )}
              </div>
            ) : null}
        </ControlPlaneInspector>
    </ControlPlaneShell>
    <ConfirmDialog
      open={Boolean(pendingDelete)}
      title={deleteCopy.title}
      description={deleteCopy.description}
      confirmLabel="Delete"
      busy={Boolean(busy?.startsWith('Delete '))}
      onCancel={() => setPendingDelete(null)}
      onConfirm={confirmDeleteEntity}
    />
    </>
  );
}
