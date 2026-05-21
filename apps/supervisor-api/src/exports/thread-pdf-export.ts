import fs from 'node:fs';

import puppeteer, { LaunchOptions } from 'puppeteer-core';
import { marked } from 'marked';

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
const EXPORT_FONT_FAMILY =
  '"Segoe UI", "RemoteCodexCJK", "Microsoft YaHei", "DengXian", "SimSun", "Noto Sans CJK SC", "Noto Sans CJK", "DejaVu Sans", Arial, sans-serif';
const EXPORT_MONO_FONT_FAMILY =
  '"SFMono-Regular", Consolas, "Liberation Mono", "DejaVu Sans Mono", "RemoteCodexCJK", monospace';
const EMBEDDED_CJK_FONT_CANDIDATES = [
  { path: '/mnt/c/Windows/Fonts/simhei.ttf', format: 'truetype', weight: 400 },
  { path: '/mnt/c/Windows/Fonts/Deng.ttf', format: 'truetype', weight: 400 },
  { path: '/mnt/c/Windows/Fonts/msyh.ttc', format: 'truetype', weight: 400 },
];
const PUPPETEER_CHANNEL = 'chrome';
let embeddedCjkFontCss: string | null = null;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

marked.use({
  async: false,
  breaks: true,
  gfm: true,
});

function renderEmbeddedCjkFontCss() {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return '';
  }

  if (embeddedCjkFontCss !== null) {
    return embeddedCjkFontCss;
  }

  embeddedCjkFontCss = '';
  for (const candidate of EMBEDDED_CJK_FONT_CANDIDATES) {
    try {
      if (!fs.existsSync(candidate.path)) {
        continue;
      }

      const font = fs.readFileSync(candidate.path);
      embeddedCjkFontCss = `
      @font-face {
        font-family: "RemoteCodexCJK";
        src: url("data:font/${candidate.format};base64,${font.toString('base64')}") format("${candidate.format}");
        font-style: normal;
        font-weight: ${candidate.weight};
      }`;
      break;
    } catch {
      embeddedCjkFontCss = '';
    }
  }

  return embeddedCjkFontCss;
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

function renderPlainText(value: string) {
  return `<p>${escapeHtml(truncateText(value, MAX_TEXT_CHARS))}</p>`;
}

function renderMarkdownText(value: string) {
  const text = truncateText(value, MAX_TEXT_CHARS);
  try {
    return marked.parse(text) as string;
  } catch {
    return renderPlainText(text);
  }
}

function isTranscriptMessage(item: ThreadHistoryItemDto) {
  return item.kind === 'userMessage' || item.kind === 'agentMessage';
}

