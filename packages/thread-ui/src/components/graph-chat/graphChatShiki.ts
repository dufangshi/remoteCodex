import { createHighlighter } from 'shiki';

const graphChatHighlighterPromise = createHighlighter({
  themes: ['ayu-light', 'ayu-dark'],
  langs: [
    'text',
    'javascript',
    'typescript',
    'tsx',
    'jsx',
    'python',
    'json',
    'bash',
    'sh',
    'yaml',
    'toml',
    'markdown',
    'html',
    'css',
    'sql',
    'csv',
  ],
});

export function getGraphChatHighlighter() {
  return graphChatHighlighterPromise;
}
