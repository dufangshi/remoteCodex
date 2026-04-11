import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const serviceHost = process.env.SERVICE_HOST ?? '127.0.0.1';
const servicePort = parsePort(process.env.SERVICE_PORT, 4173);
const apiHost = process.env.SERVICE_API_HOST ?? '127.0.0.1';
const apiPort = parsePort(process.env.SERVICE_API_PORT, 8787);
const distDir = path.resolve(
  process.env.SERVICE_WEB_DIST_DIR ?? path.join(repoRoot, 'apps/supervisor-web/dist')
);
const indexFile = path.join(distDir, 'index.html');

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

await fsp.access(indexFile, fs.constants.R_OK);

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error('Web service request failed:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    response.end('Internal Server Error');
  });
});

server.on('upgrade', (request, socket, head) => {
  if (!shouldProxyUpgrade(request.url)) {
    socket.destroy();
    return;
  }

  const upstream = net.connect(apiPort, apiHost, () => {
    upstream.write(buildUpgradeRequest(request));
    if (head.length > 0) {
      upstream.write(head);
    }
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on('error', () => {
    socket.destroy();
  });
  socket.on('error', () => {
    upstream.destroy();
  });
});

server.listen(servicePort, serviceHost, () => {
  console.log(`Supervisor web service listening on http://${serviceHost}:${servicePort}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}

async function handleRequest(request, response) {
  if (!request.url) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Bad Request');
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  if (shouldProxyHttp(url.pathname)) {
    await proxyHttpRequest(request, response);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Method Not Allowed');
    return;
  }

  const assetPath = await resolveAssetPath(url.pathname);
  if (!assetPath) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  const contentType = mimeTypes.get(path.extname(assetPath).toLowerCase()) ?? 'application/octet-stream';
  const stat = await fsp.stat(assetPath);
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': stat.size,
    'cache-control': assetPath === indexFile ? 'no-cache' : 'public, max-age=31536000, immutable',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  fs.createReadStream(assetPath).pipe(response);
}

function shouldProxyHttp(pathname) {
  return pathname === '/healthz' || pathname === '/ws' || pathname === '/api' || pathname.startsWith('/api/');
}

function shouldProxyUpgrade(url) {
  if (!url) {
    return false;
  }

  const pathname = new URL(url, 'http://localhost').pathname;
  return pathname === '/ws';
}

async function proxyHttpRequest(request, response) {
  await new Promise((resolve, reject) => {
    const upstream = http.request(
      {
        hostname: apiHost,
        port: apiPort,
        method: request.method,
        path: request.url,
        headers: {
          ...request.headers,
          host: `${apiHost}:${apiPort}`,
        },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
        upstreamResponse.on('end', resolve);
      }
    );

    upstream.on('error', reject);
    request.on('aborted', () => {
      upstream.destroy();
      reject(new Error('Client request was aborted.'));
    });
    request.pipe(upstream);
  }).catch(() => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    response.end('Bad Gateway');
  });
}

async function resolveAssetPath(pathname) {
  const decodedPath = decodePath(pathname);
  if (decodedPath === null) {
    return null;
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(distDir, relativePath);
  if (!isPathInsideDist(candidate)) {
    return null;
  }

  const candidateStat = await safeStat(candidate);
  if (candidateStat?.isFile()) {
    return candidate;
  }

  if (candidateStat?.isDirectory()) {
    const nestedIndex = path.join(candidate, 'index.html');
    const nestedIndexStat = await safeStat(nestedIndex);
    if (nestedIndexStat?.isFile() && isPathInsideDist(nestedIndex)) {
      return nestedIndex;
    }
  }

  if (path.posix.extname(decodedPath)) {
    return null;
  }

  return indexFile;
}

function decodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function isPathInsideDist(candidate) {
  return candidate === distDir || candidate.startsWith(`${distDir}${path.sep}`);
}

function buildUpgradeRequest(request) {
  const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`];
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name.toLowerCase() === 'host') {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        lines.push(`${name}: ${entry}`);
      }
      continue;
    }

    lines.push(`${name}: ${value}`);
  }

  lines.push(`host: ${apiHost}:${apiPort}`, '', '');
  return lines.join('\r\n');
}

async function safeStat(filePath) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}

function parsePort(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid port: ${value}`);
  }

  return parsed;
}
