import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type {
  RelayAdminSummaryDto,
  RelayCreateDeviceResultDto,
  RelayDeviceDto,
  RelayPortalSummaryDto,
  RelaySessionDto,
  RelaySessionShareDto,
  RelayUserDto,
  RelayUserRoleDto,
} from '../../../packages/shared/src/index';

interface StoredUser extends RelayUserDto {
  passwordHash: string;
  passwordSalt: string;
}

interface StoredDevice {
  id: string;
  ownerUserId: string;
  name: string;
  tokenHash: string;
  tokenPreview: string;
  createdAt: string;
}

interface RelayStoreData {
  registrationEnabled: boolean;
  users: StoredUser[];
  devices: StoredDevice[];
  shares: RelaySessionShareDto[];
}

interface SessionPayload {
  userId: string;
  expiresAt: number;
  nonce: string;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export class RelayStore {
  private data: RelayStoreData;

  constructor(
    private readonly filePath: string,
    private readonly sessionSecret: string,
    registrationEnabled: boolean,
  ) {
    this.data = this.readData(registrationEnabled);
  }

  static fromDataDir(dataDir: string, sessionSecret: string, registrationEnabled: boolean) {
    return new RelayStore(
      path.join(path.resolve(dataDir), 'relay-store.json'),
      sessionSecret,
      registrationEnabled,
    );
  }

  seedAdmin(input: { username: string; email?: string; password: string }) {
    const username = normalizeUsername(input.username);
    const existing = this.data.users.find((user) => user.role === 'admin');
    if (existing) {
      return this.publicUser(existing);
    }

    const user = this.createStoredUser({
      email: input.email ?? `${username}@relay.local`,
      username,
      password: input.password,
      role: 'admin',
    });
    this.data.users.push(user);
    void this.persist();
    return this.publicUser(user);
  }

  register(input: { email: string; username: string; password: string }) {
    if (!this.data.registrationEnabled) {
      throw new RelayStoreError(403, 'forbidden', 'Registration is currently disabled.');
    }

    const user = this.createStoredUser({
      email: input.email,
      username: input.username,
      password: input.password,
      role: 'user',
    });
    this.data.users.push(user);
    void this.persist();
    return this.createLoginResult(user);
  }

  login(input: { identifier: string; password: string }) {
    const normalizedIdentifier = input.identifier.trim().toLowerCase();
    const user = this.data.users.find(
      (entry) =>
        entry.email.toLowerCase() === normalizedIdentifier ||
        entry.username.toLowerCase() === normalizedIdentifier,
    );
    if (!user || !user.enabled) {
      throw new RelayStoreError(401, 'unauthorized', 'Invalid username or password.');
    }
    if (!verifySecret(input.password, user.passwordSalt, user.passwordHash)) {
      throw new RelayStoreError(401, 'unauthorized', 'Invalid username or password.');
    }

    return this.createLoginResult(user);
  }

  verifySession(token: string | null): RelaySessionDto {
    if (!token) {
      return this.emptySession();
    }
    const payload = this.verifyToken(token);
    if (!payload) {
      return this.emptySession();
    }
    const user = this.data.users.find((entry) => entry.id === payload.userId);
    if (!user || !user.enabled) {
      return this.emptySession();
    }
    return {
      authenticated: true,
      user: this.publicUser(user),
      registrationEnabled: this.data.registrationEnabled,
    };
  }

  createDevice(ownerUserId: string, input: { name: string }): RelayCreateDeviceResultDto {
    const user = this.requireUser(ownerUserId);
    const token = `rcd_${crypto.randomBytes(24).toString('base64url')}`;
    const device: StoredDevice = {
      id: crypto.randomUUID(),
      ownerUserId: user.id,
      name: input.name.trim() || 'Remote Codex device',
      tokenHash: sha256(token),
      tokenPreview: previewToken(token),
      createdAt: new Date().toISOString(),
    };
    this.data.devices.push(device);
    void this.persist();
    return {
      device: this.publicDevice(device, null),
      token,
    };
  }

  deleteDevice(userId: string, deviceId: string) {
    const index = this.data.devices.findIndex(
      (device) => device.id === deviceId && device.ownerUserId === userId,
    );
    if (index < 0) {
      throw new RelayStoreError(404, 'not_found', 'Device was not found.');
    }
    this.data.devices.splice(index, 1);
    this.data.shares = this.data.shares.filter((share) => share.deviceId !== deviceId);
    void this.persist();
  }

  verifyDeviceToken(token: string | null) {
    if (!token) {
      return null;
    }
    const tokenHash = sha256(token);
    return this.data.devices.find((device) => device.tokenHash === tokenHash) ?? null;
  }

  createShare(ownerUserId: string, input: {
    targetUsername: string;
    deviceId: string;
    threadId: string;
    label?: string | null;
  }) {
    const owner = this.requireUser(ownerUserId);
    const device = this.data.devices.find(
      (entry) => entry.id === input.deviceId && entry.ownerUserId === ownerUserId,
    );
    if (!device) {
      throw new RelayStoreError(404, 'not_found', 'Device was not found.');
    }
    const target = this.data.users.find(
      (entry) => entry.username.toLowerCase() === input.targetUsername.trim().toLowerCase(),
    );
    if (!target || !target.enabled) {
      throw new RelayStoreError(404, 'not_found', 'Target user was not found.');
    }
    if (target.id === ownerUserId) {
      throw new RelayStoreError(400, 'bad_request', 'You cannot share a session with yourself.');
    }

    const existing = this.data.shares.find(
      (share) =>
        share.ownerUserId === ownerUserId &&
        share.targetUserId === target.id &&
        share.deviceId === input.deviceId &&
        share.threadId === input.threadId &&
        !share.revokedAt,
    );
    if (existing) {
      return existing;
    }

    const share: RelaySessionShareDto = {
      id: crypto.randomUUID(),
      ownerUserId,
      ownerUsername: owner.username,
      targetUserId: target.id,
      targetUsername: target.username,
      deviceId: input.deviceId,
      deviceName: device.name,
      threadId: input.threadId,
      label: input.label?.trim() || null,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.data.shares.push(share);
    void this.persist();
    return share;
  }

  revokeShare(userId: string, shareId: string) {
    const share = this.data.shares.find(
      (entry) => entry.id === shareId && entry.ownerUserId === userId,
    );
    if (!share) {
      throw new RelayStoreError(404, 'not_found', 'Share was not found.');
    }
    share.revokedAt = new Date().toISOString();
    void this.persist();
    return share;
  }

  canAccessDevice(userId: string, deviceId: string, threadId?: string | null) {
    const owned = this.data.devices.some(
      (device) => device.id === deviceId && device.ownerUserId === userId,
    );
    if (owned) {
      return true;
    }
    if (!threadId) {
      return false;
    }
    return this.data.shares.some(
      (share) =>
        share.targetUserId === userId &&
        share.deviceId === deviceId &&
        !share.revokedAt &&
        share.threadId === threadId,
    );
  }

  portalSummary(userId: string, connectedDevices: Map<string, DeviceConnectionStatus>): RelayPortalSummaryDto {
    const user = this.requireUser(userId);
    return {
      user: this.publicUser(user),
      devices: this.data.devices
        .filter((device) => device.ownerUserId === userId)
        .map((device) => this.publicDevice(device, connectedDevices.get(device.id) ?? null)),
      sharedWithMe: this.data.shares.filter(
        (share) => share.targetUserId === userId && !share.revokedAt,
      ).map((share) => this.publicShare(share)),
      sharedByMe: this.data.shares.filter(
        (share) => share.ownerUserId === userId && !share.revokedAt,
      ).map((share) => this.publicShare(share)),
    };
  }

  adminSummary(connectedDevices: Map<string, DeviceConnectionStatus>): RelayAdminSummaryDto {
    return {
      users: this.data.users.map((user) => this.publicUser(user)),
      devices: this.data.devices.map((device) =>
        this.publicDevice(device, connectedDevices.get(device.id) ?? null),
      ),
      registrationEnabled: this.data.registrationEnabled,
    };
  }

  setRegistrationEnabled(enabled: boolean) {
    this.data.registrationEnabled = enabled;
    void this.persist();
    return enabled;
  }

  setUserEnabled(userId: string, enabled: boolean) {
    const user = this.requireUser(userId);
    if (user.role === 'admin' && !enabled) {
      throw new RelayStoreError(400, 'bad_request', 'The admin user cannot be disabled.');
    }
    user.enabled = enabled;
    void this.persist();
    return this.publicUser(user);
  }

  emptySession(): RelaySessionDto {
    return {
      authenticated: false,
      user: null,
      registrationEnabled: this.data.registrationEnabled,
    };
  }

  publicDevice(device: StoredDevice, status: DeviceConnectionStatus | null): RelayDeviceDto {
    return {
      id: device.id,
      ownerUserId: device.ownerUserId,
      name: device.name,
      tokenPreview: device.tokenPreview,
      connected: Boolean(status?.connected),
      connectedAt: status?.connectedAt ?? null,
      lastHeartbeatAt: status?.lastHeartbeatAt ?? null,
      createdAt: device.createdAt,
    };
  }

  private publicShare(share: RelaySessionShareDto): RelaySessionShareDto {
    const owner = this.data.users.find((user) => user.id === share.ownerUserId);
    const target = this.data.users.find((user) => user.id === share.targetUserId);
    const device = this.data.devices.find((entry) => entry.id === share.deviceId);
    return {
      ...share,
      ownerUsername: share.ownerUsername ?? owner?.username ?? 'unknown',
      targetUsername: share.targetUsername ?? target?.username ?? 'unknown',
      deviceName: share.deviceName ?? device?.name ?? 'Remote Codex device',
    };
  }

  private createStoredUser(input: {
    email: string;
    username: string;
    password: string;
    role: RelayUserRoleDto;
  }): StoredUser {
    const email = input.email.trim().toLowerCase();
    const username = normalizeUsername(input.username);
    if (!email.includes('@')) {
      throw new RelayStoreError(400, 'bad_request', 'A valid email address is required.');
    }
    if (username.length < 3) {
      throw new RelayStoreError(400, 'bad_request', 'Username must be at least 3 characters.');
    }
    if (input.password.length < 8) {
      throw new RelayStoreError(400, 'bad_request', 'Password must be at least 8 characters.');
    }
    if (
      this.data.users.some(
        (user) => user.email.toLowerCase() === email || user.username.toLowerCase() === username,
      )
    ) {
      throw new RelayStoreError(409, 'conflict', 'A user with that email or username already exists.');
    }
    const passwordSalt = crypto.randomBytes(16).toString('base64url');
    return {
      id: crypto.randomUUID(),
      email,
      username,
      role: input.role,
      enabled: true,
      createdAt: new Date().toISOString(),
      passwordSalt,
      passwordHash: hashSecret(input.password, passwordSalt),
    };
  }

  private createLoginResult(user: StoredUser) {
    const token = this.signSession(user.id);
    return {
      token,
      session: {
        authenticated: true,
        user: this.publicUser(user),
        registrationEnabled: this.data.registrationEnabled,
      },
    };
  }

  private signSession(userId: string) {
    const payload = {
      userId,
      expiresAt: Date.now() + SESSION_TTL_MS,
      nonce: crypto.randomBytes(16).toString('base64url'),
    } satisfies SessionPayload;
    const payloadText = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(payloadText)
      .digest('base64url');
    return `${payloadText}.${signature}`;
  }

  private verifyToken(token: string): SessionPayload | null {
    const [payloadText, signature, extra] = token.split('.');
    if (!payloadText || !signature || extra !== undefined) {
      return null;
    }
    const expected = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(payloadText)
      .digest('base64url');
    if (!safeEqual(signature, expected)) {
      return null;
    }
    try {
      const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8'));
      if (
        typeof payload?.userId !== 'string' ||
        typeof payload?.expiresAt !== 'number' ||
        typeof payload?.nonce !== 'string' ||
        payload.expiresAt <= Date.now()
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private requireUser(userId: string) {
    const user = this.data.users.find((entry) => entry.id === userId);
    if (!user) {
      throw new RelayStoreError(404, 'not_found', 'User was not found.');
    }
    return user;
  }

  private publicUser(user: StoredUser): RelayUserDto {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      enabled: user.enabled,
      createdAt: user.createdAt,
    };
  }

  private readData(registrationEnabled: boolean): RelayStoreData {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as RelayStoreData;
      return {
        registrationEnabled:
          typeof parsed.registrationEnabled === 'boolean'
            ? parsed.registrationEnabled
            : registrationEnabled,
        users: Array.isArray(parsed.users) ? parsed.users : [],
        devices: Array.isArray(parsed.devices) ? parsed.devices : [],
        shares: Array.isArray(parsed.shares) ? parsed.shares : [],
      };
    } catch {
      return {
        registrationEnabled,
        users: [],
        devices: [],
        shares: [],
      };
    }
  }

  private async persist() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
  }
}

export interface DeviceConnectionStatus {
  connected: boolean;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
}

export class RelayStoreError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function hashSecret(secret: string, salt: string) {
  return crypto.scryptSync(secret, salt, 32).toString('base64url');
}

function verifySecret(secret: string, salt: string, hash: string) {
  return safeEqual(hashSecret(secret, salt), hash);
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function previewToken(token: string) {
  return `${token.slice(0, 7)}...${token.slice(-4)}`;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
