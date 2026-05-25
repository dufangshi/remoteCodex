import { readFile, writeFile } from 'node:fs/promises';
import {
  evaluateAwsStagingPreflightEvidence,
  parseAwsStagingPreflightEvidence,
  type AwsPreflightCheckResult,
} from './verify-aws-staging-preflight-evidence.js';
import {
  evaluateStagingPhaseOneEvidence,
  parseStagingPhaseOneReport,
  type ChecklistResult,
} from './verify-staging-phase-one-evidence.js';

interface ChecklistItem {
  item: string;
  checked: boolean;
  title: string;
  line: number;
}

interface EvidenceResult {
  item: string;
  title: string;
  readyToCheck: boolean;
  reason: string;
  requiredEvidence: string[];
  matchedEvidence?: string[];
  matchedSteps?: string[];
  source: string;
}

interface BlockingGroup {
  id: string;
  items: string[];
  readyItems: string[];
  notReadyItems: string[];
  nextEvidenceCommand: string;
}

const phaseZeroSixPrefixes = ['D0', 'A1', 'P2', 'S3', 'W4', 'R5', 'G6'];

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a file path.`);
  }
  return value;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function readChecklist(path = 'docs/remote-codex-side-detailed-checklist.md') {
  return readFile(path, 'utf8');
}

function parseChecklistItems(markdown: string): ChecklistItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: ChecklistItem[] = [];
  const pattern = /^- \[(x| )\] ((?:D0|A1|P2|S3|W4|R5|G6)\.\d+) (.+)$/;
  lines.forEach((line, index) => {
    const match = line.match(pattern);
    if (!match) {
      return;
    }
    items.push({
      checked: match[1] === 'x',
      item: match[2] ?? '',
      title: match[3] ?? '',
      line: index + 1,
    });
  });
  return items;
}

function applyReadyItemsToChecklist(input: {
  markdown: string;
  readyItems: ChecklistItem[];
}) {
  const readyIds = new Set(input.readyItems.map((item) => item.item));
  let changedCount = 0;
  const updated = input.markdown.split(/\r?\n/).map((line) => {
    const match = line.match(/^(- )\[ \] ((?:D0|A1|P2|S3|W4|R5|G6)\.\d+ .+)$/);
    if (!match || !readyIds.has(match[2]?.split(' ')[0] ?? '')) {
      return line;
    }
    changedCount += 1;
    return `${match[1]}[x] ${match[2]}`;
  }).join('\n');
  return {
    markdown: updated,
    changedCount,
  };
}

function normalizeAwsResult(result: AwsPreflightCheckResult): EvidenceResult {
  return {
    ...result,
    source: 'aws_preflight',
  };
}

function normalizeStagingResult(result: ChecklistResult): EvidenceResult {
  return {
    ...result,
    source: 'staging_phase_one',
  };
}

function mergeEvidenceResults(results: EvidenceResult[]) {
  const byItem = new Map<string, EvidenceResult>();
  for (const result of results) {
    const existing = byItem.get(result.item);
    if (!existing || (!existing.readyToCheck && result.readyToCheck)) {
      byItem.set(result.item, result);
    }
  }
  return byItem;
}

async function optionalAwsResults(path: string | null) {
  if (!path) {
    return [];
  }
  const evidence = parseAwsStagingPreflightEvidence(await readFile(path, 'utf8'));
  return evaluateAwsStagingPreflightEvidence(evidence).map(normalizeAwsResult);
}

async function optionalStagingResults(path: string | null) {
  if (!path) {
    return [];
  }
  const report = parseStagingPhaseOneReport(await readFile(path, 'utf8'));
  return evaluateStagingPhaseOneEvidence(report)
    .filter((result) => result.item !== 'S3.04' && result.item !== 'S3.05')
    .map(normalizeStagingResult);
}

function checklistPrefix(item: string) {
  return phaseZeroSixPrefixes.find((prefix) => item.startsWith(`${prefix}.`)) ?? null;
}

function countsByPrefix(checklist: ChecklistItem[]) {
  return Object.fromEntries(phaseZeroSixPrefixes.map((prefix) => {
    const items = checklist.filter((item) => checklistPrefix(item.item) === prefix);
    return [prefix, {
      total: items.length,
      checked: items.filter((item) => item.checked).length,
      unchecked: items.filter((item) => !item.checked).length,
    }];
  }));
}

function buildBlockingGroups(input: {
  readyToCheck: Array<{ checklist: ChecklistItem }>;
  stillMissing: Array<{ checklist: ChecklistItem }>;
}): BlockingGroup[] {
  const readyIds = new Set(input.readyToCheck.map((entry) => entry.checklist.item));
  const missingIds = new Set(input.stillMissing.map((entry) => entry.checklist.item));
  const groups = [
    {
      id: 'aws-preflight',
      items: ['S3.04', 'S3.05'],
      nextEvidenceCommand: 'pnpm phase-zero-six:collect:aws',
    },
    {
      id: 'runtime-smoke',
      items: ['S3.06', 'S3.07', 'S3.08'],
      nextEvidenceCommand: 'pnpm phase-zero-six:collect',
    },
    {
      id: 'router-smoke',
      items: ['R5.10', 'R5.11', 'R5.12'],
      nextEvidenceCommand: 'pnpm phase-zero-six:collect',
    },
    {
      id: 'provider-smoke',
      items: ['G6.11', 'G6.12', 'G6.13'],
      nextEvidenceCommand: 'pnpm phase-zero-six:collect',
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      readyItems: group.items.filter((item) => readyIds.has(item)),
      notReadyItems: group.items.filter((item) => missingIds.has(item)),
    }))
    .filter((group) => group.notReadyItems.length > 0);
}

async function main() {
  const checklistPath = argValue('--checklist') ?? 'docs/remote-codex-side-detailed-checklist.md';
  const awsPath = argValue('--aws-preflight');
  const stagingPath = argValue('--staging-smoke');
  const applyReady = hasFlag('--apply-ready');
  const checklistMarkdown = await readChecklist(checklistPath);
  const checklist = parseChecklistItems(checklistMarkdown);
  const evidence = mergeEvidenceResults([
    ...(await optionalAwsResults(awsPath)),
    ...(await optionalStagingResults(stagingPath)),
  ]);

  const unchecked = checklist.filter((item) => !item.checked);
  const readyToCheck = unchecked
    .map((item) => ({ checklist: item, evidence: evidence.get(item.item) }))
    .filter((entry) => entry.evidence?.readyToCheck === true);
  const stillMissing = unchecked
    .map((item) => ({ checklist: item, evidence: evidence.get(item.item) }))
    .filter((entry) => entry.evidence?.readyToCheck !== true);
  const checkedButContradicted = checklist
    .filter((item) => item.checked)
    .map((item) => ({ checklist: item, evidence: evidence.get(item.item) }))
    .filter((entry) => entry.evidence && entry.evidence.readyToCheck === false);
  const blockingGroups = buildBlockingGroups({
    readyToCheck,
    stillMissing,
  });
  const originalCountsByPrefix = countsByPrefix(checklist);
  const canApply =
    applyReady &&
    readyToCheck.length > 0 &&
    checkedButContradicted.length === 0;
  let applyResult: null | {
    requested: boolean;
    applied: boolean;
    changedCount: number;
    appliedItems?: string[];
    reason: string;
  } = null;
  if (applyReady) {
    if (!canApply) {
      applyResult = {
        requested: true,
        applied: false,
        changedCount: 0,
        reason: readyToCheck.length === 0
          ? 'Refusing to edit checklist because no ready Phase 0-6 boxes were found.'
          : 'Refusing to edit checklist because checked boxes are contradicted.',
      };
      process.exitCode = 1;
    } else {
      const updated = applyReadyItemsToChecklist({
        markdown: checklistMarkdown,
        readyItems: readyToCheck.map((entry) => entry.checklist),
      });
      await writeFile(checklistPath, updated.markdown);
      applyResult = {
        requested: true,
        applied: true,
        changedCount: updated.changedCount,
        appliedItems: readyToCheck.map((entry) => entry.checklist.item),
        reason: stillMissing.length === 0
          ? 'Applied all ready Phase 0-6 checklist boxes; no Phase 0-6 evidence gaps remain.'
          : 'Applied ready Phase 0-6 checklist boxes; some Phase 0-6 boxes still need evidence.',
      };
    }
  }

  console.log(JSON.stringify({
    ok: stillMissing.length === 0 && checkedButContradicted.length === 0,
    generatedAt: new Date().toISOString(),
    checklistPath,
    evidenceInputs: {
      awsPreflight: awsPath,
      stagingSmoke: stagingPath,
    },
    apply: applyResult ?? {
      requested: false,
      applied: false,
      changedCount: 0,
      reason: 'Read-only audit. Pass --apply-ready to update checklist boxes after evidence is complete.',
    },
    countsByPrefix: originalCountsByPrefix,
    updatedCountsByPrefix: applyResult?.applied
      ? countsByPrefix(parseChecklistItems(await readChecklist(checklistPath)))
      : null,
    checkedCount: checklist.filter((item) => item.checked).length,
    uncheckedCount: unchecked.length,
    readyToCheck: readyToCheck.map((entry) => ({
      item: entry.checklist.item,
      title: entry.checklist.title,
      line: entry.checklist.line,
      source: entry.evidence?.source,
      reason: entry.evidence?.reason,
    })),
    stillMissing: stillMissing.map((entry) => ({
      item: entry.checklist.item,
      title: entry.checklist.title,
      line: entry.checklist.line,
      reason: entry.evidence?.reason ?? 'No matching evidence result was provided.',
      requiredEvidence: entry.evidence?.requiredEvidence ?? [
        'Provide AWS preflight evidence with --aws-preflight, staging smoke evidence with --staging-smoke, or complete the local checklist item with its documented verification.',
      ],
    })),
    blockingGroups,
    checkedButContradicted: checkedButContradicted.map((entry) => ({
      item: entry.checklist.item,
      title: entry.checklist.title,
      line: entry.checklist.line,
      source: entry.evidence?.source,
      reason: entry.evidence?.reason,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
