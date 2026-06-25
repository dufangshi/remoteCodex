import type { AgentBackendIdDto } from '@remote-codex/shared';

import { ControlPlaneSidebar } from './ControlPlaneSidebar';
import {
  ActionButton,
  Field,
  ProjectTreeIcon,
  SessionTreeIcon,
  TreeChevron,
  TreeEntityActions,
  TreeRenameForm,
  WorkspaceTreeIcon,
  entityKey,
  providerLabel,
  statusLabel,
  workspaceTreeLabel,
} from '../controlPlanePresentation';
import type { ControlPlanePageController } from '../useControlPlanePageController';

export function ControlPlaneExplorerPanel({
  controller,
}: {
  controller: ControlPlanePageController;
}) {
  const {
    user,
    sandbox,
    projects,
    workspaces,
    sessions,
    selectedProjectId,
    selectedWorkspaceId,
    selectedSessionId,
    editingEntity,
    editingName,
    projectName,
    workspaceName,
    sessionTitle,
    sessionProvider,
    createTarget,
    createTargetLabel,
    createPanelOpen,
    createPanelTitle,
    createPanelBlocker,
    canUseControlPlane,
    canCreateWorkspace,
    canCreateSession,
    workspaceCreateBlocker,
    sessionCreateBlocker,
    selectedProject,
    selectedWorkspace,
    sessionFilters,
    totalCostUsd,
    metadataLoading,
    setProjectName,
    setWorkspaceName,
    setSessionTitle,
    setSessionProvider,
    setCreatePanelOpen,
    setAccountMenuOpen,
    setSelectedProjectId,
    setSelectedWorkspaceId,
    setSelectedSessionId,
    setRouteToken,
    setWorkerSocketUrl,
    setSessions,
    setWorkerConnectionState,
    setInspectorTab,
    setInspectorOpen,
    setEditingName,
    setPendingDelete,
    handleCreateProject,
    handleCreateWorkspace,
    handleCreateSession,
    handleOpenSession,
    startEditEntity,
    cancelEditEntity,
    saveEditEntity,
    closeWorkerSocket,
    clearRouteTokenRefreshTimer,
  } = controller;

  return (
        <ControlPlaneSidebar>
          <div className="control-explorer-toolbar">
            <div>
              <h2>Remote Codex</h2>
              <span>{user?.email ?? 'Product account'}</span>
            </div>
            <button
              type="button"
              className="control-icon-button"
              onClick={() => setCreatePanelOpen(createTarget)}
              aria-label={`Open create panel for ${createTargetLabel.toLowerCase()}`}
              title={`Create ${createTargetLabel.toLowerCase()}`}
            >
              +
            </button>
          </div>

          {createPanelOpen ? (
            <div className="control-create-popover">
              <div className="control-panel-heading">
                <h2>{createPanelTitle}</h2>
                <button
                  type="button"
                  className="control-icon-button quiet"
                  onClick={() => setCreatePanelOpen(null)}
                  aria-label="Close create panel"
                >
                  x
                </button>
              </div>
              {createPanelOpen === 'project' ? (
                <form onSubmit={handleCreateProject} className="control-create-form">
                  <Field label="Project name" value={projectName} onChange={setProjectName} />
                  <ActionButton type="submit" disabled={!canUseControlPlane}>
                    Create project
                  </ActionButton>
                </form>
              ) : createPanelOpen === 'workspace' ? (
                <form onSubmit={handleCreateWorkspace} className="control-create-form">
                  <Field label="Workspace name" value={workspaceName} onChange={setWorkspaceName} />
                  {createPanelBlocker ? <p className="control-rule-note">{createPanelBlocker}</p> : null}
                  <ActionButton type="submit" disabled={!canCreateWorkspace} title={workspaceCreateBlocker}>
                    Create workspace
                  </ActionButton>
                </form>
              ) : (
                <form onSubmit={handleCreateSession} className="control-create-form">
                  <Field label="Session title" value={sessionTitle} onChange={setSessionTitle} />
                  <label className="control-field">
                    <span>Provider</span>
                    <select
                      value={sessionProvider}
                      onChange={(event) => setSessionProvider(event.currentTarget.value as AgentBackendIdDto)}
                      disabled={!canCreateSession}
                    >
                      <option value="codex">Codex</option>
                      <option value="claude">Claude</option>
                      <option value="opencode">OpenCode</option>
                    </select>
                  </label>
                  {createPanelBlocker ? <p className="control-rule-note">{createPanelBlocker}</p> : null}
                  <ActionButton type="submit" disabled={!canCreateSession} title={sessionCreateBlocker}>
                    Create session
                  </ActionButton>
                </form>
              )}
            </div>
          ) : null}

          <div className="control-sidebar-body">
            <section className="control-sidebar-section">
              <div className="control-sidebar-section-title">
                <span>Workspace</span>
                <strong>{selectedWorkspace?.name ?? selectedProject?.name ?? 'Not selected'}</strong>
              </div>
              <div className="control-context-card">
                <div>
                  <span>Project</span>
                  <strong>{selectedProject?.name ?? 'Choose project'}</strong>
                </div>
                <div>
                  <span>Workspace</span>
                  <strong>{selectedWorkspace?.name ?? 'Choose workspace'}</strong>
                </div>
              </div>
            </section>

            <section className="control-sidebar-section">
              <div className="control-sidebar-section-title">
                <span>Sessions</span>
                <strong>{sessions.length}</strong>
              </div>
              <div className="control-nav-list" aria-label="Session filters">
                {sessionFilters.map((filter, index) => (
                  <button key={filter.label} type="button" className={`control-nav-row ${index === 0 ? 'selected' : ''}`}>
                    <span>{filter.label}</span>
                    <strong>{filter.value}</strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="control-sidebar-section">
              <div className="control-sidebar-section-title">
                <span>System</span>
              </div>
              <div className="control-nav-list" aria-label="System navigation">
                <button
                  type="button"
                  className="control-nav-row"
                  aria-label={`Open sandbox details, ${statusLabel(sandbox?.state)}`}
                  onClick={() => {
                    setInspectorTab('summary');
                    setInspectorOpen(true);
                  }}
                >
                  <span>Sandbox</span>
                  <strong>{statusLabel(sandbox?.state)}</strong>
                </button>
                <button
                  type="button"
                  className="control-nav-row"
                  onClick={() => setAccountMenuOpen(true)}
                >
                  <span>Usage</span>
                  <strong>${totalCostUsd.toFixed(2)}</strong>
                </button>
                <button
                  type="button"
                  className="control-nav-row"
                  onClick={() => setAccountMenuOpen(true)}
                >
                  <span>Settings</span>
                  <strong>{user?.plan ?? 'dev'}</strong>
                </button>
              </div>
            </section>
          </div>

          <div className="control-explorer-tree">
            {metadataLoading.projects ? (
              <p className="control-empty">Loading projects...</p>
            ) : projects.length === 0 ? (
              <p className="control-empty">No projects yet.</p>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="control-tree-group">
                  {entityKey(editingEntity) === `project:${project.id}` ? (
                    <TreeRenameForm
                      label="Project name"
                      value={editingName}
                      onChange={setEditingName}
                      onCancel={cancelEditEntity}
                      onSubmit={saveEditEntity}
                    />
                  ) : (
                    <div className={`control-tree-item ${selectedProjectId === project.id ? 'selected' : ''}`}>
                      <button
                        type="button"
                        aria-label={`Select project ${project.name}`}
                        onClick={() => {
                          setSelectedProjectId(project.id);
                          setSelectedWorkspaceId('');
                          setSessions([]);
                          setSelectedSessionId('');
                          setRouteToken(null);
                          setWorkerSocketUrl(null);
                          closeWorkerSocket();
                          clearRouteTokenRefreshTimer();
                          setWorkerConnectionState('idle');
                        }}
                        className="control-tree-row project"
                      >
                        <span className="control-tree-caret">
                          <TreeChevron open={selectedProjectId === project.id} />
                        </span>
                        <span className="control-tree-icon">
                          <ProjectTreeIcon />
                        </span>
                        <strong>{project.name}</strong>
                        <small>{statusLabel(project.status)}</small>
                      </button>
                      <TreeEntityActions
                        label={`project ${project.name}`}
                        onEdit={() => startEditEntity({ type: 'project', id: project.id }, project.name)}
                        onDelete={() => setPendingDelete({ type: 'project', id: project.id })}
                      />
                    </div>
                  )}

                  {selectedProjectId === project.id ? (
                    <div className="control-tree-children">
                      {metadataLoading.workspaces ? (
                        <p className="control-empty">Loading workspaces...</p>
                      ) : workspaces.length === 0 ? (
                        <p className="control-empty">No workspaces in this project.</p>
                      ) : (
                        workspaces.map((workspace) => (
                          <div key={workspace.id} className="control-tree-group">
                            {entityKey(editingEntity) === `workspace:${workspace.id}` ? (
                              <TreeRenameForm
                                label="Workspace name"
                                value={editingName}
                                onChange={setEditingName}
                                onCancel={cancelEditEntity}
                                onSubmit={saveEditEntity}
                              />
                            ) : (
                              <div className={`control-tree-item ${selectedWorkspaceId === workspace.id ? 'selected' : ''}`}>
                                <button
                                  type="button"
                                  aria-label={`Select workspace ${workspace.name}`}
                                  onClick={() => {
                                    setSelectedWorkspaceId(workspace.id);
                                    setSelectedSessionId('');
                                    setRouteToken(null);
                                    setWorkerSocketUrl(null);
                                    closeWorkerSocket();
                                    clearRouteTokenRefreshTimer();
                                    setWorkerConnectionState('idle');
                                  }}
                                  className="control-tree-row workspace"
                                >
                                  <span className="control-tree-caret">
                                    <TreeChevron open={selectedWorkspaceId === workspace.id} />
                                  </span>
                                  <span className="control-tree-icon">
                                    <WorkspaceTreeIcon />
                                  </span>
                                  <strong>{workspace.name}</strong>
                                  <small>{workspaceTreeLabel(workspace)}</small>
                                </button>
                                <TreeEntityActions
                                  label={`workspace ${workspace.name}`}
                                  onEdit={() => startEditEntity({ type: 'workspace', id: workspace.id }, workspace.name)}
                                  onDelete={() => setPendingDelete({ type: 'workspace', id: workspace.id })}
                                />
                              </div>
                            )}

                            {selectedWorkspaceId === workspace.id ? (
                              <div className="control-tree-children sessions">
                                {metadataLoading.sessions ? (
                                  <p className="control-empty">Loading sessions...</p>
                                ) : sessions.length === 0 ? (
                                  <p className="control-empty">No sessions for this workspace.</p>
                                ) : (
                                  sessions.map((session) => (
                                    <div key={session.id} className="control-tree-group">
                                      {entityKey(editingEntity) === `session:${session.id}` ? (
                                        <TreeRenameForm
                                          label="Session title"
                                          value={editingName}
                                          onChange={setEditingName}
                                          onCancel={cancelEditEntity}
                                          onSubmit={saveEditEntity}
                                        />
                                      ) : (
                                        <div className={`control-tree-item ${selectedSessionId === session.id ? 'selected' : ''}`}>
                                          <button
                                            type="button"
                                            aria-label={`Open session ${session.title} from workspace browser`}
                                            onClick={() => void handleOpenSession(session)}
                                            className="control-tree-row session"
                                          >
                                            <span className="control-tree-caret" />
                                            <span className="control-tree-icon">
                                              <SessionTreeIcon />
                                            </span>
                                            <strong>{session.title}</strong>
                                            <small>
                                              {providerLabel(session.provider)} / {statusLabel(session.status)}
                                              {session.workerSessionId ? '' : ' / Not started'}
                                            </small>
                                          </button>
                                          <TreeEntityActions
                                            label={`session ${session.title}`}
                                            onEdit={() => startEditEntity({ type: 'session', id: session.id }, session.title)}
                                            onDelete={() => setPendingDelete({ type: 'session', id: session.id })}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  ))
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </ControlPlaneSidebar>
  );
}
