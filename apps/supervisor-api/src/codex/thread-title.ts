const AUTO_THREAD_TITLE_MAX_CHARS = 15;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncateAutoThreadTitle(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return '';
  }

  const characters = Array.from(normalized);
  if (characters.length <= AUTO_THREAD_TITLE_MAX_CHARS) {
    return normalized;
  }

  return `${characters.slice(0, AUTO_THREAD_TITLE_MAX_CHARS).join('')}...`;
}

