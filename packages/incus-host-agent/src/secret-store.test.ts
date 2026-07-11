import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { EncryptedFileSecretStore } from './secret-store';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('EncryptedFileSecretStore', () => {
  it('round trips an encrypted secret without persisting plaintext', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rcd-secret-'));
    tempDirs.push(directory);
    const store = new EncryptedFileSecretStore(directory, Buffer.alloc(32, 7));
    const secret = 'sk-test-not-a-real-secret-123456789';
    const reference = await store.create(secret);
    const files = await fs.readdir(directory);
    const persisted = await fs.readFile(
      path.join(directory, files[0]!),
      'utf8',
    );

    expect(reference).toMatch(/^rcc_[A-Za-z0-9_-]{32}$/);
    expect(persisted).not.toContain(secret);
    expect(await store.read(reference)).toBe(secret);
    expect(await store.list()).toEqual([
      { credentialRef: reference, createdAt: expect.any(String) },
    ]);
    expect(await store.delete(reference)).toBe(true);
    expect(await store.list()).toEqual([]);
    expect(await store.delete(reference)).toBe(false);
  });

  it('rejects path traversal references', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rcd-secret-'));
    tempDirs.push(directory);
    const store = new EncryptedFileSecretStore(directory, Buffer.alloc(32, 7));
    await expect(store.read('../secret')).rejects.toThrow(
      'reference is invalid',
    );
  });

  it('ignores unrelated files when listing opaque references', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rcd-secret-'));
    tempDirs.push(directory);
    await fs.writeFile(path.join(directory, 'notes.txt'), 'ignored');
    await fs.writeFile(path.join(directory, 'rcc_invalid.json'), 'ignored');
    const store = new EncryptedFileSecretStore(directory, Buffer.alloc(32, 7));
    expect(await store.list()).toEqual([]);
  });
});
