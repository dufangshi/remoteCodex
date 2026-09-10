import {
  Aes256Gcm,
  CipherSuite,
  DhkemP256HkdfSha256,
  HkdfSha256,
} from '@hpke/core';

const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});
const nativeFetch = globalThis.fetch.bind(globalThis);
const limit = 64 * 1024 * 1024;
export const b64 = (value: ArrayBuffer | Uint8Array) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};
export const unb64 = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
function buffer(value: Uint8Array) {
  return value.slice().buffer as ArrayBuffer;
}
export class TransportError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
export interface TransportStatus {
  deviceId: string;
  state: 'encrypted' | 'legacy' | 'identity-changed' | 'error';
  fingerprint?: string;
}
export let reportTransport = (_status: TransportStatus) => {};
export function setTransportReporter(report: typeof reportTransport) {
  reportTransport = report;
}
interface Descriptor {
  version: number;
  challenge: string;
  keyId: string;
  publicKey: string;
  identityKey: string;
  expiresAt: number;
  serverTime: number;
  signature: string;
}
interface Key {
  descriptor: Descriptor;
  publicKey: CryptoKey;
  offset: number;
  fingerprint: string;
}
const keys = new Map<string, Promise<Key | null>>();
export function clearTransportKeyCache(deviceId: string) {
  keys.delete(deviceId);
}
async function identityStore() {
  return new Promise<IDBDatabase>((done, fail) => {
    const request = indexedDB.open('remote-codex-transport-v1', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('identities');
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });
}
async function pinned(deviceId: string, identity?: string) {
  const db = await identityStore();
  try {
    return await new Promise<string | undefined>((done, fail) => {
      const tx = db.transaction(
          'identities',
          identity ? 'readwrite' : 'readonly',
        ),
        store = tx.objectStore('identities');
      const request = store.get(deviceId);
      let result: string | undefined;
      request.onsuccess = () => {
        result = request.result as string | undefined;
        if (identity && !result) store.put(identity, deviceId);
      };
      tx.oncomplete = () => done(result);
      tx.onerror = () => fail(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function resetPinnedDevice(deviceId: string) {
  const db = await identityStore();
  try {
    await new Promise<void>((done, fail) => {
      const tx = db.transaction('identities', 'readwrite');
      tx.objectStore('identities').delete(deviceId);
      tx.oncomplete = () => done();
      tx.onerror = () => fail(tx.error);
    });
  } finally {
    db.close();
  }
  keys.delete(deviceId);
}
export function deviceRoute(url: URL) {
  const match = url.pathname.match(/^\/relay\/devices\/([^/]+)(\/api\/.*)$/);
  return match
    ? { deviceId: decodeURIComponent(match[1]!), path: match[2]! + url.search }
    : null;
}
export function scopeFromPage(url: string) {
  return new URL(url).pathname.match(/\/devices\/[^/]+\/threads\/([^/]+)/)?.[1];
}
async function keyFor(
  deviceId: string,
  path: string,
  scope?: string,
): Promise<Key | null> {
  const cached = keys.get(deviceId);
  if (cached) {
    const key = await cached;
    if (!key || key.descriptor.expiresAt > Date.now() + key.offset + 60000)
      return key;
    keys.delete(deviceId);
  }
  const task = (async () => {
    const resource = path
      .split('?')[0]!
      .match(/^\/api\/(threads|workspaces)\/([^/]+)/);
    const prefix =
      resource && !['start', 'import', 'recent'].includes(resource[2]!)
        ? `/api/${resource[1]}/${resource[2]}`
        : scope
          ? `/api/threads/${scope}`
          : '/api';
    const challenge = crypto.randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response: Response;
    try {
      response = await nativeFetch(
        `/relay/devices/${encodeURIComponent(deviceId)}${prefix}/transport/key?challenge=${challenge}`,
        { credentials: 'same-origin', cache: 'no-store', signal: controller.signal },
      );
    } catch (error) {
      if (controller.signal.aborted)
        throw new TransportError('device_unresponsive', 'The device did not respond to the encryption handshake. Retry in a moment.', 504);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const previous = await pinned(deviceId);
    if (response.status === 404 && !previous) {
      reportTransport({ deviceId, state: 'legacy' });
      setTimeout(() => { if (keys.get(deviceId) === task) keys.delete(deviceId); }, 10000);
      return null;
    }
    if (!response.ok) {
      const failure = (await response.clone().json().catch(() => null)) as {
        code?: string;
        message?: string;
      } | null;
      if (
        response.status === 503 &&
        failure?.code === 'service_unavailable' &&
        failure.message === 'device is offline'
      )
        throw new TransportError(
          'device_offline',
          'This device is offline. Wake it and check its network connection, then retry.',
          response.status,
        );
      if (response.status === 504)
        throw new TransportError(
          'device_unresponsive',
          'This device did not respond. It may be asleep or reconnecting. Wake it and retry.',
          response.status,
        );
      throw new TransportError(
        'transport_unavailable',
        response.status === 401
          ? 'Sign in to connect to this device.'
          : response.status === 403
            ? 'You no longer have access to this device.'
            : response.status === 429
              ? 'This device is busy. Wait a moment and retry.'
              : response.status >= 500
                ? 'The device connection is temporarily unavailable. Retry in a moment.'
                : 'Unable to establish an encrypted device connection.',
        response.status,
      );
    }
    const descriptor = (await response.json()) as Descriptor;
    if (
      descriptor.version !== 1 ||
      descriptor.challenge !== challenge ||
      typeof descriptor.identityKey !== 'string'
    )
      throw new TransportError(
        'transport_downgrade',
        'Device encryption is unavailable. Update the supervisor and reconnect.',
      );
    const identity = await crypto.subtle.importKey(
      'raw',
      buffer(unb64(descriptor.identityKey)),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const signed = `rcd-key-v1\n${challenge}\n${descriptor.keyId}\n${descriptor.expiresAt}\n${descriptor.serverTime}\n${descriptor.publicKey}`;
    if (
      !(await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        identity,
        buffer(unb64(descriptor.signature)),
        encoder.encode(signed),
      )) ||
      descriptor.expiresAt <= descriptor.serverTime ||
      descriptor.expiresAt > descriptor.serverTime + 3660000
    )
      throw new TransportError(
        'transport_invalid_identity',
        'The device encryption identity could not be verified.',
      );
    const fingerprint = b64(
      await crypto.subtle.digest(
        'SHA-256',
        buffer(unb64(descriptor.identityKey)),
      ),
    );
    const stored = previous ?? (await pinned(deviceId, descriptor.identityKey));
    if (stored && stored !== descriptor.identityKey) {
      reportTransport({ deviceId, state: 'identity-changed', fingerprint });
      throw new TransportError(
        'transport_identity_changed',
        'The device identity changed. Verify its fingerprint before trusting it again.',
      );
    }
    return {
      descriptor,
      fingerprint,
      offset: descriptor.serverTime - Date.now(),
      publicKey: await suite.kem.deserializePublicKey(
        buffer(unb64(descriptor.publicKey)),
      ),
    };
  })();
  keys.set(deviceId, task);
  try {
    return await task;
  } catch (e) {
    if (keys.get(deviceId) === task) keys.delete(deviceId);
    throw e;
  }
}
function packet(headers: Headers, body: Uint8Array, query = '') {
  const metadata: Record<string, string> = {};
  for (const name of ['content-type', 'accept', 'range', 'if-none-match']) {
    const value = headers.get(name);
    if (value) metadata[name] = value;
  }
  const prefix = encoder.encode(JSON.stringify({ headers: metadata, query }));
  const out = new Uint8Array(4 + prefix.length + body.length);
  new DataView(out.buffer).setUint32(0, prefix.length);
  out.set(prefix, 4);
  out.set(body, 4 + prefix.length);
  return out;
}
function unpack(clear: ArrayBuffer) {
  if (clear.byteLength < 4 || clear.byteLength > limit + 65540)
    throw new Error('Invalid encrypted response size.');
  const length = new DataView(clear).getUint32(0);
  if (length > 65536 || length + 4 > clear.byteLength)
    throw new Error('Invalid encrypted response metadata.');
  const meta = JSON.parse(decoder.decode(new Uint8Array(clear, 4, length))) as {
    headers: Record<string, string>;
    status: number;
    streamNext?: string | null;
  };
  return {
    headers: meta.headers,
    status: meta.status,
    streamNext: meta.streamNext,
    body: clear.slice(4 + length),
  };
}
const aesKey = (bytes: ArrayBuffer, usages: KeyUsage[]) =>
  crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, usages);
export async function exchange(
  request: Request,
  scope?: string,
  beforeEncrypt?: () => Promise<void>,
  socketKeys = false,
  retryRead = true,
  followStream = true,
): Promise<{
  response: Response;
  sendKey?: CryptoKey;
  receiveKey?: CryptoKey;
  continuation?: string | null;
}> {
  if (request.method === 'HEAD') {
    const result = await exchange(
      new Request(request, { method: 'GET' }),
      scope,
      beforeEncrypt,
    );
    await result.response.body?.cancel();
    return {
      response: new Response(null, {
        status: result.response.status,
        headers: result.response.headers,
      }),
    };
  }
  const url = new URL(request.url),
    route = deviceRoute(url);
  if (!route || request.headers.has('x-rcd-key'))
    return { response: await nativeFetch(request) };
  let key: Key | null;
  try {
    key = await keyFor(route.deviceId, route.path, scope);
  } catch (error) {
    if (error instanceof TransportError && error.status)
      return {
        response: new Response(
          JSON.stringify({
            code: error.status === 401 ? 'unauthorized' : error.code,
            message: error.message,
          }),
          {
            status: error.status,
            headers: { 'content-type': 'application/json' },
          },
        ),
      };
    throw error;
  }
  if (!key) return { response: await nativeFetch(request) };
  await beforeEncrypt?.();
  const requestId = `${crypto.randomUUID()}.${Math.floor(Date.now() + key.offset)}`;
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? new Uint8Array()
      : new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > limit)
    throw new Error('The encrypted request is too large.');
  let resource = '';
  if (
    request.headers.get('content-type')?.includes('application/json') &&
    body.length
  ) {
    try {
      const data = JSON.parse(decoder.decode(body));
      if (typeof data.workspaceId === 'string')
        resource = JSON.stringify({ workspaceId: data.workspaceId });
    } catch {
      /* original endpoint validates non-JSON */
    }
  }
  const wirePath = route.path.split('?')[0]!;
  const aad = `rcd-http-v1\n${key.descriptor.keyId}\n${requestId}\n${request.method}\n${wirePath}\n${resource}`;
  const sender = await suite.createSenderContext({
    recipientPublicKey: key.publicKey,
    info: encoder.encode('remote-codex/relay/v1'),
  });
  const sealed = await sender.seal(
    buffer(packet(request.headers, body, url.search)),
    encoder.encode(aad),
  );
  const headers = new Headers(request.headers);
  headers.set('x-rcd-key', key.descriptor.keyId);
  headers.set('x-rcd-request', requestId);
  headers.set('x-rcd-enc', b64(sender.enc));
  if (resource) headers.set('x-rcd-resource', resource);
  headers.set('content-type', 'application/octet-stream');
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  if (!hasBody) headers.set('x-rcd-sealed', b64(sealed));
  const wireUrl = new URL(request.url);
  wireUrl.search = '';
  const response = await nativeFetch(wireUrl, {
    method: request.method,
    headers,
    credentials: request.credentials,
    signal: request.signal,
    cache: 'no-store',
    ...(hasBody ? { body: sealed } : {}),
  });
  if (response.headers.get('x-rcd-encrypted') !== '1') {
    if (
      response.status === 409 &&
      (
        await response
          .clone()
          .json()
          .catch(() => ({}))
      ).code === 'transport_reconnect_required'
    ) {
      clearTransportKeyCache(route.deviceId);
      // Unknown recipient keys are rejected before decryption/dispatch. Session
      // creation must recover too, but never replay arbitrary application POSTs.
      const sessionRetry = request.method === 'POST' && wirePath.endsWith('/transport/session');
      if (retryRead && (request.method === 'GET' || sessionRetry))
        return exchange(
          sessionRetry ? new Request(request.url, {
            method: request.method, headers: request.headers,
            credentials: request.credentials, signal: request.signal,
            body: buffer(body),
          }) : request,
          scope,
          beforeEncrypt,
          socketKeys,
          false,
          followStream,
        );
    }
    if (!response.ok) return { response };
    throw new TransportError(
      'transport_downgrade',
      'An unencrypted device response was rejected.',
    );
  }
  const ciphertext = await response.arrayBuffer();
  if (ciphertext.byteLength > limit + 65556)
    throw new Error('The encrypted response is too large.');
  const responseKey = await aesKey(
    await sender.export(encoder.encode('remote-codex/http-response/v1'), 32),
    ['decrypt'],
  );
  const opened = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(12),
      additionalData: encoder.encode(`${aad}\nresponse`),
    },
    responseKey,
    ciphertext,
  );
  const data = unpack(opened);
  reportTransport({
    deviceId: route.deviceId,
    state: 'encrypted',
    fingerprint: key.fingerprint,
  });
  let responseBody: BodyInit | null = [204, 205, 304].includes(data.status)
    ? null
    : data.body;
  if (data.streamNext && followStream && responseBody) {
    let next: string | null | undefined = data.streamNext;
    const cancel = new AbortController();
    const abort = () => cancel.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    const prefix =
      route.path
        .split('?')[0]!
        .match(/^\/api\/(threads|workspaces)\/([0-9a-f-]{36})(?:\/|$)/)?.[0]
        ?.replace(/\/$/, '') ?? '/api';
    responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(data.body));
      },
      async pull(controller) {
        if (!next) {
          request.signal.removeEventListener('abort', abort);
          controller.close();
          return;
        }
        try {
          if (
            !next.startsWith(`${prefix}/transport/stream/`) ||
            next.includes('..')
          )
            throw new Error('Invalid encrypted continuation scope.');
          const endpoint = new URL(
            `/relay/devices/${encodeURIComponent(route.deviceId)}${next}`,
            url.origin,
          );
          const part = await exchange(
            new Request(endpoint, {
              credentials: request.credentials,
              signal: cancel.signal,
            }),
            scope,
            undefined,
            false,
            true,
            false,
          );
          if (!part.response.ok)
            throw new Error('Download expired. Start it again.');
          controller.enqueue(new Uint8Array(await part.response.arrayBuffer()));
          next = part.continuation;
        } catch (error) {
          request.signal.removeEventListener('abort', abort);
          controller.error(error);
        }
      },
      cancel() {
        request.signal.removeEventListener('abort', abort);
        cancel.abort();
      },
    });
  }
  const result = new Response(responseBody, {
    status: data.status,
    headers: data.headers,
  });
  if (!socketKeys)
    return { response: result, continuation: data.streamNext ?? null };
  return {
    response: result,
    sendKey: await aesKey(
      await sender.export(encoder.encode('remote-codex/ws-client/v1'), 32),
      ['encrypt'],
    ),
    receiveKey: await aesKey(
      await sender.export(encoder.encode('remote-codex/ws-server/v1'), 32),
      ['decrypt'],
    ),
  };
}
export type WireMessage = {
  type?: string;
  threadId?: string | null;
  shellId?: string | null;
  encrypted?: {
    version: number;
    channelId: string;
    sequence: number;
    body: string;
  };
  [key: string]: unknown;
};
function wsAad(id: string, sequence: number, message: WireMessage) {
  return encoder.encode(
    `rcd-ws-v1\n${id}\n${sequence}\n${message.type ?? ''}\n${message.threadId ?? ''}\n${message.shellId ?? ''}`,
  );
}
function nonce(sequence: number) {
  const value = new Uint8Array(12);
  new DataView(value.buffer).setBigUint64(4, BigInt(sequence));
  return value;
}
export class SocketCipher {
  private sent = 0;
  private received = -1;
  constructor(
    public readonly id: string,
    private sendKey: CryptoKey,
    private receiveKey: CryptoKey,
  ) {}
  async seal(message: WireMessage) {
    const sequence = this.sent++;
    if (!Number.isSafeInteger(sequence))
      throw new Error('Encrypted channel sequence exhausted.');
    const body = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce(sequence),
        additionalData: wsAad(this.id, sequence, message),
      },
      this.sendKey,
      encoder.encode(JSON.stringify(message)),
    );
    return {
      type: message.type,
      threadId: message.threadId ?? null,
      shellId: message.shellId ?? null,
      encrypted: { version: 1, channelId: this.id, sequence, body: b64(body) },
    };
  }
  async open(message: WireMessage) {
    const encrypted = message.encrypted;
    if (
      !encrypted ||
      encrypted.version !== 1 ||
      encrypted.channelId !== this.id ||
      !Number.isSafeInteger(encrypted.sequence) ||
      encrypted.sequence <= this.received
    )
      throw new Error('Encrypted event replay or wrong channel.');
    // Relay scope filtering may omit unrelated events; monotonic gaps are valid.
    const clear = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce(encrypted.sequence),
        additionalData: wsAad(this.id, encrypted.sequence, message),
      },
      this.receiveKey,
      buffer(unb64(encrypted.body)),
    );
    const parsed = JSON.parse(decoder.decode(clear)) as WireMessage;
    if (
      decoder.decode(wsAad(this.id, encrypted.sequence, parsed)) !==
      decoder.decode(wsAad(this.id, encrypted.sequence, message))
    )
      throw new Error('Encrypted event routing mismatch.');
    this.received = encrypted.sequence;
    return parsed;
  }
}
