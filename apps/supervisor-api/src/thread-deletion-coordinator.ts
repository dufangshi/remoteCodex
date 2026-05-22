import fs from 'node:fs/promises';
import path from 'node:path';

import {
  deleteNotificationsByThreadId,
  deleteThreadActivityNotesByThreadId,
  deleteThreadForkRecordsByForkedThreadId,
  deleteThreadForkRecordsBySourceThreadId,
  deleteThreadGoalRecordsByThreadId,
  deleteThreadHistoryItemRecordsByThreadId,
  deleteThreadPendingSteerRecordsByThreadId,
  deleteThreadRecord,
  deleteThreadTurnMetadataByThreadId,
  deleteViewerSessionsByThreadId,
  getThreadRecordById,
  getWorkspaceRecordById,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import { HttpError } from './app';
import { ProviderRequestCoordinator } from './provider-request-coordinator';
import { ThreadAuxiliaryStateStore } from './thread-auxiliary-state-store';
import { ThreadLiveStateStore } from './thread-live-state-store';
import { ThreadUsageAccounting } from './thread-usage-accounting';

function threadTempDirectoryPath(workspacePath: string, localThreadId: string) {
  return path.join(workspacePath, '.temp', 'threads', localThreadId);
}

interface ThreadDeletionCallbacks {
  invalidateThreadDetailCache(localThreadId: string): void;
}

export class ThreadDeletionCoordinator {
  constructor(
    private readonly db: DatabaseClient,
    private readonly requestCoordinator: ProviderRequestCoordinator,
    private readonly usageAccounting: ThreadUsageAccounting,
    private readonly liveState: ThreadLiveStateStore,
    private readonly auxiliaryState: ThreadAuxiliaryStateStore,
    private readonly callbacks: ThreadDeletionCallbacks,
  ) {}

  async deleteThread(localThreadId: string): Promise<{ id: string }> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (workspace) {
      const tempDirectory = threadTempDirectoryPath(workspace.absPath, localThreadId);
      await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
    }

    this.requestCoordinator.clearThread(localThreadId);
    this.callbacks.invalidateThreadDetailCache(localThreadId);
    this.usageAccounting.clearThread(localThreadId);
    this.liveState.clearThread(localThreadId);
    this.auxiliaryState.clearThread(localThreadId);
    deleteViewerSessionsByThreadId(this.db, localThreadId);
    deleteNotificationsByThreadId(this.db, localThreadId);
    deleteThreadForkRecordsBySourceThreadId(this.db, localThreadId);
    deleteThreadForkRecordsByForkedThreadId(this.db, localThreadId);
    deleteThreadActivityNotesByThreadId(this.db, localThreadId);
    deleteThreadGoalRecordsByThreadId(this.db, localThreadId);
    deleteThreadHistoryItemRecordsByThreadId(this.db, localThreadId);
    deleteThreadPendingSteerRecordsByThreadId(this.db, localThreadId);
    deleteThreadTurnMetadataByThreadId(this.db, localThreadId);
    deleteThreadRecord(this.db, localThreadId);

    return { id: localThreadId };
  }
}
