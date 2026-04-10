const BLOCK_MARKDOWN_PATTERNS = [
  /^(?: {0,3})#{1,6}\s+\S/m,
  /^(?: {0,3})>{1,}\s*\S/m,
  /^(?: {0,3})(?:[-+*]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?\S/m,
  /^(?: {0,3})(?:```|~~~)/m,
  /^(?: {0,3})(?:[-*_]\s*){3,}$/m,
];
const TABLE_MARKDOWN_PATTERN =
  /^(?:\|?[^|\n]+\|[^|\n]+(?:\|[^|\n]+)*\|?\s*\n\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$)/m;
const INLINE_LINK_PATTERN = /!?\[[^\]\n]+\]\([^)]+\)/;
const INLINE_CODE_PATTERN = /`[^`\n]+`/;
const STRONG_EMPHASIS_PATTERN = /(?:\*\*[^*\n]+\*\*|__[^_\n]+__)/;
const EMPHASIS_PATTERN = /(^|[^\w])(?:\*[^*\n]+\*|_[^_\n]+_)(?=[^\w]|$)/;
const STRIKETHROUGH_PATTERN = /~~[^~\n]+~~/;

export function hasLikelyMarkdownSyntax(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  if (
    BLOCK_MARKDOWN_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    TABLE_MARKDOWN_PATTERN.test(trimmed)
  ) {
    return true;
  }

  if (!/[`[\]*_~!]/.test(trimmed)) {
    return false;
  }

  return (
    INLINE_LINK_PATTERN.test(trimmed) ||
    INLINE_CODE_PATTERN.test(trimmed) ||
    STRONG_EMPHASIS_PATTERN.test(trimmed) ||
    EMPHASIS_PATTERN.test(trimmed) ||
    STRIKETHROUGH_PATTERN.test(trimmed)
  );
}
