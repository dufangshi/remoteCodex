import {
  listThreadTurnMetadataByThreadId,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import { normalizePricingTier } from './thread-usage-accounting';
import type { ThreadTurnMetadataRecord } from './thread-detail-assembler';

export function listThreadTurnMetadataMap(
  db: DatabaseClient,
  localThreadId: string,
) {
  return new Map<string, ThreadTurnMetadataRecord>(
    listThreadTurnMetadataByThreadId(db, localThreadId).map((entry) => [
      entry.turnId,
      {
        model: entry.model ?? null,
        reasoningEffort: entry.reasoningEffort ?? null,
        reasoningEffortAvailable: entry.reasoningEffortAvailable ?? null,
        pricingModelKey: entry.pricingModelKey ?? null,
        pricingTierKey: normalizePricingTier(entry.pricingTierKey),
        tokenUsageJson: entry.tokenUsageJson ?? null,
        createdAt: entry.createdAt ?? null,
      },
    ]),
  );
}
