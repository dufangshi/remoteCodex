import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { JsonRpcClient, JsonRpcClientError } from './jsonrpc';

describe('JsonRpcClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves requests from line-delimited responses', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new JsonRpcClient(input, output);

    const promise = client.request<{ ok: boolean }>('ping', { hello: 'world' }, 1000);
    const outbound = output.read()?.toString() ?? '';
    const parsed = JSON.parse(outbound.trim());

    expect(parsed.method).toBe('ping');

    input.write(`${JSON.stringify({ id: parsed.id, result: { ok: true } })}\n`);

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('emits notifications', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new JsonRpcClient(input, output);
    const onNotification = vi.fn();

    client.on('notification', onNotification);
    input.write(`${JSON.stringify({ method: 'turn/started', params: { threadId: 't1' } })}\n`);

    expect(onNotification).toHaveBeenCalledWith({
      method: 'turn/started',
      params: { threadId: 't1' }
    });
  });

  it('times out pending requests', async () => {
    vi.useFakeTimers();

    const input = new PassThrough();
    const output = new PassThrough();
    const client = new JsonRpcClient(input, output);
    const promise = client.request('slow', undefined, 50);
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'request_timeout'
    } satisfies Partial<JsonRpcClientError>);

    await vi.advanceTimersByTimeAsync(60);

    await assertion;
  });
});
