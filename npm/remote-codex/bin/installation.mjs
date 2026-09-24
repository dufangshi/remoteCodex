// User-owned, per-launcher release routing. Never rewrite a package manager's store.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export function routingFile(launcher, home = os.homedir()) {
  const origin = fs.realpathSync(launcher);
  const key = crypto.createHash('sha256').update(origin).digest('hex');
  return path.join(home, '.remote-codex', 'installations', key, 'current.json');
}

export function activeLauncher(launcher, home = os.homedir()) {
  const origin = fs.realpathSync(launcher);
  const file = routingFile(origin, home);
  if (!fs.existsSync(file)) return origin;
  const route = JSON.parse(fs.readFileSync(file, 'utf8'));
  const original = JSON.parse(fs.readFileSync(path.resolve(origin, '../../package.json'), 'utf8'));
  // An explicit package-manager upgrade supersedes the old routing decision.
  if (route.originVersion !== original.version) return origin;
  const target = path.resolve(path.dirname(file), route.relativeLauncher);
  if (!target.startsWith(path.dirname(file) + path.sep) || target === origin)
    throw Error('Invalid managed installation route');
  const pkg = JSON.parse(fs.readFileSync(path.resolve(target, '../../package.json'), 'utf8'));
  if (pkg.name !== 'remote-codex' || pkg.version !== route.version)
    throw Error('Managed installation is incomplete; refusing to start an older runtime');
  return target;
}

// npm publish uses ordinary ustar regular files/directories. Reject special
// entries, links and extended path records rather than delegating to system tar.
export function extractPackage(archive, destination) {
  const tar = gunzipSync(archive, { maxOutputLength: 256 * 1024 * 1024 });
  const seen = new Set();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const expected = parseInt(field(148, 8).trim(), 8);
    const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
    if (checksum !== expected) throw Error('Invalid package archive checksum');
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join('/');
    const parts = name.replace(/\/$/, '').split('/');
    if (parts.shift() !== 'package' || parts.some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f]/.test(p)))
      throw Error('Unsafe package archive path');
    const type = field(156, 1);
    if (!['', '0', '5'].includes(type)) throw Error('Unsupported package archive entry');
    const size = parseInt(field(124, 12).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length)
      throw Error('Truncated package archive');
    const target = path.join(destination, ...parts);
    if (seen.has(target)) throw Error('Duplicate package archive entry');
    seen.add(target);
    if (type === '5') fs.mkdirSync(target, { recursive: true });
    else {
      if (!parts.length) throw Error('Invalid package archive root');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const executable = parseInt(field(100, 8).trim(), 8) & 0o111;
      fs.writeFileSync(target, tar.subarray(offset + 512, offset + 512 + size), { flag: 'wx', mode: executable ? 0o700 : 0o600 });
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

export async function stagePackage(version, destination, fetcher = fetch) {
  const metadata = await fetcher(`https://registry.npmjs.org/remote-codex/${version}`, { signal: AbortSignal.timeout(30_000) });
  if (!metadata.ok) throw Error(`Registry returned ${metadata.status}`);
  const pkg = await metadata.json();
  const url = new URL(pkg.dist?.tarball);
  if (pkg.name !== 'remote-codex' || pkg.version !== version || url.origin !== 'https://registry.npmjs.org' || url.username || url.password)
    throw Error('Invalid release metadata');
  const integrity = pkg.dist?.integrity;
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity ?? '')) throw Error('Missing release integrity');
  const response = await fetcher(url, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
  if (!response.ok) throw Error(`Package download returned ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw Error('Package download exceeds size limit');
    chunks.push(chunk);
  }
  const archive = Buffer.concat(chunks);
  if (`sha512-${crypto.createHash('sha512').update(archive).digest('base64')}` !== integrity)
    throw Error('Package integrity mismatch');
  extractPackage(archive, destination);
  const installed = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'));
  if (installed.name !== 'remote-codex' || installed.version !== version)
    throw Error('Downloaded package version mismatch');
  for (const file of ['bin/remote-codex.mjs', 'bin/supervisor-update.mjs', 'bin/installation.mjs', 'native-manifest.json'])
    if (!fs.statSync(path.join(destination, file)).isFile()) throw Error(`Incomplete release: ${file}`);
}