function renderHiddenEventSummary(turn: ThreadTurnDto, snapshot: ThreadPdfExportSnapshot) {
  if (snapshot.profile !== 'technical') {
    return '';
  }

  const counts = turn.items.reduce<Record<string, number>>((acc, item) => {
    if (isTranscriptMessage(item) || item.kind === 'reasoning') {
      return acc;
    }
    const label = historyItemLabel(item.kind);
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return '';
  }

  return `
    <div class="event-rollup">
      ${entries
        .map(([label, count]) => `<span>${escapeHtml(label)} x ${count}</span>`)
        .join('')}
    </div>
  `;
}

function renderMessageItem(item: ThreadHistoryItemDto) {
  const role = item.kind === 'userMessage' ? 'user' : 'agent';
  return `
    <section class="message message-${role}">
      <div class="message-label">${role === 'user' ? 'User' : 'Agent'}</div>
      <div class="message-body markdown-body">
        ${role === 'agent' ? renderMarkdownText(item.text) : renderPlainText(item.text)}
      </div>
    </section>
  `;
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
      return 'Agent';
    case 'plan':
      return 'Plan';
    case 'commandExecution':
      return 'Command';
    case 'webSearch':
      return 'Web search';
    case 'fileRead':
      return 'File read';
    case 'fileChange':
      return 'File changes';
    case 'agentToolCall':
      return 'Agent';
    case 'skillToolCall':
      return 'Skill';
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
  const text = item.detailText || item.text || 'Command';
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

function summarizeFileChange(item: ThreadHistoryItemDto) {
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
  const detail = item.detailText ?? item.text;
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

function renderPlan(text: string) {
  const lines = text
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

function renderGenericSummary(item: ThreadHistoryItemDto) {
  const text = item.previewText ?? item.text;
  const status = item.status ? `<span class="pill">${escapeHtml(item.status)}</span>` : '';
  return `
    <div class="event-summary">
      ${escapeHtml(truncateText(text, 600))}
      ${status}
    </div>
  `;
}

function summarizeCommandLine(item: ThreadHistoryItemDto) {
  return truncateText(summarizeInlineText(item.detailText || item.text || 'Command'), 260);
}

function summarizeInlineText(value: string) {
  return (
    value
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? (value.trim() || 'Event')
  );
}

function renderHtmlEventItem(item: ThreadHistoryItemDto) {
  if (item.kind === 'commandExecution') {
    return `
      <details class="event event-command">
        <summary>
          <span class="event-kind">Command</span>
          <code>${escapeHtml(summarizeCommandLine(item))}</code>
          ${item.status ? `<span class="pill">${escapeHtml(item.status)}</span>` : ''}
        </summary>
        <p class="event-note">Raw command output is intentionally omitted from shared HTML exports.</p>
      </details>
    `;
  }

  if (item.kind === 'fileChange') {
    return `
      <details class="event event-file">
        <summary>
          <span class="event-kind">File changes</span>
          <span>${escapeHtml(summarizeInlineText(item.previewText ?? item.text))}</span>
        </summary>
        ${summarizeFileChange(item)}
      </details>
    `;
  }

  if (
    item.kind === 'webSearch' ||
    item.kind === 'fileRead' ||
    item.kind === 'agentToolCall' ||
    item.kind === 'skillToolCall' ||
    item.kind === 'toolCall'
  ) {
    return `
      <details class="event event-tool">
        <summary>
          <span class="event-kind">${escapeHtml(historyItemLabel(item.kind))}</span>
          <span>${escapeHtml(summarizeInlineText(item.previewText ?? item.text))}</span>
          ${item.status ? `<span class="pill">${escapeHtml(item.status)}</span>` : ''}
        </summary>
        <p>${escapeHtml(truncateText(item.previewText ?? item.text, 800))}</p>
      </details>
    `;
  }

  return '';
}

function renderHtmlHistoryEntries(items: ThreadHistoryItemDto[]) {
  const entries: string[] = [];
  let index = 0;

  while (index < items.length) {
    const current = items[index];
    if (!current) {
      break;
    }

    if (isTranscriptMessage(current)) {
      entries.push(renderMessageItem(current));
      index += 1;
      continue;
    }

    if (
      current.kind !== 'commandExecution' &&
      current.kind !== 'fileChange' &&
      current.kind !== 'webSearch' &&
      current.kind !== 'fileRead'
    ) {
      const rendered = renderHtmlEventItem(current);
      if (rendered) {
        entries.push(rendered);
      }
      index += 1;
      continue;
    }

    const groupedItems: ThreadHistoryItemDto[] = [];
    while (index < items.length && items[index]?.kind === current.kind) {
      groupedItems.push(items[index]!);
      index += 1;
    }

    if (groupedItems.length === 1) {
      const rendered = renderHtmlEventItem(groupedItems[0]!);
      if (rendered) {
        entries.push(rendered);
      }
      continue;
    }

    const label = current.kind === 'commandExecution'
      ? 'Command batch'
      : current.kind === 'fileChange'
        ? 'File change batch'
        : current.kind === 'fileRead'
          ? 'File read batch'
          : 'Web search batch';
    const detailItems = groupedItems
      .map((item, itemIndex) => {
        if (item.kind === 'commandExecution') {
          return `
            <li>
              <span class="event-index">Step ${itemIndex + 1}</span>
              <code>${escapeHtml(summarizeCommandLine(item))}</code>
              ${item.status ? `<span class="pill">${escapeHtml(item.status)}</span>` : ''}
            </li>
          `;
        }

        return `
          <li>
            <span class="event-index">${itemIndex + 1}</span>
            <span>${escapeHtml(summarizeInlineText(item.previewText ?? item.text))}</span>
          </li>
        `;
      })
      .join('');

    entries.push(`
      <details class="event event-batch">
        <summary>
          <span class="event-kind">${label}</span>
          <span>${groupedItems.length} entries</span>
        </summary>
        <ul class="event-list">${detailItems}</ul>
        ${current.kind === 'commandExecution' ? '<p class="event-note">Raw command output is intentionally omitted from shared HTML exports.</p>' : ''}
      </details>
    `);
  }

  return entries.join('');
}

function renderHistoryItem(item: ThreadHistoryItemDto, snapshot: ThreadPdfExportSnapshot) {
  if (item.kind === 'reasoning' && snapshot.profile !== 'technical') {
    return '';
  }

  if (item.kind === 'userMessage' || item.kind === 'agentMessage') {
    return renderMessageItem(item);
  }

  if (
    snapshot.profile === 'review' &&
    !isTranscriptMessage(item)
  ) {
    return '';
  }

  const label = historyItemLabel(item.kind);
  const body = (() => {
    if (item.kind === 'commandExecution') {
      return summarizeCommand(item, snapshot);
    }
    if (item.kind === 'fileChange') {
      return summarizeFileChange(item);
    }
    if (
      item.kind === 'toolCall' ||
      item.kind === 'agentToolCall' ||
      item.kind === 'skillToolCall' ||
      item.kind === 'webSearch' ||
      item.kind === 'fileRead' ||
      item.kind === 'image'
    ) {
      return renderGenericSummary(item);
    }
    if (item.kind === 'plan') {
      return renderPlan(item.text);
    }

    return renderPlainText(item.text);
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
      ${renderHiddenEventSummary(turn, snapshot)}
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
      ${renderEmbeddedCjkFontCss()}
      @page { margin: 0.46in 0.45in 0.5in; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: rgb(248 245 239);
        color: rgb(41 37 36);
        font-family: ${EXPORT_FONT_FAMILY};
        font-size: 13px;
        line-height: 1.55;
      }
      header.cover {
        border-bottom: 1px solid rgb(219 211 199);
        margin-bottom: 14px;
        padding-bottom: 13px;
      }
      .eyebrow {
        color: rgb(120 113 108);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 5px 0 8px;
        color: rgb(28 25 23);
        font-size: 24px;
        line-height: 1.1;
      }
      .cover-meta, .stats, .turn-header div {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .cover-meta span, .stats span, .turn-header span, .pill {
        border: 1px solid rgb(216 208 196);
        border-radius: 999px;
        color: rgb(87 83 78);
        padding: 3px 8px;
      }
      .stats {
        margin-top: 12px;
      }
      .notice {
        background: rgb(255 247 220);
        border: 1px solid rgb(234 210 138);
        border-radius: 8px;
        color: rgb(93 75 20);
        margin-top: 12px;
        padding: 8px 10px;
      }
      .turn {
        border-top: 1px solid rgb(222 214 203);
        padding: 14px 0 8px;
      }
      .turn-header {
        align-items: flex-start;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }
      h2 {
        color: rgb(41 37 36);
        font-size: 15px;
        margin: 0;
      }
      .message {
        border: 1px solid rgb(214 204 190);
        border-radius: 15px;
        box-shadow: 0 10px 22px rgb(87 83 78 / 0.06);
        margin: 7px 0;
        overflow: hidden;
        padding: 0;
      }
      .message-user {
        background: rgb(232 241 237);
      }
      .message-agent {
        background: rgb(247 243 236);
      }
      .message-label {
        border-bottom: 1px solid rgb(222 214 203);
        color: rgb(120 113 108);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.12em;
        padding: 5px 10px;
        text-transform: uppercase;
      }
      .message-user .message-label {
        background: rgb(223 235 230);
      }
      .message-agent .message-label {
        background: rgb(238 231 219);
      }
      .message-body {
        padding: 9px 11px;
      }
      .item {
        border: 1px solid rgb(221 212 199);
        border-radius: 8px;
        margin: 8px 0;
        overflow: hidden;
      }
      .item-label {
        background: rgb(238 231 219);
        border-bottom: 1px solid rgb(221 212 199);
        color: rgb(98 87 76);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.12em;
        padding: 5px 8px;
        text-transform: uppercase;
      }
      .item-body {
        background: rgb(251 248 242);
        padding: 8px 10px;
      }
      p {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .markdown-body > :first-child {
        margin-top: 0;
      }
      .markdown-body > :last-child {
        margin-bottom: 0;
      }
      .markdown-body p,
      .markdown-body ul,
      .markdown-body ol,
      .markdown-body blockquote,
      .markdown-body pre,
      .markdown-body table {
        margin-bottom: 0.72em;
      }
      .markdown-body h1,
      .markdown-body h2,
      .markdown-body h3 {
        color: rgb(41 37 36);
        font-weight: 700;
        line-height: 1.25;
        margin: 0.85em 0 0.35em;
      }
      .markdown-body h1 {
        font-size: 20px;
      }
      .markdown-body h2 {
        font-size: 17px;
      }
      .markdown-body h3 {
        font-size: 15px;
      }
      .markdown-body a {
        color: rgb(3 105 161);
        text-decoration: underline;
      }
      .markdown-body blockquote {
        border-left: 3px solid rgb(214 204 190);
        color: rgb(87 83 78);
        padding-left: 10px;
      }
      pre, code {
        font-family: ${EXPORT_MONO_FONT_FAMILY};
      }
      pre {
        background: rgb(38 33 28);
        border-radius: 7px;
        color: rgb(241 232 219);
        margin: 8px 0 0;
        overflow-wrap: anywhere;
        padding: 9px;
        white-space: pre-wrap;
      }
      code {
        background: rgb(232 224 211);
        border: 1px solid rgb(221 212 199);
        border-radius: 5px;
        color: rgb(68 64 60);
        padding: 0.08em 0.28em;
      }
      pre code {
        background: transparent;
        border: 0;
        color: inherit;
        padding: 0;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      ol {
        margin: 0;
        padding-left: 20px;
      }
      li {
        margin: 2px 0;
        overflow-wrap: anywhere;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th, td {
        border: 1px solid rgb(221 212 199);
        padding: 5px 6px;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: rgb(238 231 219);
      }
      .event-summary {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        overflow-wrap: anywhere;
      }
      .event-rollup {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 6px;
      }
      .event-rollup span {
        border: 1px solid rgb(221 212 199);
        border-radius: 999px;
        color: rgb(120 113 108);
        font-size: 10px;
        padding: 2px 6px;
      }
      .error {
        background: rgb(253 229 232);
        border: 1px solid rgb(239 183 191);
        border-radius: 8px;
        color: rgb(122 36 48);
        margin-bottom: 10px;
        padding: 8px;
      }
      footer {
        border-top: 1px solid rgb(216 208 196);
        color: rgb(120 113 108);
        font-size: 10px;
        margin-top: 20px;
        padding-top: 8px;
      }
    </style>
  </head>
  <body>
    <header class="cover">
      <div class="eyebrow">Agent Transcript</div>
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
      <div class="notice">Review copy: user and agent message bubbles are exported with Markdown formatting. Tool calls, plans, goals, and command/file events are omitted unless using the technical profile.</div>
      ${running ? `<div class="notice">Exported while turn ${snapshot.selectedTurnNumbers.get(running.id) ?? ''} was still running.</div>` : ''}
    </header>
    ${snapshot.turns.map((turn) => renderTurn(turn, snapshot)).join('')}
    <footer>${escapeHtml(snapshot.thread.title)} · ${escapeHtml(formatDateTime(snapshot.exportedAt))}</footer>
  </body>
</html>`;
}

export function renderThreadExportStandaloneHtml(snapshot: ThreadPdfExportSnapshot) {
  const turnNumbers = snapshot.turns
    .map((turn) => snapshot.selectedTurnNumbers.get(turn.id))
    .filter((value): value is number => typeof value === 'number');
  const sortedTurnNumbers = [...turnNumbers].sort((left, right) => left - right);
  const rangeLabel =
    sortedTurnNumbers.length === 0
      ? 'No turns'
      : sortedTurnNumbers.length === 1
        ? `Turn ${sortedTurnNumbers[0]}`
        : `Turns ${sortedTurnNumbers[0]}-${sortedTurnNumbers[sortedTurnNumbers.length - 1]}`;
  const tokenCount = totalTokens(snapshot);
  const price = totalPrice(snapshot);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(snapshot.thread.title)} transcript</title>
    <style>
      ${renderEmbeddedCjkFontCss()}
      :root {
        color-scheme: light;
        --page: rgb(244 239 231);
        --panel: rgb(239 232 221);
        --surface: rgb(248 245 239);
        --surface-strong: rgb(252 249 244);
        --border: rgb(214 204 190);
        --border-soft: rgb(228 220 208);
        --text: rgb(41 37 36);
        --muted: rgb(120 113 108);
        --chip: rgb(238 231 219);
        --user-bg: rgb(218 237 229);
        --user-border: rgb(132 190 176);
        --user-label: rgb(197 224 214);
        --agent-bg: rgb(250 245 236);
        --agent-border: rgb(216 199 174);
        --agent-label: rgb(239 229 213);
        --accent: rgb(146 96 18);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--page);
        color: var(--text);
        font-family: ${EXPORT_FONT_FAMILY};
        font-size: 14px;
        line-height: 1.55;
      }
      .share-shell {
        min-height: 100vh;
        padding: 22px clamp(14px, 3vw, 40px) 40px;
      }
      .transcript {
        max-width: 1060px;
        margin: 0 auto;
      }
      .cover {
        border: 1px solid var(--border);
        border-radius: 24px;
        background: var(--panel);
        padding: clamp(16px, 2.2vw, 24px);
        box-shadow: 0 18px 42px rgb(87 83 78 / 0.10);
      }
      .eyebrow {
        color: var(--muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      h1 {
        margin: 8px 0 12px;
        font-size: clamp(24px, 4vw, 36px);
        line-height: 1.08;
      }
      .meta, .stats, .turn-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }
      .meta span, .stats span, .turn-meta span, .pill {
        border: 1px solid var(--border);
        border-radius: 999px;
        background: rgb(252 249 244 / 0.68);
        color: rgb(87 83 78);
        padding: 4px 9px;
      }
      .stats { margin-top: 12px; }
      .notice {
        max-width: 78ch;
        color: rgb(93 75 20);
        margin-top: 14px;
      }
      .turn {
        margin-top: 18px;
        border: 1px solid var(--border);
        border-radius: 22px;
        background: var(--surface);
        overflow: hidden;
        box-shadow: 0 14px 34px rgb(87 83 78 / 0.08);
      }
      .turn-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        border-bottom: 1px solid var(--border-soft);
        background: rgb(238 231 219);
        padding: 12px 14px;
      }
      h2 {
        font-size: 15px;
        margin: 0;
      }
      .turn-body {
        padding: 12px;
      }
      .message {
        border: 1px solid var(--border);
        border-radius: 16px;
        margin: 10px 0;
        overflow: hidden;
        box-shadow: 0 8px 22px rgb(87 83 78 / 0.05);
      }
      .message-user {
        background: var(--user-bg);
        border-color: var(--user-border);
      }
      .message-agent {
        background: var(--agent-bg);
        border-color: var(--agent-border);
      }
      .message-label {
        border-bottom: 1px solid var(--border-soft);
        color: var(--muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.15em;
        padding: 6px 11px;
        text-transform: uppercase;
      }
      .message-user .message-label {
        background: var(--user-label);
        border-bottom-color: rgb(169 210 198);
        color: rgb(48 96 84);
      }
      .message-agent .message-label {
        background: var(--agent-label);
        border-bottom-color: rgb(222 207 184);
        color: rgb(108 86 55);
      }
      .message-body {
        padding: 12px 14px;
      }
      p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      .markdown-body > :first-child { margin-top: 0; }
      .markdown-body > :last-child { margin-bottom: 0; }
      .markdown-body p,
      .markdown-body ul,
      .markdown-body ol,
      .markdown-body blockquote,
      .markdown-body pre,
      .markdown-body table {
        margin-bottom: 0.78em;
      }
      .markdown-body h1,
      .markdown-body h2,
      .markdown-body h3 {
        line-height: 1.25;
        margin: 0.9em 0 0.35em;
      }
      .markdown-body h1 { font-size: 24px; }
      .markdown-body h2 { font-size: 20px; }
      .markdown-body h3 { font-size: 16px; }
      .markdown-body a {
        color: rgb(3 105 161);
        text-decoration: underline;
      }
      .markdown-body blockquote {
        border-left: 3px solid var(--border);
        color: rgb(87 83 78);
        padding-left: 12px;
      }
      pre, code {
        font-family: ${EXPORT_MONO_FONT_FAMILY};
      }
      pre {
        background: rgb(38 33 28);
        border-radius: 10px;
        color: rgb(241 232 219);
        overflow: auto;
        padding: 12px;
        white-space: pre-wrap;
      }
      code {
        background: rgb(232 224 211);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: rgb(68 64 60);
        padding: 0.08em 0.3em;
      }
      pre code {
        background: transparent;
        border: 0;
        color: inherit;
        padding: 0;
      }
      ul { padding-left: 20px; }
      ol { padding-left: 22px; }
      li { margin: 3px 0; overflow-wrap: anywhere; }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th, td {
        border: 1px solid var(--border);
        padding: 6px 7px;
        text-align: left;
        vertical-align: top;
      }
      th { background: var(--chip); }
      .event {
        border: 1px solid var(--border);
        border-radius: 14px;
        background: var(--surface-strong);
        margin: 10px 0;
        overflow: hidden;
      }
      .event summary {
        cursor: pointer;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        padding: 9px 11px;
      }
      .event-kind, .event-index {
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--chip);
        color: var(--muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        padding: 3px 7px;
        text-transform: uppercase;
      }
      .event p, .event .event-summary, .event ul {
        margin: 0;
        padding: 0 11px 10px;
      }
      .event-list {
        list-style: none;
      }
      .event-list li {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        border-top: 1px solid var(--border-soft);
        padding: 9px 0;
      }
      .event-note {
        color: var(--muted);
        font-size: 12px;
      }
      .error {
        background: rgb(253 229 232);
        border: 1px solid rgb(239 183 191);
        border-radius: 10px;
        color: rgb(122 36 48);
        margin: 10px 0;
        padding: 10px;
      }
      footer {
        color: var(--muted);
        margin: 22px auto 0;
        max-width: 1060px;
        font-size: 12px;
      }
      @media (max-width: 720px) {
        .share-shell { padding: 12px 10px 24px; }
        .cover, .turn { border-radius: 18px; }
        .turn-header { display: block; }
        .turn-meta { margin-top: 8px; }
      }
    </style>
  </head>
  <body>
    <main class="share-shell">
      <section class="transcript">
        <header class="cover">
          <div class="eyebrow">Agent Transcript</div>
          <h1>${escapeHtml(snapshot.thread.title)}</h1>
          <div class="meta">
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
          <p class="notice">Shared HTML contains the chat timeline only. Command batches can be expanded for summaries, but raw command output is not included.</p>
        </header>
        ${snapshot.turns.map((turn) => {
          const turnNumber = snapshot.selectedTurnNumbers.get(turn.id) ?? 0;
          const meta = [
            formatDateTime(turn.startedAt),
            turn.status,
            snapshot.options.includeTokenAndPrice ? turnTokenSummary(turn) : null,
            snapshot.options.includeTokenAndPrice ? turnPriceSummary(turn) : null,
          ].filter(Boolean);

          return `
            <article class="turn">
              <header class="turn-header">
                <h2>Turn ${turnNumber}</h2>
                <div class="turn-meta">${meta.map((entry) => `<span>${escapeHtml(String(entry))}</span>`).join('')}</div>
              </header>
              <div class="turn-body">
                ${turn.error ? `<p class="error">${escapeHtml(turn.error)}</p>` : ''}
                ${renderHtmlHistoryEntries(turn.items)}
              </div>
            </article>
          `;
        }).join('')}
      </section>
      <footer>${escapeHtml(snapshot.thread.title)} · ${escapeHtml(formatDateTime(snapshot.exportedAt))}</footer>
    </main>
  </body>
</html>`;
}

export async function renderThreadExportPdf(snapshot: ThreadPdfExportSnapshot) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return Buffer.from(
      `%PDF-1.4\n% Agent transcript test PDF\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%% ${snapshot.turns.length} turns\n%%EOF\n`,
    );
  }

  const browser = await launchPdfBrowser();

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

async function launchPdfBrowser() {
  const launchOptions: LaunchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else {
    launchOptions.channel = PUPPETEER_CHANNEL;
  }

  try {
    return await puppeteer.launch(launchOptions);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `PDF export requires a local Chrome installation. Install Google Chrome, or set PUPPETEER_EXECUTABLE_PATH to a Chromium-compatible browser executable. ${detail}`,
    );
  }
}
