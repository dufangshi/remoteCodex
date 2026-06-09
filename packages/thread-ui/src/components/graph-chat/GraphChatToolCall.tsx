import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { GraphChatToolStatus } from './graphChatToolBlocks';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../graph-workspace/GraphAccordion';

interface GraphChatToolCallProps {
  callId?: string | undefined;
  toolName: string;
  status: GraphChatToolStatus;
  parameters: unknown;
  result?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeObjectEntries(value: unknown) {
  if (isRecord(value)) {
    return Object.entries(value);
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [['value', value]] as Array<[string, unknown]>;
}

function formatPrimitiveValue(value: unknown) {
  if (typeof value === 'string') {
    return <span className="thread-graph-tool-string">"{value}"</span>;
  }
  if (typeof value === 'number') {
    return <span className="thread-graph-tool-number">{value}</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <span className="thread-graph-tool-boolean">{String(value)}</span>
    );
  }
  if (value === null) {
    return <span className="thread-graph-tool-null">null</span>;
  }
  if (typeof value === 'object') {
    return (
      <span className="thread-graph-tool-object">
        {JSON.stringify(value)}
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

function renderResultValue(key: string, value: unknown) {
  if (
    typeof value === 'string' &&
    (key === 'stdout' || key === 'stderr' || key === 'result')
  ) {
    return (
      <pre className="thread-graph-tool-output">
        {value || '(empty)'}
      </pre>
    );
  }

  if (typeof value === 'object' && value !== null) {
    return (
      <pre className="thread-graph-tool-output">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return formatPrimitiveValue(value);
}

export function GraphChatToolCall({
  callId,
  toolName,
  status,
  parameters,
  result,
}: GraphChatToolCallProps) {
  const statusConfig = useMemo(() => {
    switch (status) {
      case 'completed':
        return {
          className: 'is-completed',
          icon: <CheckCircle2 className="h-3.5 w-3.5" />,
          label: 'Completed',
        };
      case 'failed':
        return {
          className: 'is-failed',
          icon: <XCircle className="h-3.5 w-3.5" />,
          label: 'Failed',
        };
      default:
        return {
          className: 'is-pending',
          icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
          label: 'Running',
        };
    }
  }, [status]);

  const resultEntries = useMemo(() => normalizeObjectEntries(result), [result]);
  const parameterEntries = useMemo(
    () => normalizeObjectEntries(parameters),
    [parameters],
  );
  const hasTextualOutput = useMemo(() => {
    if (typeof result === 'string') {
      return result.length > 0;
    }
    if (!isRecord(result)) {
      return false;
    }
    return ['stdout', 'stderr', 'result'].some((key) => {
      const value = result[key];
      return typeof value === 'string' && value.length > 0;
    });
  }, [result]);
  const shouldAutoOpen = status === 'pending' || hasTextualOutput;
  const [openItem, setOpenItem] = useState<string | undefined>(
    shouldAutoOpen ? 'item-1' : undefined,
  );

  useEffect(() => {
    if (shouldAutoOpen) {
      setOpenItem('item-1');
    }
  }, [callId, shouldAutoOpen]);

  return (
    <div className="thread-graph-tool-call my-2 w-full font-sans not-prose">
      <Accordion
        type="single"
        collapsible
        onValueChange={(value) => setOpenItem(value || undefined)}
        className="thread-graph-tool-accordion w-full overflow-hidden rounded-lg border"
        {...(openItem !== undefined ? { value: openItem } : {})}
      >
        <AccordionItem value="item-1" className="border-0">
          <AccordionTrigger
            className="thread-graph-tool-trigger px-4 py-3 hover:no-underline"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Wrench className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate font-mono text-sm font-semibold">
                {toolName}
              </span>
              <span
                className={`thread-graph-tool-badge ${statusConfig.className}`}
              >
                {statusConfig.icon}
                {statusConfig.label}
              </span>
            </div>
          </AccordionTrigger>

          <AccordionContent className="thread-graph-tool-content px-4 pb-4 pt-1">
            <section>
              <h4>Parameters</h4>
              <div className="thread-graph-tool-json">
                {'{'}
                <br />
                {parameterEntries.length > 0 ? (
                  parameterEntries.map(([key, value], index) => (
                    <div key={key}>
                      <span className="thread-graph-tool-key">"{key}"</span>
                      <span className="thread-graph-tool-punctuation">: </span>
                      {formatPrimitiveValue(value)}
                      {index < parameterEntries.length - 1 ? (
                        <span className="thread-graph-tool-punctuation">,</span>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div>
                    <span className="thread-graph-tool-null">empty</span>
                  </div>
                )}
                {'}'}
              </div>
            </section>

            {resultEntries.length > 0 ? (
              <section>
                <h4>Result</h4>
                <div className="thread-graph-tool-json">
                  {'{'}
                  <br />
                  {resultEntries.map(([key, value], index) => (
                    <div key={key}>
                      <span className="thread-graph-tool-key">"{key}"</span>
                      <span className="thread-graph-tool-punctuation">: </span>
                      {renderResultValue(key, value)}
                      {index < resultEntries.length - 1 ? (
                        <span className="thread-graph-tool-punctuation">,</span>
                      ) : null}
                    </div>
                  ))}
                  {'}'}
                </div>
              </section>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
