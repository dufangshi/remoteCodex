const secretPatterns: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g, 'Bearer [REDACTED]'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, '[REDACTED_ANTHROPIC_KEY]'],
  [/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED_OPENAI_KEY]'],
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_ACCESS_KEY]'],
  [/gh[pousr]_[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_TOKEN]'],
];

export function redactSecretText(value: string) {
  return secretPatterns.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

export function redactedSlice(value: string, length = 4000) {
  return redactSecretText(value).slice(0, length);
}
