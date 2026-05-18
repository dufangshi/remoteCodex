import puppeteer from 'puppeteer';

import {
  ExportThreadPdfInput,
  ThreadDetailDto,
  ThreadHistoryItemDto,
  ThreadTurnDto,
} from '../../../../packages/shared/src/index';

export interface ThreadPdfExportSnapshot {
  thread: ThreadDetailDto['thread'];
  workspace: ThreadDetailDto['workspace'];
  exportedAt: string;
  totalTurnCount: number;
  selectedTurnNumbers: Map<string, number>;
  turns: ThreadTurnDto[];
  options: Required<NonNullable<ExportThreadPdfInput['options']>>;
  profile: NonNullable<ExportThreadPdfInput['profile']>;
}

const MAX_TEXT_CHARS = 12_000;
const MAX_COMMAND_OUTPUT_CHARS = 2_400;
const MAX_DETAIL_LINES = 8;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Unknown time';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function redactSensitiveText(
  value: string,
  workspacePath: string,
  includeAbsolutePaths: boolean,
) {
  let next = value;
  if (!includeAbsolutePaths && workspacePath) {
    next = next.split(workspacePath).join('{workspace}');
  }

  next = next.replace(
    /([^\s"'`]*?(?:\.env|auth\.json|id_rsa|id_ed25519|\.pem|\.key)[^\s"'`]*)/gi,
    '[redacted sensitive path]',
  );

  return next;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatUsd(value: number) {
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }

  return `$${value.toFixed(2)}`;
}

function historyItemLabel(kind: ThreadHistoryItemDto['kind']) {
  switch (kind) {
    case 'userMessage':
      return 'User';
    case 'agentMessage':
      return 'Codex';
    case 'plan':
      return 'Plan';
    case 'commandExecution':
      return 'Command';
    case 'webSearch':
      return 'Web search';
    case 'fileChange':
      return 'File changes';
    case 'toolCall':
      return 'Tool call';
    case 'contextCompaction':
      return 'Context';
    case 'image':
      return 'Image';
    case 'reasoning':
      return 'Reasoning';
    default:
      return 'Event';
  }
}

function summarizeCommand(item: ThreadHistoryItemDto, snapshot: ThreadPdfExportSnapshot) {
  const text = redactSensitiveText(
    item.detailText || item.text || 'Command',
    snapshot.workspace.absPath,
    snapshot.options.includeAbsolutePaths,
  );
  const lines = text.split('\n').filter((line) => line.trim());
  const command = lines[0] ?? 'Command';
  const output = lines.slice(1).join('\n').trim();
  const status = item.status ? `<span class="pill">${escapeHtml(item.status)}</span>` : '';

  if (!snapshot.options.includeCommandOutput || !output) {
    return `
      <div class="event-summary">
        <code>${escapeHtml(truncateText(command, 260))}</code>
        ${status}
      </div>
    `;
  }

  return `
    <div class="event-summary">
      <code>${escapeHtml(truncateText(command, 260))}</code>
      ${status}
    </div>
    <pre>${escapeHtml(truncateText(output, MAX_COMMAND_OUTPUT_CHARS))}</pre>
  `;
}

function summarizeFileChange(item: ThreadHistoryItemDto, snapshot: ThreadPdfExportSnapshot) {
  const changedFiles = item.changedFiles ?? null;
  const additions = item.addedLines ?? 0;
  const removals = item.removedLines ?? 0;
  const summary = [
    changedFiles !== null
      ? `${changedFiles} ${changedFiles === 1 ? 'file' : 'files'} changed`
      : item.previewText ?? 'File changes',
    additions > 0 ? `+${additions}` : null,
    removals > 0 ? `-${removals}` : null,
  ].filter(Boolean).join(' · ');
  const detail = redactSensitiveText(
    item.detailText ?? item.text,
    snapshot.workspace.absPath,
    snapshot.options.includeAbsolutePaths,
  );
  const fileLines = detail
    .split('\n')
    .filter((line) => line.trim().startsWith('- '))
    .slice(0, MAX_DETAIL_LINES);
  const extraCount = Math.max(
    0,
    detail.split('\n').filter((line) => line.trim().startsWith('- ')).length - fileLines.length,
  );

  return `
    <div class="event-summary">${escapeHtml(summary)}</div>
    ${
      fileLines.length > 0
        ? `<ul>${fileLines.map((line) => `<li>${escapeHtml(line.replace(/^-\s*/, ''))}</li>`).join('')}${extraCount > 0 ? `<li>+${extraCount} more</li>` : ''}</ul>`
        : ''
    }
  `;
}

function renderPlan(text: string, snapshot: ThreadPdfExportSnapshot) {
  const lines = redactSensitiveText(
    text,
    snapshot.workspace.absPath,
    snapshot.options.includeAbsolutePaths,
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return '<p>Plan update</p>';
  }

  return `<ul>${lines
    .slice(0, 20)
    .map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s*/, ''))}</li>`)
    .join('')}</ul>`;
}

function renderGenericSummary(item: ThreadHistoryItemDto, snapshot: ThreadPdfExportSnapshot) {
  const text = redactSensitiveText(
    item.previewText ?? item.text,
    snapshot.workspace.absPath,
    snapshot.options.includeAbsolutePaths,
  );
  const status = item.status ? `<span class="pill">${escapeHtml(item.status)}</span>` : '';
  return `
    <div class="event-summary">
      ${escapeHtml(truncateText(text, 600))}
      ${status}
    </div>
  `;
}

function renderHistoryItem(item: ThreadHistoryItemDto, snapshot: ThreadPdfExportSnapshot) {
  if (item.kind === 'reasoning' && snapshot.profile !== 'technical') {
    return '';
  }

  const label = historyItemLabel(item.kind);
  const body = (() => {
    if (item.kind === 'commandExecution') {
      return summarizeCommand(item, snapshot);
    }
    if (item.kind === 'fileChange') {
      return summarizeFileChange(item, snapshot);
    }
    if (item.kind === 'toolCall' || item.kind === 'webSearch' || item.kind === 'image') {
      return renderGenericSummary(item, snapshot);
    }
    if (item.kind === 'plan') {
      return renderPlan(item.text, snapshot);
    }

    const text = redactSensitiveText(
      item.text,
      snapshot.workspace.absPath,
      snapshot.options.includeAbsolutePaths,
    );
    return `<p>${escapeHtml(truncateText(text, MAX_TEXT_CHARS))}</p>`;
  })();

  if (!body.trim()) {
    return '';
  }

  return `
    <section class="item item-${item.kind}">
      <div class="item-label">${escapeHtml(label)}</div>
      <div class="item-body">${body}</div>
    </section>
  `;
}

function turnTokenSummary(turn: ThreadTurnDto) {
  if (!turn.tokenUsage) {
    return null;
  }

  return `${compactNumber(turn.tokenUsage.total.totalTokens)} tokens`;
}

function turnPriceSummary(turn: ThreadTurnDto) {
  if (!turn.priceEstimate) {
    return null;
  }

  return formatUsd(turn.priceEstimate.totalUsd);
}

function renderTurn(turn: ThreadTurnDto, snapshot: ThreadPdfExportSnapshot) {
  const turnNumber = snapshot.selectedTurnNumbers.get(turn.id) ?? 0;
  const meta = [
    `Turn ${turnNumber}`,
    formatDateTime(turn.startedAt),
    turn.status,
    snapshot.options.includeTokenAndPrice ? turnTokenSummary(turn) : null,
    snapshot.options.includeTokenAndPrice ? turnPriceSummary(turn) : null,
  ].filter(Boolean);

  return `
    <article class="turn">
      <header class="turn-header">
        <h2>Turn ${turnNumber}</h2>
        <div>${meta.map((entry) => `<span>${escapeHtml(String(entry))}</span>`).join('')}</div>
      </header>
      ${turn.error ? `<p class="error">${escapeHtml(turn.error)}</p>` : ''}
      ${turn.items.map((item) => renderHistoryItem(item, snapshot)).join('')}
    </article>
  `;
}

function totalTokens(snapshot: ThreadPdfExportSnapshot) {
  return snapshot.turns.reduce(
    (sum, turn) => sum + (turn.tokenUsage?.total.totalTokens ?? 0),
    0,
  );
}

function totalPrice(snapshot: ThreadPdfExportSnapshot) {
  return snapshot.turns.reduce(
    (sum, turn) => sum + (turn.priceEstimate?.totalUsd ?? 0),
    0,
  );
}

export function renderThreadExportHtml(snapshot: ThreadPdfExportSnapshot) {
  const turnNumbers = snapshot.turns
    .map((turn) => snapshot.selectedTurnNumbers.get(turn.id))
    .filter((value): value is number => typeof value === 'number');
  const sortedTurnNumbers = [...turnNumbers].sort((left, right) => left - right);
  const isContiguous =
    sortedTurnNumbers.length > 1 &&
    sortedTurnNumbers.every((value, index) => index === 0 || value === sortedTurnNumbers[index - 1]! + 1);
  const rangeLabel =
    sortedTurnNumbers.length === 0
      ? 'No turns'
      : sortedTurnNumbers.length === 1
        ? `Turn ${sortedTurnNumbers[0]}`
        : isContiguous
          ? `Turns ${sortedTurnNumbers[0]}-${sortedTurnNumbers[sortedTurnNumbers.length - 1]}`
          : `Turns ${sortedTurnNumbers.join(', ')}`;
  const running = snapshot.turns.find((turn) => turn.status === 'inProgress');
  const tokenCount = totalTokens(snapshot);
  const price = totalPrice(snapshot);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(snapshot.thread.title)} transcript</title>
    <style>
      @page { margin: 0.56in 0.5in 0.62in; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #f7f3ec;
        color: #24211d;
        font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
        font-size: 12px;
        line-height: 1.45;
      }
      header.cover {
        border-bottom: 1px solid #d8d0c4;
        margin-bottom: 18px;
        padding-bottom: 16px;
      }
      .eyebrow {
        color: #776b5f;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      h1 {
        margin: 5px 0 8px;
        color: #1f1b16;
        font-size: 26px;
        line-height: 1.1;
      }
      .cover-meta, .stats, .turn-header div {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .cover-meta span, .stats span, .turn-header span, .pill {
        border: 1px solid #d8d0c4;
        border-radius: 999px;
        color: #51483f;
        padding: 3px 7px;
      }
      .stats {
        margin-top: 12px;
      }
      .notice {
        background: #fff7dc;
        border: 1px solid #ead28a;
        border-radius: 8px;
        color: #5d4b14;
        margin-top: 12px;
        padding: 8px 10px;
      }
      .turn {
        break-inside: avoid;
        border-top: 1px solid #ded6cb;
        padding: 16px 0 10px;
      }
      .turn-header {
        align-items: flex-start;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      h2 {
        color: #28221c;
        font-size: 15px;
        margin: 0;
      }
      .item {
        border: 1px solid #ddd4c7;
        border-radius: 8px;
        margin: 8px 0;
        overflow: hidden;
      }
      .item-label {
        background: #eee7db;
        border-bottom: 1px solid #ddd4c7;
        color: #62574c;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.14em;
        padding: 5px 8px;
        text-transform: uppercase;
      }
      .item-body {
        background: #fbf8f2;
        padding: 8px 10px;
      }
      p {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      pre, code {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      }
      pre {
        background: #26211c;
        border-radius: 7px;
        color: #f1e8db;
        margin: 8px 0 0;
        overflow-wrap: anywhere;
        padding: 9px;
        white-space: pre-wrap;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      li {
        margin: 2px 0;
        overflow-wrap: anywhere;
      }
      .event-summary {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        overflow-wrap: anywhere;
      }
      .error {
        background: #fde5e8;
        border: 1px solid #efb7bf;
        border-radius: 8px;
        color: #7a2430;
        margin-bottom: 10px;
        padding: 8px;
      }
      footer {
        border-top: 1px solid #d8d0c4;
        color: #776b5f;
        font-size: 10px;
        margin-top: 20px;
        padding-top: 8px;
      }
    </style>
  </head>
  <body>
    <header class="cover">
      <div class="eyebrow">Remote Codex Transcript</div>
      <h1>${escapeHtml(snapshot.thread.title)}</h1>
      <div class="cover-meta">
        <span>${escapeHtml(snapshot.workspace.label)}</span>
        <span>${escapeHtml(rangeLabel)} of ${snapshot.totalTurnCount}</span>
        <span>Exported ${escapeHtml(formatDateTime(snapshot.exportedAt))}</span>
        ${snapshot.thread.model ? `<span>${escapeHtml(snapshot.thread.model)}</span>` : ''}
      </div>
      <div class="stats">
        <span>${snapshot.turns.length} ${snapshot.turns.length === 1 ? 'turn' : 'turns'} exported</span>
        ${snapshot.options.includeTokenAndPrice && tokenCount > 0 ? `<span>${escapeHtml(compactNumber(tokenCount))} tokens</span>` : ''}
        ${snapshot.options.includeTokenAndPrice && price > 0 ? `<span>${escapeHtml(formatUsd(price))} estimated</span>` : ''}
      </div>
      <div class="notice">Review copy: command batches, tool calls, and file changes are summarized by default. Absolute paths and sensitive filenames are redacted unless explicitly included.</div>
      ${running ? `<div class="notice">Exported while turn ${snapshot.selectedTurnNumbers.get(running.id) ?? ''} was still running.</div>` : ''}
    </header>
    ${snapshot.turns.map((turn) => renderTurn(turn, snapshot)).join('')}
    <footer>${escapeHtml(snapshot.thread.title)} · ${escapeHtml(formatDateTime(snapshot.exportedAt))}</footer>
  </body>
</html>`;
}

export async function renderThreadExportPdf(snapshot: ThreadPdfExportSnapshot) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return Buffer.from(
      `%PDF-1.4\n% Remote Codex test PDF\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%% ${snapshot.turns.length} turns\n%%EOF\n`,
    );
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(renderThreadExportHtml(snapshot), {
      waitUntil: 'load',
    });
    return Buffer.from(
      await page.pdf({
        format: 'Letter',
        printBackground: true,
        preferCSSPageSize: true,
      }),
    );
  } finally {
    await browser.close();
  }
}
