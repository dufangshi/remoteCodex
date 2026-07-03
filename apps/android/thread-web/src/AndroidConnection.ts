import type { AndroidThreadBootstrap } from './AndroidBootstrap';

export function supervisorRestPath(
  bootstrap: AndroidThreadBootstrap,
  path: string,
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (bootstrap.mode !== 'relay') {
    return normalizedPath;
  }
  if (bootstrap.relayDeviceId) {
    return `/relay/devices/${encodeURIComponent(bootstrap.relayDeviceId)}${normalizedPath}`;
  }
  return normalizedPath.startsWith('/relay/')
    ? normalizedPath
    : `/relay${normalizedPath}`;
}

export function supervisorApiUrl(
  bootstrap: AndroidThreadBootstrap,
  path: string,
) {
  return `${bootstrap.baseUrl}${supervisorRestPath(bootstrap, path)}`;
}

export function supervisorWebSocketUrl(
  bootstrap: AndroidThreadBootstrap,
  options: { threadId?: string | null } = {},
) {
  const base = new URL(bootstrap.baseUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = bootstrap.mode === 'relay' ? '/relay/ws' : '/ws';
  base.search = '';
  if (bootstrap.mode === 'server' && bootstrap.authToken) {
    base.searchParams.set('token', bootstrap.authToken);
  }
  if (bootstrap.mode === 'relay' && bootstrap.authToken) {
    base.searchParams.set('relaySession', bootstrap.authToken);
  }
  if (options.threadId) {
    base.searchParams.set('threadId', options.threadId);
  }
  return base.toString();
}
