import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type {
  CreateRelayAccessGrantInput,
  CreateRelaySessionShareInput,
  RelayAccessEventKindDto,
  RelayAccessGrantDto,
  RelayAccessGrantEventDto,
  RelayAdminDeviceDto,
  RelayAdminSummaryDto,
  RelayAdminThreadDto,
  RelayAdminUserDto,
  RelayAdminWorkspaceDto,
  RelayCreateDeviceResultDto,
  RelayDeviceDto,
  RelayHostedSandboxDetailDto,
  RelayHostedCodexConfigDto,
  RelayHostedSandboxDto,
  RelayHostedSandboxOperationActionDto,
  RelayHostedSandboxOperationDto,
  RelayHostedSandboxOperationStatusDto,
  RelayHostedSandboxStatusDto,
  RelayPendingRegistrationDto,
  RelayPortalSummaryDto,
  RelayRegistrationSettingsDto,
  RelaySessionDto,
  RelaySessionShareAccessDto,
  RelaySessionShareDto,
  RelayShareScopeDto,
  RelayThreadAccessDto,
  RelayUserDto,
  RelayUserRoleDto,
  RelayWorkspaceAccessDto,
  RelayWorkspaceScopeDto,
  UpdateRelayAccessGrantInput,
  UpdateRelaySessionShareInput,
} from '../../../packages/shared/src/index';

