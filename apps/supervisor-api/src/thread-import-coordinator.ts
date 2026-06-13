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
import { normalizeAgentBackendId, type ImportThreadInput } from '../../../packages/shared/src/index';

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
  workspaceRoot: string,
  candidatePath: string,
) {
  if (!path.isAbsolute(candidatePath)) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Imported session path must be absolute.',
    });
  }

  const resolvedRoot = await resolveComparablePath(workspaceRoot);
  const resolvedCandidate = await resolveComparablePath(candidatePath);
  const normalizedRoot = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`;

  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(normalizedRoot)
  ) {
    throw new HttpError(403, {
      code: 'forbidden',
      message: 'Imported session path must stay within the configured workspace root.',
    });
  }

  return resolvedCandidate;
}

export class ThreadImportCoordinator {
  constructor(
    private readonly db: DatabaseClient,
    private readonly sessionCoordinator: ThreadSessionCoordinator,
    private readonly workspaceRoot: string,
  ) {}

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

    const importedPath = await resolveImportedWorkspacePath(
      this.workspaceRoot,
      importSession.cwd,
    );
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
    if (input.source !== 'local_codex_import') {
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
    if (input.source !== 'local_codex_import') {
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
