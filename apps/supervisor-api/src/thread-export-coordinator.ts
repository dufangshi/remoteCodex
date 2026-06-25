import {
  getThreadRecordById,
  getWorkspaceRecordById,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import type {
  ExportThreadPdfInput,
  ThreadDto,
  ThreadExportTurnOptionsDto,
  ThreadTurnDto,
} from '../../../packages/shared/src/index';
import { toWorkspaceDto } from './dto';
import { HttpError } from './app';
import {
  renderThreadExportPdf,
  renderThreadExportStandaloneHtml,
} from './exports/thread-pdf-export';
import {
  ThreadDetailAssembler,
} from './thread-detail-assembler';
import { listThreadTurnMetadataMap } from './thread-turn-metadata';

function userPromptPreviewFromTurn(turn: ThreadTurnDto) {
  const prompt = turn.items.find((item) => item.kind === 'userMessage')?.text.trim();
  if (!prompt) {
    return 'No user prompt captured';
  }

  const singleLine = prompt.replace(/\s+/g, ' ').trim();
  return singleLine.length > 96 ? `${singleLine.slice(0, 95).trimEnd()}...` : singleLine;
}

function defaultExportOptions(input: ExportThreadPdfInput) {
  return {
    includeTokenAndPrice: input.options?.includeTokenAndPrice ?? true,
    includeCommandOutput: input.options?.includeCommandOutput ?? false,
    includeAbsolutePaths: input.options?.includeAbsolutePaths ?? false,
  };
}

function safeTranscriptExportFileName(title: string, extension: 'pdf' | 'html') {
  const stem = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `remote-codex-${stem || 'thread'}-${timestamp}.${extension}`;
}

interface ThreadExportCallbacks {
  requireProviderSessionId(record: { providerSessionId?: string | null }): string;
  toThreadDto(record: unknown, loadedIds: Set<string>): ThreadDto;
}

export class ThreadExportCoordinator {
  constructor(
    private readonly db: DatabaseClient,
    private readonly detailAssembler: ThreadDetailAssembler,
    private readonly callbacks: ThreadExportCallbacks,
  ) {}

  async listThreadExportTurns(localThreadId: string): Promise<ThreadExportTurnOptionsDto> {
    const { turns } = await this.getThreadExportBase(localThreadId);
    return {
      totalTurnCount: turns.length,
      turns: turns.map((turn, index) => ({
        turnId: turn.id,
        turnNumber: index + 1,
        startedAt: turn.startedAt,
        status: turn.status,
        userPromptPreview: userPromptPreviewFromTurn(turn),
      })).reverse(),
    };
  }

  async exportThreadPdf(
    localThreadId: string,
    input: ExportThreadPdfInput,
  ): Promise<{ buffer: Buffer; filename: string }> {
    return this.exportThreadTranscript(localThreadId, {
      ...input,
      format: 'pdf',
    });
  }

  async exportThreadTranscript(
    localThreadId: string,
    input: ExportThreadPdfInput,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const { record, workspace, turns } = await this.getThreadExportBase(localThreadId);
    const totalTurnCount = turns.length;
    const selectedTurnNumbers = new Map(
      turns.map((turn, index) => [turn.id, index + 1] as const),
    );
    const selectedTurns = this.selectTurnsForExport(turns, input);
    const snapshot = {
      thread: this.callbacks.toThreadDto(
        record,
        new Set(record.providerSessionId ? [record.providerSessionId] : []),
      ),
      workspace: toWorkspaceDto(workspace),
      exportedAt: new Date().toISOString(),
      totalTurnCount,
      selectedTurnNumbers,
      turns: selectedTurns,
      profile: input.profile ?? 'review',
      options: defaultExportOptions(input),
    };
    const format = input.format ?? 'pdf';
    const buffer = format === 'html'
      ? Buffer.from(renderThreadExportStandaloneHtml(snapshot), 'utf8')
      : await renderThreadExportPdf(snapshot);

    return {
      buffer,
      filename: safeTranscriptExportFileName(record.title, format),
      contentType: format === 'html' ? 'text/html; charset=utf-8' : 'application/pdf',
    };
  }

  private async getThreadExportBase(localThreadId: string) {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    this.callbacks.requireProviderSessionId(record);

    const turnMetadataById = listThreadTurnMetadataMap(this.db, localThreadId);
    const cachedDetail = await this.detailAssembler.buildCacheEntry({
      localThreadId,
      record,
      turnMetadataById,
    });
    const updated = getThreadRecordById(this.db, record.id)!;
    return {
      record: updated,
      workspace,
      turns: cachedDetail.turns,
    };
  }

  private selectTurnsForExport(turns: ThreadTurnDto[], input: ExportThreadPdfInput) {
    if (input.mode === 'selected') {
      const requestedIds = [...new Set(input.turnIds ?? [])];
      if (requestedIds.length === 0) {
        throw new HttpError(400, {
          code: 'bad_request',
          message: 'Select at least one turn to export.',
        });
      }
      if (requestedIds.length > 100) {
        throw new HttpError(400, {
          code: 'bad_request',
          message: 'A PDF export can include at most 100 turns.',
        });
      }

      const requested = new Set(requestedIds);
      const matched = turns.filter((turn) => requested.has(turn.id));
      if (matched.length !== requested.size) {
        const matchedIds = new Set(matched.map((turn) => turn.id));
        const missing = requestedIds.filter((turnId) => !matchedIds.has(turnId));
        throw new HttpError(400, {
          code: 'bad_request',
          message: `Some selected turns were not found: ${missing.join(', ')}`,
        });
      }

      return matched;
    }

    const limit = Math.max(1, Math.min(input.limit ?? 10, 100));
    return turns.slice(Math.max(0, turns.length - limit));
  }
}
