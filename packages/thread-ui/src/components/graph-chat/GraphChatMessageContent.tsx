import {
  memo,
  useEffect,
  isValidElement,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { Button } from '../graph-ui/Button';
import { usePlugins } from '../../plugins/usePlugins';
import { GraphChatToolCall } from './GraphChatToolCall';
import { getGraphChatHighlighter } from './graphChatShiki';
import {
  createEmptyGraphChatToolResultState,
  getGraphChatToolUiStatus,
  mergeGraphChatToolResultState,
  preprocessGraphChatToolBlocks,
  reconstructGraphChatToolArgs,
  type GraphChatToolMergedPayload,
} from './graphChatToolBlocks';

type CodeRendererProps = ComponentProps<'code'> & {
  inline?: boolean | undefined;
  node?: unknown;
};

function ensureTransparentShikiBg(html: string) {
  return html
    .replace(/background-color:[^;"]+;?/g, 'background-color: transparent;')
    .replace(/background:[^;"]+;?/g, 'background: transparent;');
}

function textFromReactNode(children: ReactNode) {
  if (Array.isArray(children)) {
    return children.map((child) => String(child)).join('');
  }
  return String(children ?? '');
}

function readMarkdownNodeLineRange(node: unknown) {
  if (!node || typeof node !== 'object' || !('position' in node)) {
    return { startLine: undefined, endLine: undefined };
  }

  const position = (node as { position?: unknown }).position;
  if (!position || typeof position !== 'object') {
    return { startLine: undefined, endLine: undefined };
  }

  const start = (position as { start?: unknown }).start;
  const end = (position as { end?: unknown }).end;
  const startLine =
    start && typeof start === 'object'
      ? (start as { line?: unknown }).line
      : undefined;
  const endLine =
    end && typeof end === 'object'
      ? (end as { line?: unknown }).line
      : undefined;

  return {
    startLine: typeof startLine === 'number' ? startLine : undefined,
    endLine: typeof endLine === 'number' ? endLine : undefined,
  };
}

function PreRenderer({ children, ...props }: ComponentProps<'pre'>) {
  if (isToolCodeElement(children)) {
    return <>{children}</>;
  }

  return <pre {...props}>{children}</pre>;
}

function isToolCodeElement(value: ReactNode) {
  if (!value || typeof value !== 'object' || !('props' in value)) {
    return false;
  }

  const className = (value as { props?: { className?: unknown } }).props
    ?.className;
  if (typeof className !== 'string') {
    return false;
  }

  return (
    className.includes('language-tool-call') ||
    className.includes('language-tool-merged') ||
    className.includes('language-tool-result')
  );
}

export const GraphChatMessageContent = memo(function GraphChatMessageContent({
  className = 'thread-graph-markdown',
  content,
}: {
  className?: string;
  content: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const plugins = usePlugins();
  const [highlighter, setHighlighter] = useState<Awaited<
    ReturnType<typeof getGraphChatHighlighter>
  > | null>(null);
  const [copyState, setCopyState] = useState<
    Record<string, 'copied' | 'failed'>
  >({});
  const [dark, setDark] = useState(false);
  const { processedContent, resultMap } = useMemo(
    () => preprocessGraphChatToolBlocks(content),
    [content],
  );

  useEffect(() => {
    let alive = true;
    getGraphChatHighlighter()
      .then((loadedHighlighter) => {
        if (alive) {
          setHighlighter(loadedHighlighter);
        }
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const shell = root?.closest<HTMLElement>('.thread-ui-shell');

    const readDark = () => {
      if (!shell) {
        return document.documentElement.classList.contains('dark');
      }
      return (
        shell.getAttribute('data-theme-effective') === 'dark' ||
        shell.classList.contains('dark') ||
        shell.classList.contains('thread-ui-theme-dark')
      );
    };

    setDark(readDark());
    if (!shell) {
      return;
    }

    const observer = new MutationObserver(() => setDark(readDark()));
    observer.observe(shell, {
      attributes: true,
      attributeFilter: ['class', 'data-theme-effective'],
    });
    return () => observer.disconnect();
  }, []);

  async function copyCode(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState((current) => ({ ...current, [id]: 'copied' }));
      window.setTimeout(() => {
        setCopyState((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      }, 1200);
    } catch {
      setCopyState((current) => ({ ...current, [id]: 'failed' }));
    }
  }

  const CodeBlockRenderer = ({
    children,
    className: codeClassName,
    inline,
    node,
    ...props
  }: CodeRendererProps): ReactElement | null => {
    const match = /language-(\w+(?:-\w+)*)/.exec(codeClassName || '');
    const language = match ? match[1] ?? '' : '';
    const textContent = textFromReactNode(children).replace(/\n$/, '');
    const { startLine, endLine } = readMarkdownNodeLineRange(node);
    const isFencedOrBlockCode =
      inline === false ||
      Boolean(codeClassName) ||
      textContent.includes('\n') ||
      startLine !== endLine;

    if (language === 'tool-merged') {
      let data: GraphChatToolMergedPayload = {
        call: { tool: 'Unknown', args: {}, call_id: undefined },
        result: null,
      };
      try {
        data = JSON.parse(textContent) as GraphChatToolMergedPayload;
      } catch {
        data = {
          call: { tool: 'Error', args: { raw: textContent } },
          result: { status: 'failed' },
        };
      }

      const toolName =
        typeof data.call.tool === 'string' ? data.call.tool : 'Unknown';
      const callId =
        typeof data.call.call_id === 'string' ? data.call.call_id : undefined;
      return (
        <GraphChatToolCall
          callId={callId}
          toolName={toolName}
          status={getGraphChatToolUiStatus(data.result)}
          parameters={reconstructGraphChatToolArgs(data.call.args)}
          result={data.result}
        />
      );
    }

    if (language === 'tool-call') {
      let data: { tool?: unknown; args?: unknown; call_id?: unknown } = {
        tool: 'Unknown',
        args: {},
        call_id: undefined,
      };
      try {
        data = JSON.parse(textContent) as typeof data;
      } catch {
        data = { tool: 'Error', args: { raw: textContent } };
      }

      const callId =
        typeof data.call_id === 'string' ? data.call_id : undefined;
      const liveResult =
        callId && resultMap.has(callId)
          ? mergeGraphChatToolResultState(
              resultMap.get(callId) ??
                createEmptyGraphChatToolResultState(),
            )
          : undefined;

      return (
        <GraphChatToolCall
          callId={callId}
          toolName={typeof data.tool === 'string' ? data.tool : 'Unknown'}
          status={liveResult ? getGraphChatToolUiStatus(liveResult) : 'pending'}
          parameters={reconstructGraphChatToolArgs(data.args)}
          result={liveResult}
        />
      );
    }

    if (language === 'tool-result') {
      return null;
    }

    if (['xyz', 'extxyz', 'cif', 'pdb'].includes(language)) {
      const rendered = plugins.renderInlineCode({
        code: textContent,
        isIncomplete: false,
        language,
      });
      if (isValidElement(rendered)) {
        return rendered;
      }
    }

    if (isFencedOrBlockCode) {
      const loadedLanguages = highlighter?.getLoadedLanguages?.() ?? [];
      const lang = loadedLanguages.includes(language) ? language : 'text';
      const theme = dark ? 'ayu-dark' : 'ayu-light';
      const id = `${language || 'text'}:${textContent.length}:${textContent.slice(
        0,
        32,
      )}`;
      let html = '';

      if (highlighter) {
        try {
          html = ensureTransparentShikiBg(
            highlighter.codeToHtml(textContent, { lang, theme }),
          );
        } catch {
          html = ensureTransparentShikiBg(
            highlighter.codeToHtml(textContent, { lang: 'text', theme }),
          );
        }
      }

      return (
        <div className="thread-graph-code-block not-prose relative my-3 overflow-auto rounded-xl border p-3 text-sm shadow-sm">
          <Button
            type="button"
            onClick={() => void copyCode(id, textContent)}
            variant="ghost"
            size="sm"
            className="thread-graph-code-copy absolute right-2 top-2 z-10 rounded-md p-1.5"
            title={
              copyState[id] === 'copied'
                ? 'Copied'
                : copyState[id] === 'failed'
                  ? 'Copy failed'
                  : 'Copy'
            }
            aria-label="Copy code"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          {html ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre>
              <code className="whitespace-pre">{textContent}</code>
            </pre>
          )}
        </div>
      );
    }

    const inlineDisplayText = textFromReactNode(children).replace(/`+/g, '');
    return (
      <code
        className={`thread-graph-inline-code rounded px-1 py-0.5 font-mono font-normal text-[0.9em] ${
          codeClassName || ''
        }`}
        {...props}
      >
        {inlineDisplayText}
      </code>
    );
  };

  return (
    <div ref={rootRef} className={`thread-graph-message-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code: CodeBlockRenderer,
          pre: PreRenderer,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});
