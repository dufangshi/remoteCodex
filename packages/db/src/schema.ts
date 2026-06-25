import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const hosts = sqliteTable('hosts', {
  id: text('id').primaryKey(),
  hostname: text('hostname').notNull(),
  platform: text('platform').notNull(),
  tailscaleName: text('tailscale_name'),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull()
});

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull(),
  label: text('label').notNull(),
  absPath: text('abs_path').notNull().unique(),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  lastOpenedAt: text('last_opened_at')
});

export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  provider: text('provider').notNull().default('codex'),
  providerSessionId: text('provider_session_id'),
  providerTurnId: text('provider_turn_id'),
  source: text('source').notNull().default('supervisor'),
  title: text('title').notNull(),
  model: text('model'),
  reasoningEffort: text('reasoning_effort'),
  fastMode: integer('fast_mode', { mode: 'boolean' }).notNull().default(false),
  fastBaseModel: text('fast_base_model'),
  fastBaseReasoningEffort: text('fast_base_reasoning_effort'),
  collaborationMode: text('collaboration_mode').notNull().default('default'),
  approvalMode: text('approval_mode'),
  sandboxMode: text('sandbox_mode'),
  status: text('status'),
  summaryText: text('summary_text'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastTurnStartedAt: text('last_turn_started_at'),
  lastTurnCompletedAt: text('last_turn_completed_at'),
  lastViewedAt: text('last_viewed_at'),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  isConnected: integer('is_connected', { mode: 'boolean' }).notNull().default(true)
});

export const shellSessions = sqliteTable('shell_sessions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  threadId: text('thread_id'),
  label: text('label'),
  tmuxSessionName: text('tmux_session_name'),
  cwd: text('cwd').notNull(),
  status: text('status'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastActivityAt: text('last_activity_at')
});

export const viewerSessions = sqliteTable('viewer_sessions', {
  id: text('id').primaryKey(),
  threadId: text('thread_id'),
  shellId: text('shell_id'),
  connectedAt: text('connected_at').notNull(),
  lastHeartbeatAt: text('last_heartbeat_at'),
  activeTab: text('active_tab')
});

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  threadId: text('thread_id'),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull()
});

export const threadTurnMetadata = sqliteTable(
  'thread_turn_metadata',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull(),
    turnId: text('turn_id').notNull(),
    model: text('model'),
    reasoningEffort: text('reasoning_effort'),
    reasoningEffortAvailable: integer('reasoning_effort_available', {
      mode: 'boolean',
    }),
    pricingModelKey: text('pricing_model_key'),
    pricingTierKey: text('pricing_tier_key'),
    tokenUsageJson: text('token_usage_json'),
    displayPrompt: text('display_prompt'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    threadTurnUnique: uniqueIndex('thread_turn_metadata_thread_turn_idx').on(
      table.threadId,
      table.turnId,
    ),
  }),
);

export const threadPendingSteers = sqliteTable('thread_pending_steers', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  turnId: text('turn_id').notNull(),
  clientRequestId: text('client_request_id'),
  displayPrompt: text('display_prompt').notNull(),
  submittedPrompt: text('submitted_prompt').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const threadHistoryItems = sqliteTable(
  'thread_history_items',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull(),
    turnId: text('turn_id').notNull(),
    itemId: text('item_id').notNull(),
    itemJson: text('item_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    threadTurnItemUnique: uniqueIndex('thread_history_items_thread_turn_item_idx').on(
      table.threadId,
      table.turnId,
      table.itemId,
    ),
  }),
);

export const threadActivityNotes = sqliteTable('thread_activity_notes', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  kind: text('kind').notNull(),
  text: text('text').notNull(),
  anchorTurnId: text('anchor_turn_id'),
  createdAt: text('created_at').notNull(),
});

