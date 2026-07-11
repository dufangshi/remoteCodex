import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const referencePattern = /^rcc_[A-Za-z0-9_-]{32}$/;

export interface CredentialSecretStore {
  create(secret: string): Promise<string>;
  read(reference: string): Promise<string>;
  delete(reference: string): Promise<boolean>;
  list(): Promise<Array<{ credentialRef: string; createdAt: string }>>;
}

export class EncryptedFileSecretStore implements CredentialSecretStore {
  constructor(
    private readonly directory: string,
    private readonly key: Buffer,
  ) {
    if (key.length !== 32) {
      throw new Error('Credential master key must be 32 bytes.');
    }
  }

  async create(secret: string): Promise<string> {
    const reference = `rcc_${crypto.randomBytes(24).toString('base64url')}`;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const payload = JSON.stringify({
      version: 1,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    });
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const destination = this.file(reference);
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, payload, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, destination);
    return reference;
  }

  async read(reference: string): Promise<string> {
    const parsed = JSON.parse(
      await fs.readFile(this.file(reference), 'utf8'),
    ) as {
      version: number;
      iv: string;
      tag: string;
      ciphertext: string;
    };
    if (parsed.version !== 1) {
      throw new Error('Unsupported credential secret version.');
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(parsed.iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  async delete(reference: string): Promise<boolean> {
    try {
      await fs.unlink(this.file(reference));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async list(): Promise<Array<{ credentialRef: string; createdAt: string }>> {
    let names: string[];
    try {
      names = await fs.readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    const references = names
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((reference) => referencePattern.test(reference));
    return Promise.all(
      references.map(async (reference) => ({
        credentialRef: reference,
        createdAt: (
          await fs.stat(this.file(reference))
        ).birthtime.toISOString(),
      })),
    );
  }

  private file(reference: string) {
    if (!referencePattern.test(reference)) {
      throw new Error('Credential reference is invalid.');
    }
    return path.join(this.directory, `${reference}.json`);
  }
}

export const credentialReferencePattern = referencePattern;