interface StoredUser extends RelayUserDto {
  passwordHash: string;
  passwordSalt: string;
  lastSeenAt: string | null;
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

interface HostedSandboxProvisionContext {
  sandbox: RelayHostedSandboxDto;
  deviceToken: string;
  credentialRef: string;
  codexConfig: RelayHostedCodexConfigDto;
}

interface RelayStoreData {
  registrationEnabled: boolean;
  users: StoredUser[];
  devices: StoredDevice[];
  shares: RelaySessionShareDto[];
  grants?: RelayAccessGrantDto[];
}

interface SessionPayload {
  userId: string;
  expiresAt: number;
  nonce: string;
}

interface PendingRegistrationRecord {
  id: string;
  email: string;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedAt: string | null;
  reviewedByUserId: string | null;
}

export interface RelayAdminMetadata {
  workspacesByDeviceId?: Map<string, RelayAdminWorkspaceDto[]>;
  threadsByDeviceId?: Map<string, RelayAdminThreadDto[]>;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type EffectiveRelayAccess =
  | {
      kind: 'owner';
      share: null;
      grant: null;
      scope: 'owner';
      threadAccess: 'control';
      workspaceAccess: 'write';
      workspaceId: null;
      workspaceScope: null;
      canCreateThreads: true;
    }
  | {
      kind: 'shared';
      share: RelaySessionShareDto | null;
      grant: RelayAccessGrantDto;
      scope: RelayShareScopeDto;
      threadAccess: RelayThreadAccessDto;
      workspaceAccess: RelayWorkspaceAccessDto;
      workspaceId: string | null;
      workspaceScope: RelayWorkspaceScopeDto;
      canCreateThreads: boolean;
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

  static fromDataDir(
    dataDir: string,
    sessionSecret: string,
    registrationEnabled: boolean,
  ) {
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
      throw new RelayStoreError(
        403,
        'forbidden',
        'Registration is currently disabled.',
      );
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

  requestRegistrationApproval(input: {
    email: string;
    username: string;
    password: string;
  }) {
    if (!this.registrationEnabled()) {
      throw new RelayStoreError(
        403,
        'forbidden',
        'Registration is currently disabled.',
      );
    }
    const email = input.email.trim().toLowerCase();
    const username = normalizeUsername(input.username);
    if (!email.includes('@')) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'A valid email address is required.',
      );
    }
    if (username.length < 3) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'Username must be at least 3 characters.',
      );
    }
    if (input.password.length < 8) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'Password must be at least 8 characters.',
      );
    }
    if (this.getUserByIdentifier(email) || this.getUserByUsername(username)) {
      throw new RelayStoreError(
        409,
        'conflict',
        'A user with that email or username already exists.',
      );
    }
    const existing = this.rowToPendingRegistration(
      this.sqlite
        .prepare(
          `
            SELECT * FROM relay_pending_registrations
            WHERE status = 'pending'
              AND (email = ? OR username = ?)
            ORDER BY created_at DESC
            LIMIT 1
          `,
        )
        .get(email, username) as PendingRegistrationRow | undefined,
    );
    if (existing) {
      return this.publicPendingRegistration(existing);
    }
    const passwordSalt = crypto.randomBytes(16).toString('base64url');
    const record: PendingRegistrationRecord = {
      id: crypto.randomUUID(),
      email,
      username,
      passwordSalt,
      passwordHash: hashSecret(input.password, passwordSalt),
      createdAt: new Date().toISOString(),
      status: 'pending',
      reviewedAt: null,
      reviewedByUserId: null,
    };
    this.insertPendingRegistration(record);
    return this.publicPendingRegistration(record);
  }

  login(input: { identifier: string; password: string }) {
    const normalizedIdentifier = input.identifier.trim().toLowerCase();
    const user = this.getUserByIdentifier(normalizedIdentifier);
    if (!user || !user.enabled) {
      throw new RelayStoreError(
        401,
        'unauthorized',
        'Invalid username or password.',
      );
    }
    if (!verifySecret(input.password, user.passwordSalt, user.passwordHash)) {
      throw new RelayStoreError(
        401,
        'unauthorized',
        'Invalid username or password.',
      );
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

  createDevice(
    ownerUserId: string,
    input: { name: string },
  ): RelayCreateDeviceResultDto {
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

  createHostedSandboxRequested(input: {
    createdByAdminUserId: string;
    assignedUserId: string;
    deviceName: string;
    imageVersion: string;
    resources: { cpuCount: number; memoryMiB: number; diskGiB: number };
    credentialRef: string;
    codexConfig?: RelayHostedCodexConfigDto;
  }) {
    this.requireUser(input.createdByAdminUserId);
    this.requireUser(input.assignedUserId);
    const sandboxId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const now = new Date().toISOString();
    let deviceResult: RelayCreateDeviceResultDto | null = null;
    const create = this.sqlite.transaction(() => {
      deviceResult = this.createDevice(input.assignedUserId, {
        name: input.deviceName,
      });
      this.sqlite
        .prepare(
          `
            INSERT INTO relay_hosted_sandboxes (
              id, device_id, assigned_user_id, created_by_admin_user_id,
              provider, provider_instance_id, image_version,
              cpu_count, memory_mib, disk_gib, status, credential_ref,
              codex_config_json,
              last_error_code, last_error_message, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'incus', NULL, ?, ?, ?, ?, 'requested', ?, ?, NULL, NULL, ?, ?)
          `,
        )
        .run(
          sandboxId,
          deviceResult.device.id,
          input.assignedUserId,
          input.createdByAdminUserId,
          input.imageVersion,
          input.resources.cpuCount,
          input.resources.memoryMiB,
          input.resources.diskGiB,
          input.credentialRef,
          JSON.stringify(input.codexConfig ?? parseHostedCodexConfig(null)),
          now,
          now,
        );
      this.insertHostedOperation({
        id: operationId,
        sandboxId,
        action: 'create',
        status: 'pending',
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    create();
    const context = this.getHostedProvisionContext(sandboxId);
    if (!context || !deviceResult) {
      throw new Error('Hosted sandbox transaction did not persist.');
    }
    return {
      sandbox: this.getHostedSandboxDetail(sandboxId)!,
      operation: this.getHostedOperation(operationId)!,
      deviceToken: context.deviceToken,
    };
  }

  listHostedSandboxes(): RelayHostedSandboxDto[] {
    return (
      this.sqlite
        .prepare(
          'SELECT * FROM relay_hosted_sandboxes ORDER BY created_at DESC',
        )
        .all() as HostedSandboxRow[]
    ).map((row) => this.rowToHostedSandbox(row));
  }

  listHostedProviderRecords(): Array<{
    id: string;
    credentialRef: string;
  }> {
    return (
      this.sqlite
        .prepare(
          'SELECT id, credential_ref FROM relay_hosted_sandboxes ORDER BY id',
        )
        .all() as Array<{ id: string; credential_ref: string }>
    ).map((row) => ({ id: row.id, credentialRef: row.credential_ref }));
  }

  getHostedSandboxDetail(id: string): RelayHostedSandboxDetailDto | null {
    const row = this.sqlite
      .prepare('SELECT * FROM relay_hosted_sandboxes WHERE id = ?')
      .get(id) as HostedSandboxRow | undefined;
    if (!row) {
      return null;
    }
    return {
      ...this.rowToHostedSandbox(row),
      operations: this.getHostedOperations(id),
    };
  }

  getHostedProvisionContext(id: string): HostedSandboxProvisionContext | null {
    const row = this.sqlite
      .prepare(
        `
          SELECT hs.*, d.token AS device_token
          FROM relay_hosted_sandboxes hs
          JOIN relay_devices d ON d.id = hs.device_id
          WHERE hs.id = ?
        `,
      )
      .get(id) as
      | (HostedSandboxRow & { device_token: string | null })
      | undefined;
    if (!row || !row.device_token) {
      return null;
    }
    return {
      sandbox: this.rowToHostedSandbox(row),
      deviceToken: row.device_token,
      credentialRef: row.credential_ref,
      codexConfig: parseHostedCodexConfig(row.codex_config_json),
    };
  }

  listHostedSandboxesNeedingReconciliation() {
    return (
      this.sqlite
        .prepare(
          `
          SELECT id FROM relay_hosted_sandboxes
          WHERE status IN ('requested', 'creating', 'starting', 'provisioning')
          ORDER BY created_at ASC
        `,
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id);
  }

  updateHostedSandboxStatus(
    id: string,
    status: RelayHostedSandboxStatusDto,
    options: {
      providerInstanceId?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    } = {},
  ) {
    const result = this.sqlite
      .prepare(
        `
          UPDATE relay_hosted_sandboxes
          SET status = ?,
              provider_instance_id = COALESCE(?, provider_instance_id),
              last_error_code = ?,
              last_error_message = ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        status,
        options.providerInstanceId ?? null,
        options.errorCode ?? null,
        options.errorMessage ?? null,
        new Date().toISOString(),
        id,
      );
    if (result.changes < 1) {
      throw new RelayStoreError(
        404,
        'not_found',
        'Hosted sandbox was not found.',
      );
    }
  }

  updateHostedOperation(
    id: string,
    status: RelayHostedSandboxOperationStatusDto,
    error?: { code: string; message: string } | null,
  ) {
    const result = this.sqlite
      .prepare(
        `
          UPDATE relay_hosted_operations
          SET status = ?, error_code = ?, error_message = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        status,
        error?.code ?? null,
        error?.message ?? null,
        new Date().toISOString(),
        id,
      );
    if (result.changes < 1) {
      throw new RelayStoreError(
        404,
        'not_found',
        'Hosted operation was not found.',
      );
    }
  }

  createHostedOperation(
    sandboxId: string,
    action: RelayHostedSandboxOperationActionDto,
  ) {
    if (!this.getHostedSandboxDetail(sandboxId)) {
      throw new RelayStoreError(
        404,
        'not_found',
        'Hosted sandbox was not found.',
      );
    }
    const now = new Date().toISOString();
    const operation: RelayHostedSandboxOperationDto = {
      id: crypto.randomUUID(),
      sandboxId,
      action,
      status: 'pending',
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.insertHostedOperation(operation);
    return operation;
  }

  markHostedDeviceOnline(deviceId: string) {
    this.sqlite
      .prepare(
        `
          UPDATE relay_hosted_sandboxes
          SET status = 'online', last_error_code = NULL,
              last_error_message = NULL, updated_at = ?
          WHERE device_id = ? AND status != 'deleting'
        `,
      )
      .run(new Date().toISOString(), deviceId);
  }

  getHostedSandboxByDeviceId(deviceId: string) {
    const row = this.sqlite
      .prepare('SELECT * FROM relay_hosted_sandboxes WHERE device_id = ?')
      .get(deviceId) as HostedSandboxRow | undefined;
    return row ? this.rowToHostedSandbox(row) : null;
  }

  recordHostedUserActivity(deviceId: string, idleTimeoutMs: number) {
    const row = this.sqlite
      .prepare('SELECT * FROM relay_hosted_sandboxes WHERE device_id = ?')
      .get(deviceId) as HostedSandboxRow | undefined;
    if (!row) return null;
    const now = new Date();
    const deadline =
      row.active_turn_count === 0
        ? new Date(now.getTime() + idleTimeoutMs).toISOString()
        : null;
    this.sqlite
      .prepare(
        `
          UPDATE relay_hosted_sandboxes
          SET last_user_activity_at = ?, idle_deadline_at = ?,
              lifecycle_generation = lifecycle_generation + 1, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(now.toISOString(), deadline, now.toISOString(), row.id);
    return this.getHostedSandboxDetail(row.id)!;
  }

  recordHostedTurnActivity(input: {
    deviceId: string;
    threadId: string;
    turnId: string;
    kind: 'turn_started' | 'turn_terminal';
    idleTimeoutMs: number;
  }) {
    const row = this.sqlite
      .prepare('SELECT * FROM relay_hosted_sandboxes WHERE device_id = ?')
      .get(input.deviceId) as HostedSandboxRow | undefined;
    if (!row) return null;
    const update = this.sqlite.transaction(() => {
      if (input.kind === 'turn_started') {
        this.sqlite
          .prepare(
            `
              INSERT OR IGNORE INTO relay_hosted_active_turns (
                sandbox_id, thread_id, turn_id, started_at
              ) VALUES (?, ?, ?, ?)
            `,
          )
          .run(row.id, input.threadId, input.turnId, new Date().toISOString());
      } else {
        this.sqlite
          .prepare(
            `
              DELETE FROM relay_hosted_active_turns
              WHERE sandbox_id = ? AND thread_id = ? AND turn_id = ?
            `,
          )
          .run(row.id, input.threadId, input.turnId);
      }
      const active = this.sqlite
        .prepare(
          'SELECT COUNT(*) AS count FROM relay_hosted_active_turns WHERE sandbox_id = ?',
        )
        .get(row.id) as { count: number };
      const now = new Date();
      const deadline =
        active.count === 0
          ? new Date(now.getTime() + input.idleTimeoutMs).toISOString()
          : null;
      this.sqlite
        .prepare(
          `
            UPDATE relay_hosted_sandboxes
            SET active_turn_count = ?, idle_deadline_at = ?,
                lifecycle_generation = lifecycle_generation + 1, updated_at = ?
            WHERE id = ?
          `,
        )
        .run(active.count, deadline, now.toISOString(), row.id);
    });
    update();
    return this.getHostedSandboxDetail(row.id)!;
  }

  armHostedIdleDeadline(id: string, idleTimeoutMs: number) {
    const now = new Date();
    this.sqlite
      .prepare(
        `
          UPDATE relay_hosted_sandboxes
          SET idle_deadline_at = ?, lifecycle_generation = lifecycle_generation + 1,
              updated_at = ?
          WHERE id = ? AND active_turn_count = 0
        `,
      )
      .run(
        new Date(now.getTime() + idleTimeoutMs).toISOString(),
        now.toISOString(),
        id,
      );
    return this.getHostedSandboxDetail(id);
  }

  listHostedIdleDeadlines() {
    return (
      this.sqlite
        .prepare(
          `
          SELECT id, idle_deadline_at, lifecycle_generation
          FROM relay_hosted_sandboxes
          WHERE idle_deadline_at IS NOT NULL AND active_turn_count = 0
            AND status = 'online'
        `,
        )
        .all() as Array<{
        id: string;
        idle_deadline_at: string;
        lifecycle_generation: number;
      }>
    ).map((row) => ({
      id: row.id,
      deadlineAt: row.idle_deadline_at,
      generation: row.lifecycle_generation,
    }));
  }

  claimHostedIdleStop(id: string, generation: number, now: Date) {
    const result = this.sqlite
      .prepare(
        `
          UPDATE relay_hosted_sandboxes
          SET status = 'stopping', idle_deadline_at = NULL,
              lifecycle_generation = lifecycle_generation + 1, updated_at = ?
          WHERE id = ? AND lifecycle_generation = ? AND active_turn_count = 0
            AND status = 'online' AND idle_deadline_at <= ?
        `,
      )
      .run(now.toISOString(), id, generation, now.toISOString());
    return result.changes === 1;
  }

  deleteDevice(userId: string, deviceId: string) {
    const hosted = this.sqlite
      .prepare('SELECT id FROM relay_hosted_sandboxes WHERE device_id = ?')
      .get(deviceId) as { id: string } | undefined;
    if (hosted) {
      throw new RelayStoreError(
        409,
        'conflict',
        'Hosted devices must be deleted from the Hosted supervisor VM admin panel.',
      );
    }
    const result = this.sqlite
      .prepare('DELETE FROM relay_devices WHERE id = ? AND owner_user_id = ?')
      .run(deviceId, userId);
    if (result.changes < 1) {
      throw new RelayStoreError(404, 'not_found', 'Device was not found.');
    }
  }

  deleteHostedSandboxRecord(id: string) {
    const context = this.getHostedProvisionContext(id);
    if (!context) {
      throw new RelayStoreError(
        404,
        'not_found',
        'Hosted sandbox was not found.',
      );
    }
    const remove = this.sqlite.transaction(() => {
      this.sqlite
        .prepare('DELETE FROM relay_hosted_sandboxes WHERE id = ?')
        .run(id);
      this.sqlite
        .prepare('DELETE FROM relay_devices WHERE id = ?')
        .run(context.sandbox.deviceId);
    });
    remove();
    return {
      id,
      deviceId: context.sandbox.deviceId,
      credentialRef: context.credentialRef,
    };
  }

  replaceHostedCredentialRef(id: string, credentialRef: string) {
    const context = this.getHostedProvisionContext(id);
    if (!context) {
      throw new RelayStoreError(
        404,
        'not_found',
        'Hosted sandbox was not found.',
      );
    }
    this.sqlite
      .prepare(
        'UPDATE relay_hosted_sandboxes SET credential_ref = ?, updated_at = ? WHERE id = ?',
      )
      .run(credentialRef, new Date().toISOString(), id);
    return context.credentialRef;
  }

  verifyDeviceToken(token: string | null) {
    if (!token) {
      return null;
    }
    const tokenHash = sha256(token);
    return this.rowToDevice(
      this.sqlite
        .prepare('SELECT * FROM relay_devices WHERE token_hash = ?')
        .get(tokenHash) as DeviceRow | undefined,
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
      throw new RelayStoreError(
        400,
        'bad_request',
        'You cannot share a session with yourself.',
      );
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
        .get(ownerUserId, target.id, input.deviceId, input.threadId) as
        | ShareRow
        | undefined,
    );
    if (existing) {
      return this.updateShareRecord(existing.id, {
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
      threadTitle: null,
      workspaceId: input.workspaceId?.trim() || null,
      workspaceLabel: null,
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

  createGrant(ownerUserId: string, input: CreateRelayAccessGrantInput) {
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
      throw new RelayStoreError(
        400,
        'bad_request',
        'You cannot share access with yourself.',
      );
    }

    const scope = normalizeShareScope(input.scope);
    const threadId = scope === 'thread' ? input.threadId?.trim() || null : null;
    const workspaceId =
      scope === 'workspace' ? input.workspaceId?.trim() || null : null;
    if (scope === 'thread' && !threadId) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'threadId is required for thread grants.',
      );
    }
    if (scope === 'workspace' && !workspaceId) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'workspaceId is required for workspace grants.',
      );
    }

    const existing = this.rowToGrant(
      this.sqlite
        .prepare(
          `
            SELECT * FROM relay_access_grants
            WHERE owner_user_id = ?
              AND target_user_id = ?
              AND device_id = ?
              AND scope = ?
              AND COALESCE(thread_id, '') = COALESCE(?, '')
              AND COALESCE(workspace_id, '') = COALESCE(?, '')
              AND revoked_at IS NULL
          `,
        )
        .get(
          ownerUserId,
          target.id,
          input.deviceId,
          scope,
          threadId,
          workspaceId,
        ) as GrantRow | undefined,
    );
    if (existing) {
      return this.updateGrantRecord(existing.id, {
        label: input.label?.trim() || null,
        workspaceScope: normalizeWorkspaceScope(input.workspaceScope),
        workspaceIds: normalizeWorkspaceIds(input.workspaceIds),
        threadAccess: normalizeThreadAccess(input.threadAccess),
        workspaceAccess: normalizeWorkspaceAccess(input.workspaceAccess),
        canCreateThreads: Boolean(input.canCreateThreads),
        expiresAt: normalizeExpiresAt(input.expiresAt),
      });
    }

    const grant: RelayAccessGrantDto = {
      id: crypto.randomUUID(),
      ownerUserId,
      ownerUsername: owner.username,
      targetUserId: target.id,
      targetUsername: target.username,
      deviceId: input.deviceId,
      deviceName: device.name,
      scope,
      threadId,
      threadTitle: null,
      workspaceId,
      workspaceLabel: null,
      workspaceScope: normalizeWorkspaceScope(input.workspaceScope),
      workspaceIds: normalizeWorkspaceIds(input.workspaceIds),
      label: input.label?.trim() || null,
      threadAccess: normalizeThreadAccess(input.threadAccess),
      workspaceAccess: normalizeWorkspaceAccess(input.workspaceAccess),
      canCreateThreads: Boolean(input.canCreateThreads),
      createdAt: new Date().toISOString(),
      revokedAt: null,
      expiresAt: normalizeExpiresAt(input.expiresAt),
      lastAccessedAt: null,
      lastAccessedByUsername: null,
      accessEvents: [],
    };
    this.insertGrant(grant);
    return grant;
  }

  updateShare(
    userId: string,
    shareId: string,
    input: UpdateRelaySessionShareInput,
  ) {
    const share = this.rowToShare(
      this.sqlite
        .prepare(
          'SELECT * FROM relay_shares WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL',
        )
        .get(shareId, userId) as ShareRow | undefined,
    );
    if (!share) {
      throw new RelayStoreError(404, 'not_found', 'Share was not found.');
    }
    return this.publicShare(
      this.updateShareRecord(shareId, {
        label:
          input.label !== undefined ? input.label?.trim() || null : share.label,
        workspaceId:
          input.workspaceId !== undefined
            ? input.workspaceId?.trim() || null
            : share.workspaceId,
        threadAccess:
          input.threadAccess !== undefined
            ? normalizeThreadAccess(input.threadAccess)
            : share.threadAccess,
        workspaceAccess:
          input.workspaceAccess !== undefined
            ? normalizeWorkspaceAccess(input.workspaceAccess)
            : share.workspaceAccess,
        expiresAt:
          input.expiresAt !== undefined
            ? normalizeExpiresAt(input.expiresAt)
            : share.expiresAt,
      }),
    );
  }

  revokeShare(userId: string, shareId: string) {
    const share = this.rowToShare(
      this.sqlite
        .prepare(
          'SELECT * FROM relay_shares WHERE id = ? AND owner_user_id = ?',
        )
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

  updateGrant(
    userId: string,
    grantId: string,
    input: UpdateRelayAccessGrantInput,
  ) {
    const grant = this.rowToGrant(
      this.sqlite
        .prepare(
          'SELECT * FROM relay_access_grants WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL',
        )
        .get(grantId, userId) as GrantRow | undefined,
    );
    if (!grant) {
      throw new RelayStoreError(404, 'not_found', 'Grant was not found.');
    }
    return this.publicGrant(
      this.updateGrantRecord(grantId, {
        label:
          input.label !== undefined ? input.label?.trim() || null : grant.label,
        workspaceScope:
          input.workspaceScope !== undefined
            ? normalizeWorkspaceScope(input.workspaceScope)
            : grant.workspaceScope,
        workspaceIds:
          input.workspaceIds !== undefined
            ? normalizeWorkspaceIds(input.workspaceIds)
            : grant.workspaceIds,
        threadAccess:
          input.threadAccess !== undefined
            ? normalizeThreadAccess(input.threadAccess)
            : grant.threadAccess,
        workspaceAccess:
          input.workspaceAccess !== undefined
            ? normalizeWorkspaceAccess(input.workspaceAccess)
            : grant.workspaceAccess,
        canCreateThreads:
          input.canCreateThreads !== undefined
            ? Boolean(input.canCreateThreads)
            : grant.canCreateThreads,
        expiresAt:
          input.expiresAt !== undefined
            ? normalizeExpiresAt(input.expiresAt)
            : grant.expiresAt,
      }),
    );
  }

  revokeGrant(userId: string, grantId: string) {
    const grant = this.rowToGrant(
      this.sqlite
        .prepare(
          'SELECT * FROM relay_access_grants WHERE id = ? AND owner_user_id = ?',
        )
        .get(grantId, userId) as GrantRow | undefined,
    );
    if (!grant) {
      throw new RelayStoreError(404, 'not_found', 'Grant was not found.');
    }
    const revokedAt = new Date().toISOString();
    this.sqlite
      .prepare('UPDATE relay_access_grants SET revoked_at = ? WHERE id = ?')
      .run(revokedAt, grantId);
    return { ...grant, revokedAt };
  }

  effectiveAccess(
    userId: string,
    deviceId: string,
    scope: {
      threadId?: string | null;
      workspaceId?: string | null;
    } = {},
  ): EffectiveRelayAccess | null {
    const owned = this.sqlite
      .prepare('SELECT 1 FROM relay_devices WHERE id = ? AND owner_user_id = ?')
      .get(deviceId, userId);
    if (owned) {
      return {
        kind: 'owner',
        share: null,
        grant: null,
        scope: 'owner',
        threadAccess: 'control',
        workspaceAccess: 'write',
        workspaceId: null,
        workspaceScope: null,
        canCreateThreads: true,
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
      if (share) {
        if (
          scope.workspaceId &&
          (!share.workspaceId ||
            share.workspaceId !== scope.workspaceId ||
            share.workspaceAccess === 'none')
        ) {
          const grant = this.findBestGrant(userId, deviceId, scope);
          return grant ? this.accessFromGrant(grant) : null;
        }
        return {
          kind: 'shared',
          share,
          grant: this.grantFromShare(share),
          scope: 'thread',
          threadAccess: share.threadAccess,
          workspaceAccess: share.workspaceAccess,
          workspaceId: share.workspaceId,
          workspaceScope: 'selected',
          canCreateThreads: false,
        };
      }
      const grant = this.findBestGrant(userId, deviceId, scope);
      return grant ? this.accessFromGrant(grant) : null;
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
          .get(userId, deviceId, scope.workspaceId, now) as
          | ShareRow
          | undefined,
      );
      if (share) {
        return {
          kind: 'shared',
          share,
          grant: this.grantFromShare(share),
          scope: 'thread',
          threadAccess: share.threadAccess,
          workspaceAccess: share.workspaceAccess,
          workspaceId: share.workspaceId,
          workspaceScope: 'selected',
          canCreateThreads: false,
        };
      }
      const grant = this.findBestGrant(userId, deviceId, scope);
      return grant ? this.accessFromGrant(grant) : null;
    }

    const grant = this.findBestGrant(userId, deviceId, scope);
    return grant ? this.accessFromGrant(grant) : null;
  }

  canAccessDevice(userId: string, deviceId: string, threadId?: string | null) {
    return Boolean(
      this.effectiveAccess(userId, deviceId, {
        threadId: threadId ?? null,
      }),
    );
  }

  portalSummary(
    userId: string,
    connectedDevices: Map<string, DeviceConnectionStatus>,
  ): RelayPortalSummaryDto {
    const user = this.requireUser(userId);
    const devices = this.getDevicesByOwner(userId);
    const sharedWithMe = this.getSharesByTarget(userId);
    const sharedByMe = this.getSharesByOwner(userId);
    const grantsWithMe = this.getGrantsByTarget(userId);
    const grantsByMe = this.getGrantsByOwner(userId);
    return {
      user: this.publicUser(user),
      devices: devices.map((device) =>
        this.publicDevice(device, connectedDevices.get(device.id) ?? null),
      ),
      sharedWithMe: sharedWithMe.map((share) => this.publicShare(share)),
      sharedByMe: sharedByMe.map((share) => this.publicShare(share)),
      sharedDevicesWithMe: grantsWithMe
        .filter((grant) => grant.scope === 'device')
        .map((grant) => this.publicGrant(grant)),
      sharedThreadsWithMe: [
        ...sharedWithMe.map((share) =>
          this.publicGrant(this.grantFromShare(share)),
        ),
        ...grantsWithMe
          .filter((grant) => grant.scope !== 'device')
          .map((grant) => this.publicGrant(grant)),
      ],
      grantsByMe: [
        ...sharedByMe.map((share) =>
          this.publicGrant(this.grantFromShare(share)),
        ),
        ...grantsByMe.map((grant) => this.publicGrant(grant)),
      ],
    };
  }

  sharedThreadsForDevice(userId: string, deviceId: string) {
    return this.getSharesByTarget(userId)
      .filter((share) => share.deviceId === deviceId)
      .map((share) => this.publicShare(share));
  }

  adminSummary(
    connectedDevices: Map<string, DeviceConnectionStatus>,
    options: {
      conversationWindowDays?: number;
      metadata?: RelayAdminMetadata;
    } = {},
  ): RelayAdminSummaryDto {
    const conversationWindowDays = normalizeConversationWindowDays(
      options.conversationWindowDays,
    );
    const users = this.getUsers();
    const devices = this.getDevices();
    const deviceCounts = new Map<string, number>();
    for (const device of devices) {
      deviceCounts.set(
        device.ownerUserId,
        (deviceCounts.get(device.ownerUserId) ?? 0) + 1,
      );
    }
    const conversationCounts = this.conversationCountsByUser(
      conversationWindowDays,
    );
    return {
      users: users.map((user) =>
        this.publicAdminUser(
          user,
          deviceCounts.get(user.id) ?? 0,
          conversationCounts.get(user.id) ?? 0,
        ),
      ),
      devices: devices.map((device) => {
        const owner = users.find((user) => user.id === device.ownerUserId);
        return this.publicAdminDevice(
          device,
          connectedDevices.get(device.id) ?? null,
          owner,
          options.metadata,
        );
      }),
      shares: this.getShares({ includeRevoked: true }).map((share) =>
        this.publicShare(share),
      ),
      pendingRegistrations: this.pendingRegistrations(),
      settings: this.registrationSettings(),
      conversationWindowDays,
      registrationEnabled: this.registrationEnabled(),
    };
  }

  setRegistrationEnabled(enabled: boolean) {
    this.setSetting('registrationEnabled', enabled ? 'true' : 'false');
    return enabled;
  }

  registrationSettings(): RelayRegistrationSettingsDto {
    return {
      enabled: this.registrationEnabled(),
      registrationPassword: this.getSetting('registrationPassword'),
      approvalRequired:
        this.getSetting('registrationApprovalRequired') === 'true',
    };
  }

  updateRegistrationSettings(input: Partial<RelayRegistrationSettingsDto>) {
    if (input.enabled !== undefined) {
      this.setRegistrationEnabled(input.enabled);
    }
    if (input.registrationPassword !== undefined) {
      const password = input.registrationPassword?.trim() || null;
      if (password !== null && password.length < 8) {
        throw new RelayStoreError(
          400,
          'bad_request',
          'Registration password must be at least 8 characters.',
        );
      }
      if (password === null) {
        this.deleteSetting('registrationPassword');
      } else {
        this.setSetting('registrationPassword', password);
      }
    }
    if (input.approvalRequired !== undefined) {
      this.setSetting(
        'registrationApprovalRequired',
        input.approvalRequired ? 'true' : 'false',
      );
    }
    return this.registrationSettings();
  }

  ensureRegistrationPassword(password: string | null) {
    if (!password || this.getSetting('registrationPassword') !== null) {
      return;
    }
    this.setSetting('registrationPassword', password);
  }

  approvePendingRegistration(adminUserId: string, requestId: string) {
    const record = this.requirePendingRegistration(requestId);
    const user: StoredUser = {
      id: crypto.randomUUID(),
      email: record.email,
      username: record.username,
      role: 'user',
      enabled: true,
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
      passwordSalt: record.passwordSalt,
      passwordHash: record.passwordHash,
    };
    const approve = this.sqlite.transaction(() => {
      this.insertUser(user);
      this.sqlite
        .prepare(
          `
            UPDATE relay_pending_registrations
            SET status = 'approved', reviewed_at = ?, reviewed_by_user_id = ?
            WHERE id = ?
          `,
        )
        .run(new Date().toISOString(), adminUserId, requestId);
    });
    approve();
    return this.publicUser(user);
  }

  rejectPendingRegistration(adminUserId: string, requestId: string) {
    this.requirePendingRegistration(requestId);
    this.sqlite
      .prepare(
        `
          UPDATE relay_pending_registrations
          SET status = 'rejected', reviewed_at = ?, reviewed_by_user_id = ?
          WHERE id = ?
        `,
      )
      .run(new Date().toISOString(), adminUserId, requestId);
    return { id: requestId };
  }

  recordUserSeen(userId: string, at = new Date().toISOString()) {
    this.sqlite
      .prepare('UPDATE relay_users SET last_seen_at = ? WHERE id = ?')
      .run(at, userId);
  }

  recordConversationEvent(input: {
    userId: string;
    deviceId: string;
    threadId: string | null;
    workspaceId: string | null;
  }) {
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_conversation_events (
            id, user_id, device_id, thread_id, workspace_id, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        crypto.randomUUID(),
        input.userId,
        input.deviceId,
        input.threadId,
        input.workspaceId,
        new Date().toISOString(),
      );
  }

  setUserEnabled(userId: string, enabled: boolean) {
    const user = this.requireUser(userId);
    if (user.role === 'admin' && !enabled) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'The admin user cannot be disabled.',
      );
    }
    this.sqlite
      .prepare('UPDATE relay_users SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, userId);
    return this.publicUser({ ...user, enabled });
  }

  deleteUser(userId: string) {
    const user = this.requireUser(userId);
    if (user.role === 'admin') {
      throw new RelayStoreError(
        400,
        'bad_request',
        'The admin user cannot be deleted.',
      );
    }
    this.sqlite.prepare('DELETE FROM relay_users WHERE id = ?').run(userId);
  }

  adminResetUserPassword(userId: string, password: string) {
    const user = this.requireUser(userId);
    if (user.role === 'admin') {
      throw new RelayStoreError(
        400,
        'bad_request',
        'The admin user password cannot be reset here.',
      );
    }
    if (password.length < 8) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'Password must be at least 8 characters.',
      );
    }
    const passwordSalt = crypto.randomBytes(16).toString('base64url');
    const passwordHash = hashSecret(password, passwordSalt);
    this.sqlite
      .prepare(
        'UPDATE relay_users SET password_salt = ?, password_hash = ? WHERE id = ?',
      )
      .run(passwordSalt, passwordHash, user.id);
    return this.publicUser({
      ...user,
      passwordSalt,
      passwordHash,
    });
  }

  updateAccount(userId: string, input: { username?: string }) {
    const user = this.requireUser(userId);
    const username =
      input.username !== undefined
        ? normalizeUsername(input.username)
        : user.username;
    if (username.length < 3) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'Username must be at least 3 characters.',
      );
    }
    const existingUsername = this.getUserByUsername(username);
    if (existingUsername && existingUsername.id !== user.id) {
      throw new RelayStoreError(
        409,
        'conflict',
        'A user with that username already exists.',
      );
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
    if (
      !verifySecret(input.currentPassword, user.passwordSalt, user.passwordHash)
    ) {
      throw new RelayStoreError(
        403,
        'forbidden',
        'Current password is incorrect.',
      );
    }
    if (input.newPassword.length < 8) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'Password must be at least 8 characters.',
      );
    }
    const passwordSalt = crypto.randomBytes(16).toString('base64url');
    const passwordHash = hashSecret(input.newPassword, passwordSalt);
    this.sqlite
      .prepare(
        'UPDATE relay_users SET password_salt = ?, password_hash = ? WHERE id = ?',
      )
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

  publicDevice(
    device: StoredDevice,
    status: DeviceConnectionStatus | null,
  ): RelayDeviceDto {
    const hosted = this.sqlite
      .prepare(
        `
          SELECT status, active_turn_count, idle_deadline_at
          FROM relay_hosted_sandboxes WHERE device_id = ?
        `,
      )
      .get(device.id) as
      | {
          status: RelayHostedSandboxStatusDto;
          active_turn_count: number;
          idle_deadline_at: string | null;
        }
      | undefined;
    return {
      id: device.id,
      ownerUserId: device.ownerUserId,
      name: device.name,
      token: hosted ? null : device.token,
      tokenPreview: device.tokenPreview,
      connected: Boolean(status?.connected),
      connectedAt: status?.connectedAt ?? null,
      lastHeartbeatAt: status?.lastHeartbeatAt ?? null,
      createdAt: device.createdAt,
      hostedStatus: hosted?.status ?? null,
      hostedActiveTurnCount: hosted?.active_turn_count ?? 0,
      hostedIdleDeadlineAt: hosted?.idle_deadline_at ?? null,
    };
  }

  private publicAdminUser(
    user: StoredUser,
    deviceCount: number,
    conversationCount: number,
  ): RelayAdminUserDto {
    return {
      ...this.publicUser(user),
      lastSeenAt: user.lastSeenAt,
      deviceCount,
      conversationCount,
    };
  }

  private publicAdminDevice(
    device: StoredDevice,
    status: DeviceConnectionStatus | null,
    owner: StoredUser | undefined,
    metadata: RelayAdminMetadata | undefined,
  ): RelayAdminDeviceDto {
    return {
      ...this.publicDevice(device, status),
      ownerUsername: owner?.username ?? 'unknown',
      ownerEmail: owner?.email ?? 'unknown',
      ipAddress: status?.ipAddress ?? null,
      workspaces: metadata?.workspacesByDeviceId?.get(device.id) ?? [],
      threads: metadata?.threadsByDeviceId?.get(device.id) ?? [],
    };
  }

  recordShareAccess(
    share: RelaySessionShareDto,
    user: RelayUserDto,
    kind: RelayAccessEventKindDto = 'access',
  ) {
    if (
      share.revokedAt ||
      (share.expiresAt && share.expiresAt <= new Date().toISOString())
    ) {
      return;
    }
    const accessedAt = new Date().toISOString();
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_share_access_events (
            id, share_id, user_id, username, kind, accessed_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        crypto.randomUUID(),
        share.id,
        user.id,
        user.username,
        kind,
        accessedAt,
      );
  }

  recordGrantAccess(
    grant: RelayAccessGrantDto,
    user: RelayUserDto,
    kind: RelayAccessEventKindDto = 'access',
  ) {
    if (
      grant.revokedAt ||
      (grant.expiresAt && grant.expiresAt <= new Date().toISOString())
    ) {
      return;
    }
    const accessedAt = new Date().toISOString();
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_access_grant_events (
            id, grant_id, user_id, username, kind, accessed_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        crypto.randomUUID(),
        grant.id,
        user.id,
        user.username,
        kind,
        accessedAt,
      );
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

  private publicGrant(grant: RelayAccessGrantDto): RelayAccessGrantDto {
    const owner = this.getUser(grant.ownerUserId);
    const target = this.getUser(grant.targetUserId);
    const device = this.getDevice(grant.deviceId);
    const accessEvents = this.getGrantAccessEvents(grant.id);
    const lastAccess = accessEvents[0] ?? null;
    return {
      ...grant,
      ownerUsername: grant.ownerUsername ?? owner?.username ?? 'unknown',
      targetUsername: grant.targetUsername ?? target?.username ?? 'unknown',
      deviceName: grant.deviceName ?? device?.name ?? 'Remote Codex device',
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
        last_seen_at TEXT,
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

      CREATE TABLE IF NOT EXISTS relay_hosted_sandboxes (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL UNIQUE REFERENCES relay_devices(id) ON DELETE CASCADE,
        assigned_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE RESTRICT,
        created_by_admin_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE RESTRICT,
        provider TEXT NOT NULL CHECK (provider IN ('incus')),
        provider_instance_id TEXT,
        image_version TEXT NOT NULL,
        cpu_count INTEGER NOT NULL,
        memory_mib INTEGER NOT NULL,
        disk_gib INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'requested', 'creating', 'starting', 'provisioning', 'stopped',
          'online', 'stopping', 'error', 'deleting'
        )),
        credential_ref TEXT NOT NULL,
        codex_config_json TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        active_turn_count INTEGER NOT NULL DEFAULT 0,
        last_user_activity_at TEXT,
        idle_deadline_at TEXT,
        lifecycle_generation INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS relay_hosted_sandboxes_assigned_idx
        ON relay_hosted_sandboxes(assigned_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS relay_hosted_sandboxes_status_idx
        ON relay_hosted_sandboxes(status, updated_at);

      CREATE TABLE IF NOT EXISTS relay_hosted_operations (
        id TEXT PRIMARY KEY,
        sandbox_id TEXT NOT NULL REFERENCES relay_hosted_sandboxes(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN (
          'create', 'start', 'stop', 'snapshot', 'delete', 'rotate_credential'
        )),
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS relay_hosted_operations_sandbox_idx
        ON relay_hosted_operations(sandbox_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS relay_hosted_active_turns (
        sandbox_id TEXT NOT NULL REFERENCES relay_hosted_sandboxes(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        PRIMARY KEY (sandbox_id, thread_id, turn_id)
      );

      CREATE TABLE IF NOT EXISTS relay_shares (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        owner_username TEXT,
        target_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        target_username TEXT,
        device_id TEXT NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
        device_name TEXT,
        thread_id TEXT NOT NULL,
        thread_title TEXT,
        workspace_id TEXT,
        workspace_label TEXT,
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
        kind TEXT NOT NULL DEFAULT 'access',
        accessed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS relay_share_access_events_share_idx ON relay_share_access_events(share_id, accessed_at DESC);

      CREATE TABLE IF NOT EXISTS relay_access_grants (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        owner_username TEXT,
        target_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        target_username TEXT,
        device_id TEXT NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
        device_name TEXT,
        scope TEXT NOT NULL CHECK (scope IN ('thread', 'workspace', 'device')),
        thread_id TEXT,
        thread_title TEXT,
        workspace_id TEXT,
        workspace_label TEXT,
        workspace_scope TEXT NOT NULL DEFAULT 'all',
        workspace_ids TEXT NOT NULL DEFAULT '[]',
        label TEXT,
        thread_access TEXT NOT NULL DEFAULT 'control',
        workspace_access TEXT NOT NULL DEFAULT 'none',
        can_create_threads INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        expires_at TEXT
      );

      CREATE INDEX IF NOT EXISTS relay_access_grants_owner_idx ON relay_access_grants(owner_user_id);
      CREATE INDEX IF NOT EXISTS relay_access_grants_target_idx ON relay_access_grants(target_user_id);
      CREATE INDEX IF NOT EXISTS relay_access_grants_device_scope_idx ON relay_access_grants(device_id, scope);

      CREATE TABLE IF NOT EXISTS relay_access_grant_events (
        id TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL REFERENCES relay_access_grants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'access',
        accessed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS relay_access_grant_events_grant_idx ON relay_access_grant_events(grant_id, accessed_at DESC);

      CREATE TABLE IF NOT EXISTS relay_conversation_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
        thread_id TEXT,
        workspace_id TEXT,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS relay_conversation_events_user_time_idx ON relay_conversation_events(user_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS relay_pending_registrations (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        username TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        reviewed_at TEXT,
        reviewed_by_user_id TEXT
      );

      CREATE INDEX IF NOT EXISTS relay_pending_registrations_status_idx ON relay_pending_registrations(status, created_at DESC);
    `);
    this.ensureColumn('relay_users', 'last_seen_at', 'TEXT');
    this.ensureColumn('relay_devices', 'token', 'TEXT');
    this.ensureColumn(
      'relay_hosted_sandboxes',
      'active_turn_count',
      'INTEGER NOT NULL DEFAULT 0',
    );
    this.ensureColumn(
      'relay_hosted_sandboxes',
      'last_user_activity_at',
      'TEXT',
    );
    this.ensureColumn('relay_hosted_sandboxes', 'idle_deadline_at', 'TEXT');
    this.ensureColumn(
      'relay_hosted_sandboxes',
      'lifecycle_generation',
      'INTEGER NOT NULL DEFAULT 0',
    );
    this.ensureColumn('relay_hosted_sandboxes', 'codex_config_json', 'TEXT');
    this.ensureColumn('relay_shares', 'thread_title', 'TEXT');
    this.ensureColumn('relay_shares', 'workspace_id', 'TEXT');
    this.ensureColumn('relay_shares', 'workspace_label', 'TEXT');
    this.ensureColumn(
      'relay_shares',
      'thread_access',
      "TEXT NOT NULL DEFAULT 'control'",
    );
    this.ensureColumn(
      'relay_shares',
      'workspace_access',
      "TEXT NOT NULL DEFAULT 'none'",
    );
    this.ensureColumn('relay_shares', 'expires_at', 'TEXT');
    this.ensureColumn(
      'relay_access_grants',
      'workspace_scope',
      "TEXT NOT NULL DEFAULT 'all'",
    );
    this.ensureColumn(
      'relay_access_grants',
      'workspace_ids',
      "TEXT NOT NULL DEFAULT '[]'",
    );
    this.ensureColumn(
      'relay_access_grants',
      'can_create_threads',
      'INTEGER NOT NULL DEFAULT 0',
    );
    this.ensureColumn(
      'relay_share_access_events',
      'kind',
      "TEXT NOT NULL DEFAULT 'access'",
    );
    this.ensureColumn(
      'relay_access_grant_events',
      'kind',
      "TEXT NOT NULL DEFAULT 'access'",
    );
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.sqlite
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (columns.some((existing) => existing.name === column)) {
      return;
    }
    this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private importLegacyJson(legacyJsonPath?: string) {
    if (!legacyJsonPath || !fs.existsSync(legacyJsonPath)) {
      return;
    }
    const existingUsers = this.sqlite
      .prepare('SELECT COUNT(*) AS count FROM relay_users')
      .get() as { count: number };
    const imported = this.getSetting('legacyJsonImported');
    if (existingUsers.count > 0 || imported === legacyJsonPath) {
      return;
    }

    const parsed = JSON.parse(
      fs.readFileSync(legacyJsonPath, 'utf8'),
    ) as Partial<RelayStoreData>;
    const data: RelayStoreData = {
      registrationEnabled:
        typeof parsed.registrationEnabled === 'boolean'
          ? parsed.registrationEnabled
          : true,
      users: Array.isArray(parsed.users) ? parsed.users : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      shares: Array.isArray(parsed.shares) ? parsed.shares : [],
    };
    const importData = this.sqlite.transaction(() => {
      this.setSetting(
        'registrationEnabled',
        data.registrationEnabled ? 'true' : 'false',
      );
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
      this.setSetting(
        'registrationEnabled',
        registrationEnabled ? 'true' : 'false',
      );
    }
  }

  private registrationEnabled() {
    return this.getSetting('registrationEnabled') !== 'false';
  }

  private getSetting(key: string) {
    const row = this.sqlite
      .prepare('SELECT value FROM relay_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setSetting(key: string, value: string) {
    this.sqlite
      .prepare(
        'INSERT INTO relay_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  private deleteSetting(key: string) {
    this.sqlite.prepare('DELETE FROM relay_settings WHERE key = ?').run(key);
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
      throw new RelayStoreError(
        400,
        'bad_request',
        'A valid email address is required.',
      );
    }
    if (username.length < 3) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'Username must be at least 3 characters.',
      );
    }
    if (input.password.length < 8) {
      throw new RelayStoreError(
        400,
        'bad_request',
        'Password must be at least 8 characters.',
      );
    }
    if (this.getUserByIdentifier(email) || this.getUserByUsername(username)) {
      throw new RelayStoreError(
        409,
        'conflict',
        'A user with that email or username already exists.',
      );
    }
    const passwordSalt = crypto.randomBytes(16).toString('base64url');
    return {
      id: crypto.randomUUID(),
      email,
      username,
      role: input.role,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
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
    const payloadText = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
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
      const payload = JSON.parse(
        Buffer.from(payloadText, 'base64url').toString('utf8'),
      );
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
            id, email, username, role, enabled, last_seen_at, created_at, password_salt, password_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        user.id,
        user.email,
        user.username,
        user.role,
        user.enabled ? 1 : 0,
        user.lastSeenAt,
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

  private insertHostedOperation(operation: RelayHostedSandboxOperationDto) {
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_hosted_operations (
            id, sandbox_id, action, status, error_code, error_message,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        operation.id,
        operation.sandboxId,
        operation.action,
        operation.status,
        operation.errorCode,
        operation.errorMessage,
        operation.createdAt,
        operation.updatedAt,
      );
  }

  private getHostedOperation(id: string) {
    const row = this.sqlite
      .prepare('SELECT * FROM relay_hosted_operations WHERE id = ?')
      .get(id) as HostedOperationRow | undefined;
    return row ? this.rowToHostedOperation(row) : null;
  }

  private getHostedOperations(sandboxId: string) {
    return (
      this.sqlite
        .prepare(
          'SELECT * FROM relay_hosted_operations WHERE sandbox_id = ? ORDER BY created_at DESC',
        )
        .all(sandboxId) as HostedOperationRow[]
    ).map((row) => this.rowToHostedOperation(row));
  }

  private insertShare(share: RelaySessionShareDto) {
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_shares (
            id, owner_user_id, owner_username, target_user_id, target_username,
            device_id, device_name, thread_id, thread_title, workspace_id, workspace_label, label,
            thread_access, workspace_access, created_at, revoked_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        share.threadTitle,
        share.workspaceId,
        share.workspaceLabel,
        share.label,
        share.threadAccess,
        share.workspaceAccess,
        share.createdAt,
        share.revokedAt,
        share.expiresAt,
      );
  }

  private insertGrant(grant: RelayAccessGrantDto) {
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_access_grants (
            id, owner_user_id, owner_username, target_user_id, target_username,
            device_id, device_name, scope, thread_id, thread_title, workspace_id,
            workspace_label, workspace_scope, workspace_ids, label, thread_access,
            workspace_access, can_create_threads, created_at, revoked_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        grant.id,
        grant.ownerUserId,
        grant.ownerUsername,
        grant.targetUserId,
        grant.targetUsername,
        grant.deviceId,
        grant.deviceName,
        grant.scope,
        grant.threadId,
        grant.threadTitle,
        grant.workspaceId,
        grant.workspaceLabel,
        grant.workspaceScope,
        JSON.stringify(grant.workspaceIds),
        grant.label,
        grant.threadAccess,
        grant.workspaceAccess,
        grant.canCreateThreads ? 1 : 0,
        grant.createdAt,
        grant.revokedAt,
        grant.expiresAt,
      );
  }

  updateShareMetadata(
    shareId: string,
    input: {
      threadTitle?: string | null;
      workspaceLabel?: string | null;
    },
  ) {
    const threadTitle = normalizeOptionalMetadata(input.threadTitle);
    const workspaceLabel = normalizeOptionalMetadata(input.workspaceLabel);
    if (threadTitle === undefined && workspaceLabel === undefined) {
      return this.rowToShare(
        this.sqlite
          .prepare('SELECT * FROM relay_shares WHERE id = ?')
          .get(shareId) as ShareRow | undefined,
      );
    }

    this.sqlite
      .prepare(
        `
          UPDATE relay_shares
          SET thread_title = COALESCE(?, thread_title),
              workspace_label = COALESCE(?, workspace_label)
          WHERE id = ?
        `,
      )
      .run(threadTitle ?? null, workspaceLabel ?? null, shareId);

    return this.rowToShare(
      this.sqlite
        .prepare('SELECT * FROM relay_shares WHERE id = ?')
        .get(shareId) as ShareRow | undefined,
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
      kind: normalizeAccessEventKind(row.kind),
      accessedAt: row.accessed_at,
    }));
  }

  private getGrantAccessEvents(grantId: string): RelayAccessGrantEventDto[] {
    return (
      this.sqlite
        .prepare(
          `
            SELECT * FROM relay_access_grant_events
            WHERE grant_id = ?
            ORDER BY accessed_at DESC
            LIMIT 8
          `,
        )
        .all(grantId) as GrantAccessRow[]
    ).map((row) => ({
      id: row.id,
      grantId: row.grant_id,
      userId: row.user_id,
      username: row.username,
      kind: normalizeAccessEventKind(row.kind),
      accessedAt: row.accessed_at,
    }));
  }

  private updateShareRecord(
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
      this.sqlite
        .prepare('SELECT * FROM relay_shares WHERE id = ?')
        .get(shareId) as ShareRow | undefined,
    )!;
  }

  private updateGrantRecord(
    grantId: string,
    input: {
      label: string | null;
      workspaceScope: RelayWorkspaceScopeDto;
      workspaceIds: string[];
      threadAccess: RelayThreadAccessDto;
      workspaceAccess: RelayWorkspaceAccessDto;
      canCreateThreads: boolean;
      expiresAt: string | null;
    },
  ) {
    this.sqlite
      .prepare(
        `
          UPDATE relay_access_grants
          SET label = ?,
              workspace_scope = ?,
              workspace_ids = ?,
              thread_access = ?,
              workspace_access = ?,
              can_create_threads = ?,
              expires_at = ?
          WHERE id = ?
        `,
      )
      .run(
        input.label,
        input.workspaceScope,
        JSON.stringify(input.workspaceIds),
        input.threadAccess,
        input.workspaceAccess,
        input.canCreateThreads ? 1 : 0,
        input.expiresAt,
        grantId,
      );
    return this.rowToGrant(
      this.sqlite
        .prepare('SELECT * FROM relay_access_grants WHERE id = ?')
        .get(grantId) as GrantRow | undefined,
    )!;
  }

  private getUser(id: string) {
    return this.rowToUser(
      this.sqlite.prepare('SELECT * FROM relay_users WHERE id = ?').get(id) as
        | UserRow
        | undefined,
    );
  }

  private getUserByIdentifier(identifier: string) {
    return this.rowToUser(
      this.sqlite
        .prepare('SELECT * FROM relay_users WHERE email = ? OR username = ?')
        .get(identifier.toLowerCase(), identifier.toLowerCase()) as
        | UserRow
        | undefined,
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
    return (
      this.sqlite
        .prepare('SELECT * FROM relay_users ORDER BY created_at ASC')
        .all() as UserRow[]
    )
      .map((row) => this.rowToUser(row))
      .filter((user): user is StoredUser => Boolean(user));
  }

  private getDevice(id: string) {
    return this.rowToDevice(
      this.sqlite
        .prepare('SELECT * FROM relay_devices WHERE id = ?')
        .get(id) as DeviceRow | undefined,
    );
  }

  private getDevices() {
    return (
      this.sqlite
        .prepare('SELECT * FROM relay_devices ORDER BY created_at ASC')
        .all() as DeviceRow[]
    )
      .map((row) => this.rowToDevice(row))
      .filter((device): device is StoredDevice => Boolean(device));
  }

  private getDevicesByOwner(ownerUserId: string) {
    return (
      this.sqlite
        .prepare(
          'SELECT * FROM relay_devices WHERE owner_user_id = ? ORDER BY created_at ASC',
        )
        .all(ownerUserId) as DeviceRow[]
    )
      .map((row) => this.rowToDevice(row))
      .filter((device): device is StoredDevice => Boolean(device));
  }

  private getSharesByOwner(ownerUserId: string) {
    return (
      this.sqlite
        .prepare(
          'SELECT * FROM relay_shares WHERE owner_user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC',
        )
        .all(ownerUserId, new Date().toISOString()) as ShareRow[]
    )
      .map((row) => this.rowToShare(row))
      .filter((share): share is RelaySessionShareDto => Boolean(share));
  }

  private getSharesByTarget(targetUserId: string) {
    return (
      this.sqlite
        .prepare(
          'SELECT * FROM relay_shares WHERE target_user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC',
        )
        .all(targetUserId, new Date().toISOString()) as ShareRow[]
    )
      .map((row) => this.rowToShare(row))
      .filter((share): share is RelaySessionShareDto => Boolean(share));
  }

  private getShares(options: { includeRevoked?: boolean } = {}) {
    const sql = options.includeRevoked
      ? 'SELECT * FROM relay_shares ORDER BY created_at DESC'
      : 'SELECT * FROM relay_shares WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC';
    const rows = options.includeRevoked
      ? (this.sqlite.prepare(sql).all() as ShareRow[])
      : (this.sqlite.prepare(sql).all(new Date().toISOString()) as ShareRow[]);
    return rows
      .map((row) => this.rowToShare(row))
      .filter((share): share is RelaySessionShareDto => Boolean(share));
  }

  private getGrantsByOwner(ownerUserId: string) {
    return (
      this.sqlite
        .prepare(
          'SELECT * FROM relay_access_grants WHERE owner_user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC',
        )
        .all(ownerUserId, new Date().toISOString()) as GrantRow[]
    )
      .map((row) => this.rowToGrant(row))
      .filter((grant): grant is RelayAccessGrantDto => Boolean(grant));
  }

  private getGrantsByTarget(targetUserId: string) {
    return (
      this.sqlite
        .prepare(
          'SELECT * FROM relay_access_grants WHERE target_user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC',
        )
        .all(targetUserId, new Date().toISOString()) as GrantRow[]
    )
      .map((row) => this.rowToGrant(row))
      .filter((grant): grant is RelayAccessGrantDto => Boolean(grant));
  }

  private findBestGrant(
    userId: string,
    deviceId: string,
    scope: {
      threadId?: string | null;
      workspaceId?: string | null;
    },
  ) {
    const now = new Date().toISOString();
    const rows = this.sqlite
      .prepare(
        `
          SELECT * FROM relay_access_grants
          WHERE target_user_id = ?
            AND device_id = ?
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY
            CASE scope
              WHEN 'thread' THEN 3
              WHEN 'workspace' THEN 2
              WHEN 'device' THEN 1
              ELSE 0
            END DESC,
            CASE thread_access WHEN 'control' THEN 2 WHEN 'read' THEN 1 ELSE 0 END DESC,
            CASE workspace_access WHEN 'write' THEN 2 WHEN 'read' THEN 1 ELSE 0 END DESC,
            can_create_threads DESC,
            created_at DESC
        `,
      )
      .all(userId, deviceId, now) as GrantRow[];
    const grants = rows
      .map((row) => this.rowToGrant(row))
      .filter((grant): grant is RelayAccessGrantDto => Boolean(grant));
    const matchingGrants = grants.filter((grant) =>
      this.grantMatchesScope(grant, scope),
    );
    return matchingGrants.length > 0
      ? mergeMatchingGrants(matchingGrants, scope)
      : null;
  }

  private grantMatchesScope(
    grant: RelayAccessGrantDto,
    scope: {
      threadId?: string | null;
      workspaceId?: string | null;
    },
  ) {
    if (grant.scope === 'thread') {
      if (!scope.threadId || grant.threadId !== scope.threadId) {
        return false;
      }
      return true;
    }
    if (grant.scope === 'workspace') {
      if (
        !scope.workspaceId ||
        grant.workspaceId !== scope.workspaceId ||
        grant.workspaceAccess === 'none'
      ) {
        return false;
      }
      return true;
    }
    if (grant.scope === 'device') {
      if (scope.workspaceId && grant.workspaceAccess === 'none') {
        return false;
      }
      return true;
    }
    return false;
  }

  private accessFromGrant(grant: RelayAccessGrantDto): EffectiveRelayAccess {
    return {
      kind: 'shared',
      share: null,
      grant,
      scope: grant.scope,
      threadAccess: grant.threadAccess,
      workspaceAccess: grant.workspaceAccess,
      workspaceId: grant.workspaceId,
      workspaceScope: grant.workspaceScope,
      canCreateThreads: grant.canCreateThreads,
    };
  }

  private grantFromShare(share: RelaySessionShareDto): RelayAccessGrantDto {
    return {
      id: share.id,
      ownerUserId: share.ownerUserId,
      ownerUsername: share.ownerUsername,
      targetUserId: share.targetUserId,
      targetUsername: share.targetUsername,
      deviceId: share.deviceId,
      deviceName: share.deviceName,
      scope: 'thread',
      threadId: share.threadId,
      threadTitle: share.threadTitle,
      workspaceId: share.workspaceId,
      workspaceLabel: share.workspaceLabel,
      workspaceScope: 'selected',
      workspaceIds: share.workspaceId ? [share.workspaceId] : [],
      label: share.label,
      threadAccess: share.threadAccess,
      workspaceAccess: share.workspaceAccess,
      canCreateThreads: false,
      createdAt: share.createdAt,
      revokedAt: share.revokedAt,
      expiresAt: share.expiresAt,
      lastAccessedAt: share.lastAccessedAt,
      lastAccessedByUsername: share.lastAccessedByUsername,
      accessEvents: share.accessEvents.map((event) => ({
        id: event.id,
        grantId: event.shareId,
        userId: event.userId,
        username: event.username,
        kind: event.kind,
        accessedAt: event.accessedAt,
      })),
    };
  }

  private conversationCountsByUser(days: number) {
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const rows = this.sqlite
      .prepare(
        `
          SELECT user_id, COUNT(*) AS count
          FROM relay_conversation_events
          WHERE occurred_at >= ?
          GROUP BY user_id
        `,
      )
      .all(since) as Array<{ user_id: string; count: number }>;
    return new Map(rows.map((row) => [row.user_id, row.count]));
  }

  private pendingRegistrations() {
    return (
      this.sqlite
        .prepare(
          `
          SELECT * FROM relay_pending_registrations
          WHERE status = 'pending'
          ORDER BY created_at ASC
        `,
        )
        .all() as PendingRegistrationRow[]
    )
      .map((row) => this.rowToPendingRegistration(row))
      .filter((record): record is PendingRegistrationRecord => Boolean(record))
      .map((record) => this.publicPendingRegistration(record));
  }

  private requirePendingRegistration(id: string) {
    const record = this.rowToPendingRegistration(
      this.sqlite
        .prepare(
          "SELECT * FROM relay_pending_registrations WHERE id = ? AND status = 'pending'",
        )
        .get(id) as PendingRegistrationRow | undefined,
    );
    if (!record) {
      throw new RelayStoreError(
        404,
        'not_found',
        'Pending registration was not found.',
      );
    }
    if (
      this.getUserByIdentifier(record.email) ||
      this.getUserByUsername(record.username)
    ) {
      throw new RelayStoreError(
        409,
        'conflict',
        'A user with that email or username already exists.',
      );
    }
    return record;
  }

  private publicPendingRegistration(
    record: PendingRegistrationRecord,
  ): RelayPendingRegistrationDto {
    return {
      id: record.id,
      email: record.email,
      username: record.username,
      createdAt: record.createdAt,
    };
  }

  private insertPendingRegistration(record: PendingRegistrationRecord) {
    this.sqlite
      .prepare(
        `
          INSERT INTO relay_pending_registrations (
            id, email, username, password_salt, password_hash,
            created_at, status, reviewed_at, reviewed_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        record.id,
        record.email,
        record.username,
        record.passwordSalt,
        record.passwordHash,
        record.createdAt,
        record.status,
        record.reviewedAt,
        record.reviewedByUserId,
      );
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
      lastSeenAt: row.last_seen_at ?? null,
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

  private rowToHostedSandbox(row: HostedSandboxRow): RelayHostedSandboxDto {
    const user = this.getUser(row.assigned_user_id);
    const device = this.getDevice(row.device_id);
    return {
      id: row.id,
      deviceId: row.device_id,
      deviceName: device?.name ?? 'Hosted supervisor VM',
      assignedUserId: row.assigned_user_id,
      assignedUsername: user?.username ?? 'unknown',
      createdByAdminUserId: row.created_by_admin_user_id,
      provider: 'incus',
      providerInstanceId: row.provider_instance_id,
      imageVersion: row.image_version,
      resources: {
        cpuCount: row.cpu_count,
        memoryMiB: row.memory_mib,
        diskGiB: row.disk_gib,
      },
      status: row.status,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
      activeTurnCount: row.active_turn_count,
      lastUserActivityAt: row.last_user_activity_at,
      idleDeadlineAt: row.idle_deadline_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToHostedOperation(
    row: HostedOperationRow,
  ): RelayHostedSandboxOperationDto {
    return {
      id: row.id,
      sandboxId: row.sandbox_id,
      action: row.action,
      status: row.status,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
      threadTitle: row.thread_title ?? null,
      workspaceId: row.workspace_id ?? null,
      workspaceLabel: row.workspace_label ?? null,
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

  private rowToGrant(row?: GrantRow): RelayAccessGrantDto | null {
    if (!row) return null;
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      ownerUsername: row.owner_username ?? 'unknown',
      targetUserId: row.target_user_id,
      targetUsername: row.target_username ?? 'unknown',
      deviceId: row.device_id,
      deviceName: row.device_name ?? 'Remote Codex device',
      scope: normalizeShareScope(row.scope),
      threadId: row.thread_id ?? null,
      threadTitle: row.thread_title ?? null,
      workspaceId: row.workspace_id ?? null,
      workspaceLabel: row.workspace_label ?? null,
      workspaceScope: normalizeWorkspaceScope(row.workspace_scope),
      workspaceIds: parseWorkspaceIds(row.workspace_ids),
      label: row.label,
      threadAccess: normalizeThreadAccess(row.thread_access),
      workspaceAccess: normalizeWorkspaceAccess(row.workspace_access),
      canCreateThreads: Boolean(row.can_create_threads),
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      expiresAt: row.expires_at ?? null,
      lastAccessedAt: null,
      lastAccessedByUsername: null,
      accessEvents: [],
    };
  }

  private rowToPendingRegistration(
    row?: PendingRegistrationRow,
  ): PendingRegistrationRecord | null {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      username: row.username,
      passwordSalt: row.password_salt,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      status: row.status,
      reviewedAt: row.reviewed_at ?? null,
      reviewedByUserId: row.reviewed_by_user_id ?? null,
    };
  }
}

interface UserRow {
  id: string;
  email: string;
  username: string;
  role: RelayUserRoleDto;
  enabled: number;
  last_seen_at: string | null;
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

function parseHostedCodexConfig(
  value: string | null,
): RelayHostedCodexConfigDto {
  const fallback: RelayHostedCodexConfigDto = {
    modelProvider: 'OpenAI',
    model: 'gpt-5.4',
    reviewModel: 'gpt-5.4',
    reasoningEffort: 'medium',
    baseUrl: 'https://api.openai.com/v1',
    wireApi: 'responses',
    requiresOpenaiAuth: true,
    disableResponseStorage: true,
    networkAccess: 'enabled',
    goals: true,
  };
  if (!value) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(value) as RelayHostedCodexConfigDto) };
  } catch {
    return fallback;
  }
}

interface HostedSandboxRow {
  id: string;
  device_id: string;
  assigned_user_id: string;
  created_by_admin_user_id: string;
  provider: 'incus';
  provider_instance_id: string | null;
  image_version: string;
  cpu_count: number;
  memory_mib: number;
  disk_gib: number;
  status: RelayHostedSandboxStatusDto;
  credential_ref: string;
  codex_config_json: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  active_turn_count: number;
  last_user_activity_at: string | null;
  idle_deadline_at: string | null;
  lifecycle_generation: number;
  created_at: string;
  updated_at: string;
}

interface HostedOperationRow {
  id: string;
  sandbox_id: string;
  action: RelayHostedSandboxOperationActionDto;
  status: RelayHostedSandboxOperationStatusDto;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
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
  thread_title: string | null;
  workspace_id: string | null;
  workspace_label: string | null;
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
  kind: string | null;
  accessed_at: string;
}

interface GrantRow {
  id: string;
  owner_user_id: string;
  owner_username: string | null;
  target_user_id: string;
  target_username: string | null;
  device_id: string;
  device_name: string | null;
  scope: string;
  thread_id: string | null;
  thread_title: string | null;
  workspace_id: string | null;
  workspace_label: string | null;
  workspace_scope: string | null;
  workspace_ids: string | null;
  label: string | null;
  thread_access: string | null;
  workspace_access: string | null;
  can_create_threads: number;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
}

interface GrantAccessRow {
  id: string;
  grant_id: string;
  user_id: string;
  username: string;
  kind: string | null;
  accessed_at: string;
}

export interface DeviceConnectionStatus {
  connected: boolean;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  ipAddress?: string | null;
}

interface PendingRegistrationRow {
  id: string;
  email: string;
  username: string;
  password_salt: string;
  password_hash: string;
  created_at: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
}

export class RelayStoreError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code:
      | 'bad_request'
      | 'unauthorized'
      | 'forbidden'
      | 'not_found'
      | 'conflict'
      | 'service_unavailable',
    message: string,
  ) {
    super(message);
  }
}

function normalizeUsername(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function normalizeThreadAccess(
  value: string | null | undefined,
): RelayThreadAccessDto {
  return value === 'read' ? 'read' : 'control';
}

function normalizeWorkspaceAccess(
  value: string | null | undefined,
): RelayWorkspaceAccessDto {
  if (value === 'read' || value === 'write') {
    return value;
  }
  return 'none';
}

function normalizeShareScope(
  value: string | null | undefined,
): RelayShareScopeDto {
  if (value === 'workspace' || value === 'device') {
    return value;
  }
  return 'thread';
}

function normalizeWorkspaceScope(
  value: string | null | undefined,
): RelayWorkspaceScopeDto {
  return value === 'selected' ? 'selected' : 'all';
}

function normalizeWorkspaceIds(values: string[] | null | undefined) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort();
}

function mergeMatchingGrants(
  grants: RelayAccessGrantDto[],
  scope: {
    threadId?: string | null;
    workspaceId?: string | null;
  },
) {
  const sorted = [...grants].sort(compareGrantCapability);
  const grantScope = mergedGrantScope(sorted);
  const representative =
    sorted.find((grant) => grant.scope === grantScope) ?? sorted[0]!;
  const threadAccess = sorted.reduce(
    (best, grant) => maxThreadAccess(best, grant.threadAccess),
    'read' as RelayThreadAccessDto,
  );
  const workspaceAccess = sorted.reduce(
    (best, grant) => maxWorkspaceAccess(best, grant.workspaceAccess),
    'none' as RelayWorkspaceAccessDto,
  );
  return {
    ...representative,
    scope: grantScope,
    threadId:
      grantScope === 'thread'
        ? (scope.threadId ?? representative.threadId)
        : null,
    workspaceId:
      grantScope === 'workspace'
        ? (scope.workspaceId ?? representative.workspaceId)
        : null,
    threadAccess,
    workspaceAccess,
    canCreateThreads: sorted.some((grant) => grant.canCreateThreads),
  };
}

function mergedGrantScope(grants: RelayAccessGrantDto[]): RelayShareScopeDto {
  if (grants.some((grant) => grant.scope === 'device')) {
    return 'device';
  }
  if (grants.some((grant) => grant.scope === 'workspace')) {
    return 'workspace';
  }
  return 'thread';
}

function maxThreadAccess(
  left: RelayThreadAccessDto,
  right: RelayThreadAccessDto,
): RelayThreadAccessDto {
  return threadAccessScore(right) > threadAccessScore(left) ? right : left;
}

function maxWorkspaceAccess(
  left: RelayWorkspaceAccessDto,
  right: RelayWorkspaceAccessDto,
): RelayWorkspaceAccessDto {
  return workspaceAccessScore(right) > workspaceAccessScore(left)
    ? right
    : left;
}

function compareGrantCapability(
  left: RelayAccessGrantDto,
  right: RelayAccessGrantDto,
) {
  return (
    threadAccessScore(right.threadAccess) -
      threadAccessScore(left.threadAccess) ||
    workspaceAccessScore(right.workspaceAccess) -
      workspaceAccessScore(left.workspaceAccess) ||
    Number(right.canCreateThreads) - Number(left.canCreateThreads) ||
    grantScopeScore(right.scope) - grantScopeScore(left.scope) ||
    right.createdAt.localeCompare(left.createdAt)
  );
}

function threadAccessScore(value: RelayThreadAccessDto) {
  return value === 'control' ? 2 : value === 'read' ? 1 : 0;
}

function workspaceAccessScore(value: RelayWorkspaceAccessDto) {
  return value === 'write' ? 2 : value === 'read' ? 1 : 0;
}

function grantScopeScore(value: RelayShareScopeDto) {
  if (value === 'thread') {
    return 3;
  }
  if (value === 'workspace') {
    return 2;
  }
  return 1;
}

function normalizeAccessEventKind(
  value: string | null | undefined,
): RelayAccessEventKindDto {
  switch (value) {
    case 'open_device':
    case 'open_thread':
    case 'create_thread':
    case 'send_prompt':
    case 'read_workspace_file':
    case 'write_workspace_file':
      return value;
    default:
      return 'access';
  }
}

function parseWorkspaceIds(value: string | null | undefined) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeWorkspaceIds(
      Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [],
    );
  } catch {
    return [];
  }
}

function normalizeExpiresAt(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeOptionalMetadata(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return value?.trim() || undefined;
}

function normalizeConversationWindowDays(value: number | undefined) {
  if (!Number.isFinite(value ?? NaN)) {
    return 7;
  }
  return Math.min(365, Math.max(1, Math.floor(value!)));
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
