import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  codexThreadId: text('codex_thread_id'),
  codexTurnId: text('codex_turn_id'),
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
  codexThreadId: text('codex_thread_id').notNull(),
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
