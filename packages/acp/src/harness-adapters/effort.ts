export function normalizeAcpEffort(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'none':
    case 'off':
      return 'none';
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'max':
    case 'ultra':
      return normalized;
    case 'xhigh':
    case 'extra_high':
      return 'xhigh';
    default:
      return null;
  }
}