export const threadForks = sqliteTable('thread_forks', {
  id: text('id').primaryKey(),
  sourceThreadId: text('source_thread_id').notNull(),
  sourceTurnId: text('source_turn_id'),
  sourceTurnIndex: integer('source_turn_index'),
  forkedThreadId: text('forked_thread_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const threadGoals = sqliteTable('thread_goals', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  providerSessionId: text('provider_session_id').notNull(),
  objective: text('objective').notNull(),
  status: text('status').notNull(),
  tokenBudget: integer('token_budget'),
  tokensUsed: integer('tokens_used').notNull().default(0),
  timeUsedSeconds: integer('time_used_seconds').notNull().default(0),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const policies = sqliteTable('policies', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  valueJson: text('value_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const controlUsers = sqliteTable(
  'control_users',
  {
    id: text('id').primaryKey(),
    authProvider: text('auth_provider').notNull(),
    authSubject: text('auth_subject').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    status: text('status').notNull().default('active'),
    plan: text('plan').notNull().default('developer'),
    billingCustomerId: text('billing_customer_id'),
    quotaProfile: text('quota_profile').notNull().default('developer'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastSeenAt: text('last_seen_at'),
  },
  (table) => ({
    authSubjectUnique: uniqueIndex('control_users_auth_subject_idx').on(
      table.authProvider,
      table.authSubject,
    ),
  }),
);

export const controlAuthIdentities = sqliteTable(
  'control_auth_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    authProvider: text('auth_provider').notNull(),
    authSubject: text('auth_subject').notNull(),
    email: text('email'),
    displayName: text('display_name'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    authSubjectUnique: uniqueIndex('control_auth_identities_subject_idx').on(
      table.authProvider,
      table.authSubject,
    ),
  }),
);

export const controlPasswordCredentials = sqliteTable(
  'control_password_credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastUsedAt: text('last_used_at'),
  },
  (table) => ({
    emailUnique: uniqueIndex('control_password_credentials_email_idx').on(table.email),
    userUnique: uniqueIndex('control_password_credentials_user_idx').on(table.userId),
  }),
);

export const controlProjects = sqliteTable('control_projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const controlSandboxes = sqliteTable('control_sandboxes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().unique(),
  state: text('state').notNull(),
  image: text('image').notNull(),
  region: text('region').notNull(),
  resourceProfile: text('resource_profile').notNull().default('standard'),
  k8sNamespace: text('k8s_namespace'),
  k8sPodName: text('k8s_pod_name'),
  routerBaseUrl: text('router_base_url'),
  workerServiceName: text('worker_service_name'),
  s3Prefix: text('s3_prefix').notNull(),
  gatewayKeyId: text('gateway_key_id'),
  lastStartedAt: text('last_started_at'),
  lastSeenAt: text('last_seen_at'),
  idleTimeoutAt: text('idle_timeout_at'),
  statusReason: text('status_reason'),
  startupProgress: integer('startup_progress').notNull().default(0),
  lastFailureCode: text('last_failure_code'),
  lastFailureMessage: text('last_failure_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const controlWorkspaces = sqliteTable(
  'control_workspaces',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    projectId: text('project_id'),
    sandboxId: text('sandbox_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('active'),
    path: text('path').notNull(),
    sourceType: text('source_type').notNull(),
    gitUrl: text('git_url'),
    defaultBranch: text('default_branch'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    sandboxSlugUnique: uniqueIndex('control_workspaces_sandbox_slug_idx').on(
      table.sandboxId,
      table.slug,
    ),
  }),
);

export const controlSessions = sqliteTable('control_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  sandboxId: text('sandbox_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  provider: text('provider').notNull(),
  workerSessionId: text('worker_session_id'),
  title: text('title').notNull(),
  status: text('status').notNull(),
  lastActivityAt: text('last_activity_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const controlGatewayUsers = sqliteTable(
  'control_gateway_users',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    externalUserId: text('external_user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userProviderUnique: uniqueIndex('control_gateway_users_user_provider_idx').on(
      table.userId,
      table.provider,
    ),
    providerExternalUnique: uniqueIndex('control_gateway_users_provider_external_idx').on(
      table.provider,
      table.externalUserId,
    ),
  }),
);

export const controlGatewayKeys = sqliteTable(
  'control_gateway_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    sandboxId: text('sandbox_id').notNull(),
    provider: text('provider').notNull(),
    externalKeyId: text('external_key_id').notNull(),
    keyCiphertext: text('key_ciphertext'),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    rotatedAt: text('rotated_at'),
    revokedAt: text('revoked_at'),
  },
  (table) => ({
    sandboxProviderUnique: uniqueIndex('control_gateway_keys_sandbox_provider_idx').on(
      table.sandboxId,
      table.provider,
    ),
    providerExternalUnique: uniqueIndex('control_gateway_keys_provider_external_idx').on(
      table.provider,
      table.externalKeyId,
    ),
  }),
);

export const controlHarnessUsers = sqliteTable(
  'control_harness_users',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    externalUserId: text('external_user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userProviderUnique: uniqueIndex('control_harness_users_user_provider_idx').on(
      table.userId,
      table.provider,
    ),
    providerExternalUnique: uniqueIndex('control_harness_users_provider_external_idx').on(
      table.provider,
      table.externalUserId,
    ),
  }),
);

