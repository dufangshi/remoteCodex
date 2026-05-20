import type { ThreadHistoryItemDto } from '../../shared/src/index';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function textFromUnknown(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() ? value : null;
  }

  if (Array.isArray(value)) {
    const parts: string[] = value
      .map((entry) => textFromUnknown(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join(' ') : null;
  }

  return null;
}

export function codexHookEventLabel(value: string) {
  switch (value) {
    case 'preToolUse':
      return 'PreToolUse';
    case 'permissionRequest':
      return 'PermissionRequest';
    case 'postToolUse':
      return 'PostToolUse';
    case 'preCompact':
      return 'PreCompact';
    case 'postCompact':
      return 'PostCompact';
    case 'sessionStart':
      return 'SessionStart';
    case 'userPromptSubmit':
      return 'UserPromptSubmit';
    case 'stop':
      return 'Stop';
    default:
      return value;
  }
}

function codexHookStatusLabel(value: string) {
  switch (value) {
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'blocked':
      return 'Blocked';
    case 'stopped':
      return 'Stopped';
    default:
      return value;
  }
}

function hookRunOutputEntryText(entry: unknown) {
  if (!isRecord(entry)) {
    return textFromUnknown(entry);
  }

  return (
    textFromUnknown(entry.text) ??
    textFromUnknown(entry.message) ??
    textFromUnknown(entry.systemMessage) ??
    textFromUnknown(entry.stopReason) ??
    textFromUnknown(entry.reason) ??
    textFromUnknown(entry.output) ??
    textFromUnknown(entry.stdout) ??
    textFromUnknown(entry.stderr)
  );
}

function normalizeHookRunOutputEntries(run: {
  entries?: Array<{ kind?: string; text?: string }>;
  outputEntries?: Array<{ kind?: string; text?: string }>;
  output_entries?: Array<{ kind?: string; text?: string }>;
  stdout?: unknown;
  stderr?: unknown;
  output?: unknown;
  text?: unknown;
  systemMessage?: unknown;
  stopReason?: unknown;
  reason?: unknown;
}): Array<{ kind: string; text: string }> {
  const rawEntries = Array.isArray(run.entries)
    ? run.entries
    : Array.isArray(run.outputEntries)
      ? run.outputEntries
      : Array.isArray(run.output_entries)
        ? run.output_entries
        : [];
  const entries = rawEntries
    .map((entry) => {
      const text = hookRunOutputEntryText(entry)?.trim();
      if (!text) {
        return null;
      }

      return {
        kind: typeof entry.kind === 'string' && entry.kind.trim() ? entry.kind : 'context',
        text,
      };
    })
    .filter((entry): entry is { kind: string; text: string } => Boolean(entry));
  const seenTexts = new Set(entries.map((entry) => entry.text));

  for (const [kind, value] of [
    ['context', run.output],
    ['context', run.text],
    ['warning', run.systemMessage],
    ['warning', run.stopReason],
    ['warning', run.reason],
    ['context', run.stdout],
    ['warning', run.stderr],
  ] as const) {
    const text = textFromUnknown(value)?.trim();
    if (text && !seenTexts.has(text)) {
      entries.push({ kind, text });
      seenTexts.add(text);
    }
  }

  return entries;
}

export function parseCodexHookPromptText(text: string) {
  const match = text
    .trim()
    .match(/^<hook_prompt(?:\s+hook_run_id="([^"]+)")?>([\s\S]*)<\/hook_prompt>$/);
  if (!match) {
    return null;
  }

  const hookRunId = match[1] ? decodeXmlEntities(match[1]) : null;
  const output = decodeXmlEntities(match[2] ?? '').trim();
  const eventName = hookRunId?.split(':')[0] ?? 'hook';
  const eventLabel = codexHookEventLabel(eventName);
  const sourcePath = hookRunId?.split(':').slice(2).join(':') || null;
  const outputEntries = output ? [{ kind: 'warning', text: output }] : [];

  return {
    hookRunId,
    output,
    outputEntries,
    eventName,
    eventLabel,
    sourcePath,
  };
}

export function codexHookRunToHistoryItem(run: {
  id: string;
  eventName: string;
  handlerType: string;
  executionMode: string;
  scope: string;
  sourcePath: string;
  source: string;
  status: string;
  statusMessage: string | null;
  durationMs: number | null;
  entries?: Array<{ kind: string; text: string }>;
  outputEntries?: Array<{ kind?: string; text?: string }>;
  output_entries?: Array<{ kind?: string; text?: string }>;
  stdout?: unknown;
  stderr?: unknown;
  output?: unknown;
  text?: unknown;
  systemMessage?: unknown;
  stopReason?: unknown;
  reason?: unknown;
}): ThreadHistoryItemDto {
  const eventLabel = codexHookEventLabel(run.eventName);
  const outputEntries = normalizeHookRunOutputEntries(run);
  const entryPreview = outputEntries
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  const firstEntryLine = entryPreview.split('\n').find(Boolean) ?? null;
  const detailLines = [
    `Event: ${eventLabel}`,
    `Status: ${codexHookStatusLabel(run.status)}`,
    `Handler: ${run.handlerType}`,
    `Scope: ${run.scope}`,
    `Source: ${run.source}`,
    `Path: ${run.sourcePath}`,
    run.durationMs !== null ? `Duration: ${run.durationMs} ms` : null,
    run.statusMessage ? `Message: ${run.statusMessage}` : null,
    entryPreview ? `\n${entryPreview}` : null,
  ].filter((line): line is string => Boolean(line));

  return {
    id: `hook:${run.id}`,
    kind: 'hook',
    text: `${eventLabel} hook`,
    previewText: run.statusMessage ?? firstEntryLine ?? `${eventLabel} hook`,
    detailText: detailLines.join('\n'),
    status: codexHookStatusLabel(run.status),
    hookEventName: run.eventName,
    hookEventLabel: eventLabel,
    hookHandlerType: run.handlerType,
    hookScope: run.scope,
    hookSource: run.source,
    hookSourcePath: run.sourcePath,
    hookStatusMessage: run.statusMessage,
    hookOutputEntries: outputEntries,
  };
}
