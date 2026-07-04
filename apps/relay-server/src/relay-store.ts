import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type {
  CreateRelaySessionShareInput,
  RelayAdminSummaryDto,
  RelayCreateDeviceResultDto,
  RelayDeviceDto,
  RelayPortalSummaryDto,
  RelaySessionDto,
  RelaySessionShareAccessDto,
  RelaySessionShareDto,
  RelayThreadAccessDto,
  RelayUserDto,
  RelayUserRoleDto,
  RelayWorkspaceAccessDto,
} from '../../../packages/shared/src/index';

interface StoredUser extends RelayUserDto {
  passwordHash: string;
  passwordSalt: string;
}

interface StoredDevice {
  id: string;
  ownerUserId: string;
  name: string;
  token: string | null;
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

export type EffectiveRelayAccess =
  | {
      kind: 'owner';
      share: null;
      threadAccess: 'control';
      workspaceAccess: 'write';
      workspaceId: null;
    }
  | {
      kind: 'shared';
      share: RelaySessionShareDto;
      threadAccess: RelayThreadAccessDto;
      workspaceAccess: RelayWorkspaceAccessDto;
      workspaceId: string | null;
    };

export class RelayStore {
  private readonly sqlite: Database.Database;

  constructor(
    private readonly databasePath: string,
    private readonly sessionSecret: string,
    registrationEnabled: boolean,
    legacyJsonPath?: string,
  ) {
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.sqlite = new Database(this.databasePath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.migrate();
    this.importLegacyJson(legacyJsonPath);
    this.ensureRegistrationSetting(registrationEnabled);
  }

  static fromDataDir(dataDir: string, sessionSecret: string, registrationEnabled: boolean) {
    const resolvedDataDir = path.resolve(dataDir);
    return new RelayStore(
      path.join(resolvedDataDir, 'relay-store.sqlite'),
      sessionSecret,
      registrationEnabled,
      path.join(resolvedDataDir, 'relay-store.json'),
    );
  }

  seedAdmin(input: { username: string; email?: string; password: string }) {
    const existing = this.getUsers().find((user) => user.role === 'admin');
    if (existing) {
      return this.publicUser(existing);
    }

    const user = this.createStoredUser({
      email: input.email ?? `${normalizeUsername(input.username)}@relay.local`,
      username: input.username,
      password: input.password,
      role: 'admin',
    });
    this.insertUser(user);
    return this.publicUser(user);
  }

  register(input: { email: string; username: string; password: string }) {
    if (!this.registrationEnabled()) {
      throw new RelayStoreError(403, 'forbidden', 'Registration is currently disabled.');
    }

    const user = this.createStoredUser({
      email: input.email,
      username: input.username,
      password: input.password,
      role: 'user',
    });
    this.insertUser(user);
    return this.createLoginResult(user);
  }

  login(input: { identifier: string; password: string }) {
    const normalizedIdentifier = input.identifier.trim().toLowerCase();
    const user = this.getUserByIdentifier(normalizedIdentifier);
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
    const user = this.getUser(payload.userId);
    if (!user || !user.enabled) {
      return this.emptySession();
    }
    return {
      authenticated: true,
      user: this.publicUser(user),
      registrationEnabled: this.registrationEnabled(),
    };
  }

  createDevice(ownerUserId: string, input: { name: string }): RelayCreateDeviceResultDto {
    const user = this.requireUser(ownerUserId);
    const token = `rcd_${crypto.randomBytes(24).toString('base64url')}`;
    const device: StoredDevice = {
      id: crypto.randomUUID(),
      ownerUserId: user.id,
      name: input.name.trim() || 'Remote Codex device',
      token,
      tokenHash: sha256(token),
      tokenPreview: previewToken(token),
      createdAt: new Date().toISOString(),
    };
    this.insertDevice(device);
    return {
      device: this.publicDevice(device, null),
      token,
    };
  }

  deleteDevice(userId: string, deviceId: string) {
    const result = this.sqlite
      .prepare('DELETE FROM relay_devices WHERE id = ? AND owner_user_id = ?')
      .run(deviceId, userId);
    if (result.changes < 1) {
      throw new RelayStoreError(404, 'not_found', 'Device was not found.');
    }
  }

  verifyDeviceToken(token: string | null) {
    if (!token) {
      return null;
    }
    const tokenHash = sha256(token);
    return this.rowToDevice(
      this.sqlite.prepare('SELECT * FROM relay_devices WHERE token_hash = ?').get(tokenHash) as DeviceRow | undefined,
    );
  }

  createShare(ownerUserId: string, input: CreateRelaySessionShareInput) {
    const owner = this.requireUser(ownerUserId);
    const device = this.getDevice(input.deviceId);
    if (!device || device.ownerUserId !== ownerUserId) {
      throw new RelayStoreError(404, 'not_found', 'Device was not found.');
    }
    const target = this.getUserByIdentifier(input.targetIdentifier);
    if (!target || !target.enabled) {
      throw new RelayStoreError(404, 'not_found', 'Target user was not found.');
    }
    if (target.id === ownerUserId) {
      throw new RelayStoreError(400, 'bad_request', 'You cannot share a session with yourself.');
    }

    const existing = this.rowToShare(
      this.sqlite
        .prepare(
          `
            SELECT * FROM relay_shares
            WHERE owner_user_id = ?
              AND target_user_id = ?
              AND device_id = ?
              AND thread_id = ?
              AND revoked_at IS NULL
          `,
        )
        .get(ownerUserId, target.id, input.deviceId, input.threadId) as ShareRow | undefined,
    );
    if (existing) {
      return this.updateShare(existing.id, {
        label: input.label?.trim() || null,
        workspaceId: input.workspaceId?.trim() || null,
        threadAccess: normalizeThreadAccess(input.threadAccess),
        workspaceAccess: normalizeWorkspaceAccess(input.workspaceAccess),
        expiresAt: normalizeExpiresAt(input.expiresAt),
      });
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
      workspaceId: input.workspaceId?.trim() || null,
      label: input.label?.trim() || null,
      threadAccess: normalizeThreadAccess(input.threadAccess),
      workspaceAccess: normalizeWorkspaceAccess(input.workspaceAccess),
      createdAt: new Date().toISOString(),
      revokedAt: null,
      expiresAt: normalizeExpiresAt(input.expiresAt),
      lastAccessedAt: null,
      lastAccessedByUsername: null,
      accessEvents: [],
    };
    this.insertShare(share);
    return share;
  }

  revokeShare(userId: string, shareId: string) {
    const share = this.rowToShare(
      this.sqlite
        .prepare('SELECT * FROM relay_shares WHERE id = ? AND owner_user_id = ?')
        .get(shareId, userId) as ShareRow | undefined,
    );
    if (!share) {
      throw new RelayStoreError(404, 'not_found', 'Share was not found.');
    }
    const revokedAt = new Date().toISOString();
    this.sqlite
      .prepare('UPDATE relay_shares SET revoked_at = ? WHERE id = ?')
      .run(revokedAt, shareId);
    return { ...share, revokedAt };
  }

  effectiveAccess(userId: string, deviceId: string, scope: {
    threadId?: string | null;
    workspaceId?: string | null;
  } = {}): EffectiveRelayAccess | null {
    const owned = this.sqlite
      .prepare('SELECT 1 FROM relay_devices WHERE id = ? AND owner_user_id = ?')
      .get(deviceId, userId);
    if (owned) {
      return {
        kind: 'owner',
        share: null,
        threadAccess: 'control',
        workspaceAccess: 'write',
        workspaceId: null,
      };
    }

    const now = new Date().toISOString();
    if (scope.threadId) {
      const share = this.rowToShare(
        this.sqlite
          .prepare(
            `
              SELECT * FROM relay_shares
              WHERE target_user_id = ?
                AND device_id = ?
                AND thread_id = ?
                AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > ?)
              ORDER BY created_at DESC
              LIMIT 1
            `,
          )
          .get(userId, deviceId, scope.threadId, now) as ShareRow | undefined,
      );
      if (!share) {
        return null;
      }
      if (
        scope.workspaceId &&
        (!share.workspaceId || share.workspaceId !== scope.workspaceId || share.workspaceAccess === 'none')
      ) {
        return null;
      }
      return {
        kind: 'shared',
        share,
        threadAccess: share.threadAccess,
        workspaceAccess: share.workspaceAccess,
        workspaceId: share.workspaceId,
      };
    }

    if (scope.workspaceId) {
      const share = this.rowToShare(
        this.sqlite
          .prepare(
            `
              SELECT * FROM relay_shares
              WHERE target_user_id = ?
                AND device_id = ?
                AND workspace_id = ?
                AND workspace_access <> 'none'
                AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > ?)
              ORDER BY
                CASE workspace_access WHEN 'write' THEN 2 WHEN 'read' THEN 1 ELSE 0 END DESC,
                created_at DESC
              LIMIT 1
            `,
          )
          .get(userId, deviceId, scope.workspaceId, now) as ShareRow | undefined,
      );
      if (!share) {
        return null;
      }
      return {
        kind: 'shared',
        share,
        threadAccess: share.threadAccess,
        workspaceAccess: share.workspaceAccess,
        workspaceId: share.workspaceId,
      };
    }

    return null;
  }

  canAccessDevice(userId: string, deviceId: string, threadId?: string | null) {
    return Boolean(
      this.effectiveAccess(userId, deviceId, {
        threadId: threadId ?? null,
      }),
    );
  }

  portalSummary(userId: string, connectedDevices: Map<string, DeviceConnectionStatus>): RelayPortalSummaryDto {
    const user = this.requireUser(userId);
    const devices = this.getDevicesByOwner(userId);
    const sharedWithMe = this.getSharesByTarget(userId);
    const sharedByMe = this.getSharesByOwner(userId);
    return {
      user: this.publicUser(user),
      devices: devices.map((device) => this.publicDevice(device, connectedDevices.get(device.id) ?? null)),
      sharedWithMe: sharedWithMe.map((share) => this.publicShare(share)),
      sharedByMe: sharedByMe.map((share) => this.publicShare(share)),
    };
  }

  adminSummary(connectedDevices: Map<string, DeviceConnectionStatus>): RelayAdminSummaryDto {
    return {
      users: this.getUsers().map((user) => this.publicUser(user)),
      devices: this.getDevices().map((device) =>
        this.publicDevice(device, connectedDevices.get(device.id) ?? null),
      ),
      registrationEnabled: this.registrationEnabled(),
    };
  }

  setRegistrationEnabled(enabled: boolean) {
    this.setSetting('registrationEnabled', enabled ? 'true' : 'false');
    return enabled;
  }

  setUserEnabled(userId: string, enabled: boolean) {
    const user = this.requireUser(userId);
    if (user.role === 'admin' && !enabled) {
      throw new RelayStoreError(400, 'bad_request', 'The admin user cannot be disabled.');
    }
    this.sqlite.prepare('UPDATE relay_users SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, userId);
    return this.publicUser({ ...user, enabled });
  }

  updateAccount(userId: string, input: { username?: string }) {
    const user = this.requireUser(userId);
    const username =
      input.username !== undefined ? normalizeUsername(input.username) : user.username;
    if (username.length < 3) {
      throw new RelayStoreError(400, 'bad_request', 'Username must be at least 3 characters.');
    }
    const existingUsername = this.getUserByUsername(username);
    if (existingUsername && existingUsername.id !== user.id) {
      throw new RelayStoreError(409, 'conflict', 'A user with that username already exists.');
    }
    this.sqlite
      .prepare('UPDATE relay_users SET username = ? WHERE id = ?')
      .run(username, user.id);
    return this.publicUser({ ...user, username });
  }

  updatePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
  ) {
    const user = this.requireUser(userId);
    if (!verifySecret(input.currentPassword, user.passwordSalt, user.passwordHash)) {
      throw new RelayStoreError(403, 'forbidden', 'Current password is incorrect.');
    }
    if (input.newPassword.length < 8) {
      throw new RelayStoreError(400, 'bad_request', 'Password must be at least 8 characters.');
    }
    const passwordSalt = crypto.randomBytes(16).toString('base64url');
    const passwordHash = hashSecret(input.newPassword, passwordSalt);
    this.sqlite
      .prepare('UPDATE relay_users SET password_salt = ?, password_hash = ? WHERE id = ?')
      .run(passwordSalt, passwordHash, user.id);
    return this.publicUser({
      ...user,
      passwordSalt,
      passwordHash,
    });
  }

  emptySession(): RelaySessionDto {
    return {
      authenticated: false,
      user: null,
      registrationEnabled: this.registrationEnabled(),
    };
  }

  publicDevice(device: StoredDevice, status: DeviceConnectionStatus | null): RelayDeviceDto {
    return {
      id: device.id,
      ownerUserId: device.ownerUserId,
      name: device.name,
      token: device.token,
      tokenPreview: device.tokenPreview,
      connected: Boolean(status?.connected),
      connectedAt: status?.connectedAt ?? null,
      lastHeartbeatAt: status?.lastHeartbeatAt ?? null,
      createdAt: device.createdAt,
    };
  }

  recordShareAccess(share: RelaySessionShareDto, user: RelayUserDto) {
    if (share.revokedAt || (share.expiresAt && share.expiresAt <= new Date().toISOString())) {
      return;
    }
    const accessedAt = new Date().toISOString();
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_share_access_events (
            id, share_id, user_id, username, accessed_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(crypto.randomUUID(), share.id, user.id, user.username, accessedAt);
  }

  private publicShare(share: RelaySessionShareDto): RelaySessionShareDto {
    const owner = this.getUser(share.ownerUserId);
    const target = this.getUser(share.targetUserId);
    const device = this.getDevice(share.deviceId);
    const accessEvents = this.getShareAccessEvents(share.id);
    const lastAccess = accessEvents[0] ?? null;
    return {
      ...share,
      ownerUsername: share.ownerUsername ?? owner?.username ?? 'unknown',
      targetUsername: share.targetUsername ?? target?.username ?? 'unknown',
      deviceName: share.deviceName ?? device?.name ?? 'Remote Codex device',
      lastAccessedAt: lastAccess?.accessedAt ?? null,
      lastAccessedByUsername: lastAccess?.username ?? null,
      accessEvents,
    };
  }

  private migrate() {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS relay_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relay_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relay_devices (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token TEXT,
        token_hash TEXT NOT NULL UNIQUE,
        token_preview TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS relay_devices_owner_idx ON relay_devices(owner_user_id);

      CREATE TABLE IF NOT EXISTS relay_shares (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        owner_username TEXT,
        target_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        target_username TEXT,
        device_id TEXT NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
        device_name TEXT,
        thread_id TEXT NOT NULL,
        workspace_id TEXT,
        label TEXT,
        thread_access TEXT NOT NULL DEFAULT 'control',
        workspace_access TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        expires_at TEXT
      );

      CREATE INDEX IF NOT EXISTS relay_shares_owner_idx ON relay_shares(owner_user_id);
      CREATE INDEX IF NOT EXISTS relay_shares_target_idx ON relay_shares(target_user_id);
      CREATE INDEX IF NOT EXISTS relay_shares_device_thread_idx ON relay_shares(device_id, thread_id);

      CREATE TABLE IF NOT EXISTS relay_share_access_events (
        id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL REFERENCES relay_shares(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        accessed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS relay_share_access_events_share_idx ON relay_share_access_events(share_id, accessed_at DESC);
    `);
    this.ensureColumn('relay_devices', 'token', 'TEXT');
    this.ensureColumn('relay_shares', 'workspace_id', 'TEXT');
    this.ensureColumn('relay_shares', 'thread_access', "TEXT NOT NULL DEFAULT 'control'");
    this.ensureColumn('relay_shares', 'workspace_access', "TEXT NOT NULL DEFAULT 'none'");
    this.ensureColumn('relay_shares', 'expires_at', 'TEXT');
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((existing) => existing.name === column)) {
      return;
    }
    this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private importLegacyJson(legacyJsonPath?: string) {
    if (!legacyJsonPath || !fs.existsSync(legacyJsonPath)) {
      return;
    }
    const existingUsers = this.sqlite.prepare('SELECT COUNT(*) AS count FROM relay_users').get() as { count: number };
    const imported = this.getSetting('legacyJsonImported');
    if (existingUsers.count > 0 || imported === legacyJsonPath) {
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf8')) as Partial<RelayStoreData>;
    const data: RelayStoreData = {
      registrationEnabled: typeof parsed.registrationEnabled === 'boolean' ? parsed.registrationEnabled : true,
      users: Array.isArray(parsed.users) ? parsed.users : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      shares: Array.isArray(parsed.shares) ? parsed.shares : [],
    };
    const importData = this.sqlite.transaction(() => {
      this.setSetting('registrationEnabled', data.registrationEnabled ? 'true' : 'false');
      for (const user of data.users) {
        this.insertUser(user);
      }
      for (const device of data.devices) {
        this.insertDevice(device);
      }
      for (const share of data.shares) {
        this.insertShare(share);
      }
      this.setSetting('legacyJsonImported', legacyJsonPath);
    });
    importData();
  }

  private ensureRegistrationSetting(registrationEnabled: boolean) {
    if (this.getSetting('registrationEnabled') === null) {
      this.setSetting('registrationEnabled', registrationEnabled ? 'true' : 'false');
    }
  }

  private registrationEnabled() {
    return this.getSetting('registrationEnabled') !== 'false';
  }

  private getSetting(key: string) {
    const row = this.sqlite.prepare('SELECT value FROM relay_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  private setSetting(key: string, value: string) {
    this.sqlite
      .prepare('INSERT INTO relay_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
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
    if (this.getUserByIdentifier(email) || this.getUserByUsername(username)) {
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
        registrationEnabled: this.registrationEnabled(),
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
    const user = this.getUser(userId);
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

  private insertUser(user: StoredUser) {
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_users (
            id, email, username, role, enabled, created_at, password_salt, password_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        user.id,
        user.email,
        user.username,
        user.role,
        user.enabled ? 1 : 0,
        user.createdAt,
        user.passwordSalt,
        user.passwordHash,
      );
  }

  private insertDevice(device: StoredDevice) {
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_devices (
            id, owner_user_id, name, token, token_hash, token_preview, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        device.id,
        device.ownerUserId,
        device.name,
        device.token ?? null,
        device.tokenHash,
        device.tokenPreview,
        device.createdAt,
      );
  }

  private insertShare(share: RelaySessionShareDto) {
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_shares (
            id, owner_user_id, owner_username, target_user_id, target_username,
            device_id, device_name, thread_id, workspace_id, label,
            thread_access, workspace_access, created_at, revoked_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        share.id,
        share.ownerUserId,
        share.ownerUsername,
        share.targetUserId,
        share.targetUsername,
        share.deviceId,
        share.deviceName,
        share.threadId,
        share.workspaceId,
        share.label,
        share.threadAccess,
        share.workspaceAccess,
        share.createdAt,
        share.revokedAt,
        share.expiresAt,
      );
  }

  private getShareAccessEvents(shareId: string): RelaySessionShareAccessDto[] {
    return (
      this.sqlite
        .prepare(
          `
            SELECT * FROM relay_share_access_events
            WHERE share_id = ?
            ORDER BY accessed_at DESC
            LIMIT 8
          `,
        )
        .all(shareId) as ShareAccessRow[]
    ).map((row) => ({
      id: row.id,
      shareId: row.share_id,
      userId: row.user_id,
      username: row.username,
      accessedAt: row.accessed_at,
    }));
  }

  private updateShare(
    shareId: string,
    input: {
      label: string | null;
      workspaceId: string | null;
      threadAccess: RelayThreadAccessDto;
      workspaceAccess: RelayWorkspaceAccessDto;
      expiresAt: string | null;
    },
  ) {
    this.sqlite
      .prepare(
        `
          UPDATE relay_shares
          SET label = ?,
              workspace_id = ?,
              thread_access = ?,
              workspace_access = ?,
              expires_at = ?
          WHERE id = ?
        `,
      )
      .run(
        input.label,
        input.workspaceId,
        input.threadAccess,
        input.workspaceAccess,
        input.expiresAt,
        shareId,
      );
    return this.rowToShare(
      this.sqlite.prepare('SELECT * FROM relay_shares WHERE id = ?').get(shareId) as ShareRow | undefined,
    )!;
  }

  private getUser(id: string) {
    return this.rowToUser(this.sqlite.prepare('SELECT * FROM relay_users WHERE id = ?').get(id) as UserRow | undefined);
  }

  private getUserByIdentifier(identifier: string) {
    return this.rowToUser(
      this.sqlite
        .prepare('SELECT * FROM relay_users WHERE email = ? OR username = ?')
        .get(identifier.toLowerCase(), identifier.toLowerCase()) as UserRow | undefined,
    );
  }

  private getUserByUsername(username: string) {
    return this.rowToUser(
      this.sqlite
        .prepare('SELECT * FROM relay_users WHERE username = ?')
        .get(normalizeUsername(username)) as UserRow | undefined,
    );
  }

  private getUsers() {
    return (this.sqlite.prepare('SELECT * FROM relay_users ORDER BY created_at ASC').all() as UserRow[])
      .map((row) => this.rowToUser(row))
      .filter((user): user is StoredUser => Boolean(user));
  }

  private getDevice(id: string) {
    return this.rowToDevice(this.sqlite.prepare('SELECT * FROM relay_devices WHERE id = ?').get(id) as DeviceRow | undefined);
  }

  private getDevices() {
    return (this.sqlite.prepare('SELECT * FROM relay_devices ORDER BY created_at ASC').all() as DeviceRow[])
      .map((row) => this.rowToDevice(row))
      .filter((device): device is StoredDevice => Boolean(device));
  }

  private getDevicesByOwner(ownerUserId: string) {
    return (this.sqlite.prepare('SELECT * FROM relay_devices WHERE owner_user_id = ? ORDER BY created_at ASC').all(ownerUserId) as DeviceRow[])
      .map((row) => this.rowToDevice(row))
      .filter((device): device is StoredDevice => Boolean(device));
  }

  private getSharesByOwner(ownerUserId: string) {
    return (this.sqlite.prepare("SELECT * FROM relay_shares WHERE owner_user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC").all(ownerUserId, new Date().toISOString()) as ShareRow[])
      .map((row) => this.rowToShare(row))
      .filter((share): share is RelaySessionShareDto => Boolean(share));
  }

  private getSharesByTarget(targetUserId: string) {
    return (this.sqlite.prepare("SELECT * FROM relay_shares WHERE target_user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC").all(targetUserId, new Date().toISOString()) as ShareRow[])
      .map((row) => this.rowToShare(row))
      .filter((share): share is RelaySessionShareDto => Boolean(share));
  }

  private rowToUser(row?: UserRow): StoredUser | null {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      username: row.username,
      role: row.role,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      passwordSalt: row.password_salt,
      passwordHash: row.password_hash,
    };
  }

  private rowToDevice(row?: DeviceRow): StoredDevice | null {
    if (!row) return null;
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      name: row.name,
      token: row.token ?? null,
      tokenHash: row.token_hash,
      tokenPreview: row.token_preview,
      createdAt: row.created_at,
    };
  }

  private rowToShare(row?: ShareRow): RelaySessionShareDto | null {
    if (!row) return null;
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      ownerUsername: row.owner_username ?? 'unknown',
      targetUserId: row.target_user_id,
      targetUsername: row.target_username ?? 'unknown',
      deviceId: row.device_id,
      deviceName: row.device_name ?? 'Remote Codex device',
      threadId: row.thread_id,
      workspaceId: row.workspace_id ?? null,
      label: row.label,
      threadAccess: normalizeThreadAccess(row.thread_access),
      workspaceAccess: normalizeWorkspaceAccess(row.workspace_access),
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      expiresAt: row.expires_at ?? null,
      lastAccessedAt: null,
      lastAccessedByUsername: null,
      accessEvents: [],
    };
  }
}

interface UserRow {
  id: string;
  email: string;
  username: string;
  role: RelayUserRoleDto;
  enabled: number;
  created_at: string;
  password_salt: string;
  password_hash: string;
}

interface DeviceRow {
  id: string;
  owner_user_id: string;
  name: string;
  token: string | null;
  token_hash: string;
  token_preview: string;
  created_at: string;
}

interface ShareRow {
  id: string;
  owner_user_id: string;
  owner_username: string | null;
  target_user_id: string;
  target_username: string | null;
  device_id: string;
  device_name: string | null;
  thread_id: string;
  workspace_id: string | null;
  label: string | null;
  thread_access: string | null;
  workspace_access: string | null;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
}

interface ShareAccessRow {
  id: string;
  share_id: string;
  user_id: string;
  username: string;
  accessed_at: string;
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

function normalizeThreadAccess(value: string | null | undefined): RelayThreadAccessDto {
  return value === 'read' ? 'read' : 'control';
}

function normalizeWorkspaceAccess(value: string | null | undefined): RelayWorkspaceAccessDto {
  if (value === 'read' || value === 'write') {
    return value;
  }
  return 'none';
}

function normalizeExpiresAt(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
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
