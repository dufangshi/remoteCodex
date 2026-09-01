import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createThreadRecord,
  createWorkspaceRecord,
  getThreadRecordByProviderSessionId,
  getWorkspaceRecordByPath,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import {
  defaultSandboxModeForApprovalMode,
} from './dto';
import { HttpError } from './app';
import type { ThreadSessionCoordinator } from './thread-session-coordinator';
import {
  normalizeAgentBackendId,
  type AgentBackendIdDto,
  type ImportThreadCandidateDto,
  type ImportThreadInput,
} from '../../../packages/shared/src/index';

async function pathExists(absPath: string) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveComparablePath(absPath: string): Promise<string> {
  const resolved = path.resolve(absPath);
  if (await pathExists(resolved)) {
    return fs.realpath(resolved);
  }

  const parentPath = path.dirname(resolved);
  if (parentPath === resolved) {
    return resolved;
  }

  const resolvedParent = await resolveComparablePath(parentPath);
  return path.join(resolvedParent, path.basename(resolved));
}

async function resolveImportedWorkspacePath(
  candidatePath: string,
) {
  if (!path.isAbsolute(candidatePath)) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Imported session path must be absolute.',
    });
  }

  return resolveComparablePath(candidatePath);
}

export class ThreadImportCoordinator {
  constructor(
    private readonly db: DatabaseClient,
    private readonly sessionCoordinator: ThreadSessionCoordinator,
  ) {}

  async listImportCandidates(
    providerInput: string | null | undefined,
    agentId?: string | null,
  ): Promise<ImportThreadCandidateDto[]> {
    const provider = normalizeAgentBackendId(providerInput ?? 'codex') ?? 'codex';
    const sessions = await this.sessionCoordinator.listImportSessions(provider, agentId);
    return sessions
      .filter((session) =>
        Boolean(session.providerSessionId.trim()) &&
        path.isAbsolute(session.cwd) &&
        !getThreadRecordByProviderSessionId(
          this.db,
          provider,
          session.providerSessionId,
        ))
      .map((session) => ({
        provider: provider as AgentBackendIdDto,
        agentId: session.agentId ?? null,
        sessionId: session.providerSessionId,
        cwd: session.cwd,
        title: session.title?.trim() || session.preview?.trim() || 'Untitled session',
        preview: session.preview,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        historyStatus: 'unknown' as const,
      }))
      .sort((left, right) =>
        (right.updatedAt ?? right.createdAt ?? '').localeCompare(
          left.updatedAt ?? left.createdAt ?? '',
        ));
  }

  async importLocalThread(input: ImportThreadInput) {
    const normalizedSessionId = input.sessionId.trim();
    if (!normalizedSessionId) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Session id is required.',
      });
    }
    const provider = normalizeAgentBackendId(input.provider ?? 'codex') ?? 'codex';

    const existingThread = getThreadRecordByProviderSessionId(
      this.db,
      provider,
      normalizedSessionId,
    );
    if (existingThread) {
      return existingThread.id;
    }

    const importSession = await this.sessionCoordinator.resolveLocalImportSession({
      provider,
      sessionId: normalizedSessionId,
    });
    if (!importSession) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Session not found on this machine.',
      });
    }

    const importedPath = await resolveImportedWorkspacePath(importSession.cwd);
    let workspace = getWorkspaceRecordByPath(this.db, importedPath);

    if (!workspace) {
      workspace = createWorkspaceRecord(this.db, {
        absPath: importedPath,
        label: path.basename(importedPath) || 'workspace',
      });
    }

    const created = createThreadRecord(this.db, {
      workspaceId: workspace.id,
      provider: importSession.provider,
      agentId: importSession.agentId ?? null,
      providerSessionId: importSession.sessionId,
      title: importSession.title,
      model: importSession.model,
      reasoningEffort: null,
      collaborationMode: 'default',
      approvalMode: 'yolo',
      sandboxMode: defaultSandboxModeForApprovalMode('yolo'),
      summaryText: importSession.summaryText,
      fastMode: importSession.fastMode,
      source: importSession.source,
      isConnected: false,
    });

    return created.id;
  }

  async assertImportedThreadReadyForPrompt(input: {
    source?: string | null;
    providerSessionId: string;
    provider?: string | null;
    listLoadedProviderSessionIds(provider: string | null | undefined): Promise<Set<string>>;
  }) {
    if (input.source !== 'local_codex_import' && input.source !== 'local_provider_import') {
      return;
    }

    const loadedIds = await input.listLoadedProviderSessionIds(input.provider);
    if (!loadedIds.has(input.providerSessionId)) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Resume / Connect this imported session before sending a new prompt.',
      });
    }
  }

  async ensureImportedThreadConnectedForImplementation(input: {
    source?: string | null;
    providerSessionId: string;
    provider?: string | null;
    model?: string | null;
    listLoadedProviderSessionIds(provider: string | null | undefined): Promise<Set<string>>;
    resumeThread(input: { model?: string }): Promise<unknown>;
  }) {
    if (input.source !== 'local_codex_import' && input.source !== 'local_provider_import') {
      return;
    }

    const loadedIds = await input.listLoadedProviderSessionIds(input.provider);
    if (loadedIds.has(input.providerSessionId)) {
      return;
    }

    await input.resumeThread({
      ...(input.model ? { model: input.model } : {}),
    });
  }
}