export const controlHarnessKeys = sqliteTable(
  'control_harness_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    sandboxId: text('sandbox_id').notNull(),
    provider: text('provider').notNull(),
    externalKeyId: text('external_key_id').notNull(),
    keyCiphertext: text('key_ciphertext'),
    secretName: text('secret_name'),
    secretKey: text('secret_key'),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    rotatedAt: text('rotated_at'),
    revokedAt: text('revoked_at'),
  },
  (table) => ({
    sandboxProviderUnique: uniqueIndex('control_harness_keys_sandbox_provider_idx').on(
      table.sandboxId,
      table.provider,
    ),
    providerExternalUnique: uniqueIndex('control_harness_keys_provider_external_idx').on(
      table.provider,
      table.externalKeyId,
    ),
  }),
);

export const controlUsageEvents = sqliteTable('control_usage_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  sandboxId: text('sandbox_id').notNull(),
  workspaceId: text('workspace_id'),
  sessionId: text('session_id'),
  gatewayKeyId: text('gateway_key_id'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  externalRequestId: text('external_request_id'),
  occurredAt: text('occurred_at').notNull(),
  importedAt: text('imported_at').notNull(),
});

export const controlHarnessUsageEvents = sqliteTable(
  'control_harness_usage_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    sandboxId: text('sandbox_id').notNull(),
    workspaceId: text('workspace_id'),
    sessionId: text('session_id'),
    provider: text('provider').notNull(),
    module: text('module').notNull(),
    tool: text('tool'),
    runId: text('run_id'),
    jobId: text('job_id'),
    externalEventId: text('external_event_id'),
    computeUnits: real('compute_units').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    status: text('status').notNull().default('unknown'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    occurredAt: text('occurred_at').notNull(),
    importedAt: text('imported_at').notNull(),
  },
  (table) => ({
    providerExternalEventUnique: uniqueIndex('control_harness_usage_provider_event_idx')
      .on(table.provider, table.externalEventId),
  }),
);

export const controlUsageImportState = sqliteTable('control_usage_import_state', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  source: text('source').notNull(),
  cursor: text('cursor'),
  lastStartedAt: text('last_started_at'),
  lastSucceededAt: text('last_succeeded_at'),
  lastFailedAt: text('last_failed_at'),
  lastFailureMessage: text('last_failure_message'),
  lastSourceCount: integer('last_source_count').notNull().default(0),
  lastImportedCount: integer('last_imported_count').notNull().default(0),
  lastDuplicateCount: integer('last_duplicate_count').notNull().default(0),
  lastFailureCount: integer('last_failure_count').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  providerSourceIdx: uniqueIndex('control_usage_import_state_provider_source_idx')
    .on(table.provider, table.source),
}));

export const controlAuditLogs = sqliteTable('control_audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  metadataJson: text('metadata_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const harnessNotifyRegistrations = sqliteTable('harness_notify_registrations', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  hookToken: text('hook_token').notNull(),
  secret: text('secret').notNull(),
  callbackUrl: text('callback_url').notNull(),
  registeredAt: text('registered_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const harnessJobWatches = sqliteTable(
  'harness_job_watches',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull(),
    threadId: text('thread_id').notNull(),
    title: text('title'),
    status: text('status').notNull().default('pending'),
    lastJobStatus: text('last_job_status'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deliveredAt: text('delivered_at'),
  },
  (table) => ({
    jobIdUnique: uniqueIndex('harness_job_watches_job_id_idx').on(table.jobId),
  }),
);
