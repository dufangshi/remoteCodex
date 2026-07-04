import type { IOSBootstrap } from './IOSBootstrap';

export function supervisorRestPath(
  bootstrap: Pick<IOSBootstrap, 'mode' | 'relayDeviceId'>,
  path: string,
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (bootstrap.mode !== 'relay') {
    return normalizedPath;
  }
  if (normalizedPath.startsWith('/relay/')) {
    return normalizedPath;
  }
  const deviceId = bootstrap.relayDeviceId?.trim();
  if (deviceId) {
    return `/relay/devices/${encodeURIComponent(deviceId)}${normalizedPath}`;
  }
  return normalizedPath.startsWith('/relay/')
    ? normalizedPath
    : `/relay${normalizedPath}`;
}

export function supervisorWebSocketUrl(
  bootstrap: IOSBootstrap,
  options: { threadId?: string | null } = {},
) {
  const base = bootstrap.baseUrl
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://');
  const path = bootstrap.mode === 'relay' ? '/relay/ws' : '/ws';

  const params: string[] = [];
  if (bootstrap.authToken) {
    const queryName = bootstrap.mode === 'relay' ? 'relaySession' : 'token';
    params.push(`${queryName}=${encodeURIComponent(bootstrap.authToken)}`);
  }
  if (options.threadId) {
    params.push(`threadId=${encodeURIComponent(options.threadId)}`);
  }

  const query = params.join('&');
  return `${base}${path}${query ? `?${query}` : ''}`;
}

export function supervisorApiUrl(bootstrap: IOSBootstrap, path: string) {
  return `${bootstrap.baseUrl}${supervisorRestPath(bootstrap, path)}`;
}
