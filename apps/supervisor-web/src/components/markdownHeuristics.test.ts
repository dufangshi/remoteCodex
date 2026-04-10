import { describe, expect, it } from 'vitest';

import { hasLikelyMarkdownSyntax } from './markdownHeuristics';

describe('hasLikelyMarkdownSyntax', () => {
  it('returns false for plain prose', () => {
    expect(
      hasLikelyMarkdownSyntax('This is a plain agent reply with no formatting.'),
    ).toBe(false);
  });

  it('detects common block markdown patterns', () => {
    expect(hasLikelyMarkdownSyntax('## Heading')).toBe(true);
    expect(hasLikelyMarkdownSyntax('- list item')).toBe(true);
    expect(hasLikelyMarkdownSyntax('1. ordered item')).toBe(true);
    expect(hasLikelyMarkdownSyntax('> quoted line')).toBe(true);
    expect(hasLikelyMarkdownSyntax('```ts\nconst value = 42;\n```')).toBe(true);
  });

  it('detects common inline markdown patterns', () => {
    expect(hasLikelyMarkdownSyntax('Use `pnpm test` first.')).toBe(true);
    expect(hasLikelyMarkdownSyntax('Open [the docs](https://example.com).')).toBe(true);
    expect(hasLikelyMarkdownSyntax('This is **important**.')).toBe(true);
    expect(hasLikelyMarkdownSyntax('This is _emphasized_.')).toBe(true);
    expect(hasLikelyMarkdownSyntax('This was ~~reverted~~.')).toBe(true);
  });

  it('stays false for common non-markdown punctuation patterns', () => {
    expect(hasLikelyMarkdownSyntax('2 * 3 = 6')).toBe(false);
    expect(hasLikelyMarkdownSyntax('variable_name should stay plain')).toBe(false);
    expect(hasLikelyMarkdownSyntax('Look at [1] in the report')).toBe(false);
  });
});
