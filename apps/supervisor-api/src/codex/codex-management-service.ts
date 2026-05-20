import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentRuntime } from '../../../../packages/agent-runtime/src/index';
import type {
  AgentHookDto,
  AgentHookEventNameDto,
  CreateThreadHookInput,
  UpdateThreadHookInput,
} from '../../../../packages/shared/src/index';
import { HttpError } from '../app';
import {
  readCodexFastModeSync,
  readCodexFeatureFlag,
  writeCodexFeatureFlag,
  writeCodexFastMode,
} from './codexHostConfig';
import {
  isCodexRuntimeRequestError,
  unwrapCodexJsonRpcError,
} from './runtime-errors';

const GOAL_FEATURE_DISABLED_MESSAGE =
  'Codex /goal is experimental. Enable it by adding `goals = true` under `[features]` in ~/.codex/config.toml, then restart the Codex app-server.';

const HOOK_EVENT_JSON_KEYS = {
  preToolUse: 'PreToolUse',
  permissionRequest: 'PermissionRequest',
  postToolUse: 'PostToolUse',
  preCompact: 'PreCompact',
  postCompact: 'PostCompact',
  sessionStart: 'SessionStart',
  userPromptSubmit: 'UserPromptSubmit',
  stop: 'Stop',
} as const;
const HOOK_EVENT_DTO_KEYS = Object.fromEntries(
  Object.entries(HOOK_EVENT_JSON_KEYS).map(([dtoKey, jsonKey]) => [jsonKey, dtoKey]),
) as Record<string, AgentHookEventNameDto>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHooksJson(value: unknown): { hooks: Record<string, unknown[]> } & Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.hooks)) {
    return { hooks: {} as Record<string, unknown[]> };
  }

  const hooks: Record<string, unknown[]> = {};
  for (const [eventName, groups] of Object.entries(value.hooks)) {
    hooks[eventName] = Array.isArray(groups) ? groups : [];
  }
  return { ...value, hooks };
}

function readJsonFileOrDefault(
  filePath: string,
): Promise<{ hooks: Record<string, unknown[]> } & Record<string, unknown>> {
  return fs
    .readFile(filePath, 'utf8')
    .then((raw) => {
      if (!raw.trim()) {
        return { hooks: {} as Record<string, unknown[]> };
      }
      return normalizeHooksJson(JSON.parse(raw));
    })
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { hooks: {} as Record<string, unknown[]> };
      }
      throw error;
    });
}

function validateHookInput(input: CreateThreadHookInput) {
  if (!HOOK_EVENT_JSON_KEYS[input.eventName]) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Unsupported hook event.',
    });
  }
  if (input.scope !== 'global' && input.scope !== 'project') {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Hook scope must be global or project.',
    });
  }
  if (!input.command.trim()) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Hook command cannot be empty.',
    });
  }
  if (
    input.timeoutSec !== undefined &&
    input.timeoutSec !== null &&
    (!Number.isInteger(input.timeoutSec) || input.timeoutSec <= 0 || input.timeoutSec > 86_400)
  ) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Hook timeout must be a positive number of seconds.',
    });
  }
}

function hooksPathForInput(codexHome: string, workspacePath: string, input: { scope: 'global' | 'project' }) {
  return input.scope === 'global'
    ? path.join(codexHome, 'hooks.json')
    : path.join(workspacePath, '.codex', 'hooks.json');
}

function hookInputMatches(
  group: unknown,
  handler: unknown,
  input: CreateThreadHookInput,
) {
  if (!isRecord(group) || !isRecord(handler)) {
    return false;
  }
  const matcher = typeof group.matcher === 'string' ? group.matcher : null;
  const handlerCommand = typeof handler.command === 'string' ? handler.command : '';
  const handlerTimeout =
    typeof handler.timeout === 'number' && Number.isFinite(handler.timeout)
      ? handler.timeout
      : null;
  const handlerStatusMessage =
    typeof handler.statusMessage === 'string' ? handler.statusMessage : null;
  return (
    handler.type === 'command' &&
    (input.matcher?.trim() || null) === matcher &&
    input.command.trim() === handlerCommand &&
    (input.timeoutSec ?? null) === handlerTimeout &&
    (input.statusMessage?.trim() || null) === handlerStatusMessage
  );
}

function hookMatchesInput(hook: AgentHookDto, input: CreateThreadHookInput) {
  return (
    hook.source === input.scope &&
    hook.eventName === input.eventName &&
    (hook.matcher ?? null) === (input.matcher ?? null) &&
    hook.command === input.command &&
    (input.timeoutSec == null || hook.timeoutSec === input.timeoutSec) &&
    (hook.statusMessage ?? null) === (input.statusMessage ?? null)
  );
}

async function findOfficialHookForInput(
  runtime: AgentRuntime,
  workspacePath: string,
  input: CreateThreadHookInput,
): Promise<AgentHookDto | null> {
  if (!runtime.listHooks) {
    return null;
  }
  const [entry] = await runtime.listHooks({
    cwds: [workspacePath],
  }) as Awaited<ReturnType<NonNullable<AgentRuntime['listHooks']>>>;
  const officialHooks: AgentHookDto[] = (entry?.hooks ?? []).map((hook) => ({
    key: hook.key,
    eventName: hook.eventName as AgentHookDto['eventName'],
    handlerType: hook.handlerType as AgentHookDto['handlerType'],
    matcher: hook.matcher,
    command: hook.command,
    timeoutSec: hook.timeoutSec,
    statusMessage: hook.statusMessage,
    sourcePath: hook.sourcePath,
    source: hook.source as AgentHookDto['source'],
    pluginId: hook.pluginId,
    displayOrder: hook.displayOrder,
    enabled: hook.enabled,
    isManaged: hook.isManaged,
    currentHash: hook.currentHash,
    trustStatus: hook.trustStatus as AgentHookDto['trustStatus'],
  }));
  return officialHooks.find((hook) => hookMatchesInput(hook, input)) ?? null;
}

async function trustHookForInput(
  runtime: AgentRuntime,
  workspacePath: string,
  input: CreateThreadHookInput,
) {
  const hook = await findOfficialHookForInput(runtime, workspacePath, input);
  if (!runtime.setHookTrust || !hook || !hook.key || !hook.currentHash || hook.isManaged) {
    return;
  }

  await runtime.setHookTrust({
    key: hook.key,
    trustedHash: hook.currentHash,
  });
}

export class CodexManagementService {
  constructor(private readonly codexHome: string) {}

  readFastMode() {
    return readCodexFastModeSync(this.codexHome);
  }

  writeFastMode(enabled: boolean) {
    return writeCodexFastMode(this.codexHome, enabled);
  }

  mapGoalError(error: unknown): never {
    const codexError = unwrapCodexJsonRpcError(error);
    if (codexError) {
      const remoteMessage = codexError.message || '';
      if (remoteMessage.toLowerCase().includes('goals feature is disabled')) {
        throw new HttpError(409, {
          code: 'goal_feature_disabled',
          message: GOAL_FEATURE_DISABLED_MESSAGE,
        });
      }

      throw new HttpError(502, {
        code: 'provider_goal_error',
        message: remoteMessage || 'Provider goal operation failed.',
        details: {
          provider: 'codex',
        },
      });
    }

    throw error;
  }

  async ensureGoalsFeatureEnabled(runtime: AgentRuntime) {
    try {
      if (await readCodexFeatureFlag(this.codexHome, 'goals')) {
        return;
      }

      await writeCodexFeatureFlag(this.codexHome, 'goals', true);
      await runtime.stop();
      await runtime.start();
    } catch (error) {
      if (isCodexRuntimeRequestError(error)) {
        throw new HttpError(409, {
          code: 'goal_feature_disabled',
          message: GOAL_FEATURE_DISABLED_MESSAGE,
        });
      }
      throw error;
    }
  }

  isRuntimeRequestError(error: unknown) {
    return isCodexRuntimeRequestError(error);
  }

  async writeHookEntry(
    runtime: AgentRuntime,
    workspacePath: string,
    input: CreateThreadHookInput,
  ) {
    validateHookInput(input);

    const hooksPath = hooksPathForInput(this.codexHome, workspacePath, input);
    const config = await readJsonFileOrDefault(hooksPath);
    const eventKey = HOOK_EVENT_JSON_KEYS[input.eventName];
    const matcher = input.matcher?.trim() || null;
    const handler: Record<string, unknown> = {
      type: 'command',
      command: input.command.trim(),
    };
    if (input.timeoutSec !== undefined && input.timeoutSec !== null) {
      handler.timeout = input.timeoutSec;
    }
    if (input.statusMessage?.trim()) {
      handler.statusMessage = input.statusMessage.trim();
    }

    const group: Record<string, unknown> = {
      hooks: [handler],
    };
    if (matcher) {
      group.matcher = matcher;
    }

    const currentGroups = Array.isArray(config.hooks[eventKey])
      ? config.hooks[eventKey]
      : [];
    config.hooks[eventKey] = [...currentGroups, group];

    await fs.mkdir(path.dirname(hooksPath), { recursive: true });
    await fs.writeFile(hooksPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await trustHookForInput(runtime, workspacePath, input);
  }

  async updateHookEntry(
    runtime: AgentRuntime,
    workspacePath: string,
    input: UpdateThreadHookInput,
  ) {
    validateHookInput(input);
    validateHookInput(input.target);

    if (input.scope !== input.target.scope) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Hook scope cannot be changed while editing.',
      });
    }

    const hooksPath = hooksPathForInput(this.codexHome, workspacePath, input);
    const config = await readJsonFileOrDefault(hooksPath);
    const targetEventKey = HOOK_EVENT_JSON_KEYS[input.target.eventName];
    const nextEventKey = HOOK_EVENT_JSON_KEYS[input.eventName];
    const currentGroups = Array.isArray(config.hooks[targetEventKey])
      ? config.hooks[targetEventKey]
      : [];
    let replacementGroup: Record<string, unknown> | null = null;

    config.hooks[targetEventKey] = currentGroups
      .map((group) => {
        if (replacementGroup || !isRecord(group) || !Array.isArray(group.hooks)) {
          return group;
        }
        const hookIndex = group.hooks.findIndex((handler) =>
          hookInputMatches(group, handler, input.target),
        );
        if (hookIndex < 0) {
          return group;
        }

        const handler: Record<string, unknown> = {
          type: 'command',
          command: input.command.trim(),
        };
        if (input.timeoutSec !== undefined && input.timeoutSec !== null) {
          handler.timeout = input.timeoutSec;
        }
        if (input.statusMessage?.trim()) {
          handler.statusMessage = input.statusMessage.trim();
        }
        replacementGroup = {
          hooks: [handler],
        };
        const matcher = input.matcher?.trim() || null;
        if (matcher) {
          replacementGroup.matcher = matcher;
        }

        if (targetEventKey !== nextEventKey) {
          const remainingHooks = group.hooks.filter((_, index) => index !== hookIndex);
          return {
            ...group,
            hooks: remainingHooks,
          };
        }

        return {
          ...replacementGroup,
          hooks: group.hooks.map((existing, index) =>
            index === hookIndex
              ? (replacementGroup!.hooks as unknown[])[0]
              : existing,
          ),
        };
      })
      .filter((group) => {
        if (!isRecord(group) || !Array.isArray(group.hooks)) {
          return true;
        }
        return group.hooks.length > 0;
      });

    if (!replacementGroup) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Hook was not found in hooks.json.',
      });
    }

    if (targetEventKey !== nextEventKey) {
      if (config.hooks[targetEventKey]?.length === 0) {
        delete config.hooks[targetEventKey];
      }
      const nextGroups = Array.isArray(config.hooks[nextEventKey])
        ? config.hooks[nextEventKey]
        : [];
      config.hooks[nextEventKey] = [...nextGroups, replacementGroup];
    }

    await fs.mkdir(path.dirname(hooksPath), { recursive: true });
    await fs.writeFile(hooksPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await trustHookForInput(runtime, workspacePath, input);
  }

  async readLocalHookDtos(input: {
    hooksPath: string;
    source: 'user' | 'project';
    displayOffset: number;
  }): Promise<AgentHookDto[]> {
    const config = await readJsonFileOrDefault(input.hooksPath);
    const hooks: AgentHookDto[] = [];
    for (const [eventKey, groups] of Object.entries(config.hooks)) {
      const eventName = HOOK_EVENT_DTO_KEYS[eventKey];
      if (!eventName || !Array.isArray(groups)) {
        continue;
      }
      groups.forEach((group, groupIndex) => {
        if (!isRecord(group) || !Array.isArray(group.hooks)) {
          return;
        }
        const matcher = typeof group.matcher === 'string' ? group.matcher : null;
        group.hooks.forEach((handler, handlerIndex) => {
          if (!isRecord(handler) || handler.type !== 'command') {
            return;
          }
          const command = typeof handler.command === 'string' ? handler.command : null;
          if (!command) {
            return;
          }
          const timeoutSec =
            typeof handler.timeout === 'number' && Number.isFinite(handler.timeout)
              ? handler.timeout
              : 600;
          const statusMessage =
            typeof handler.statusMessage === 'string' ? handler.statusMessage : null;
          const key = `${input.source}:${input.hooksPath}:${eventKey}:${groupIndex}:${handlerIndex}`;
          hooks.push({
            key,
            eventName,
            handlerType: 'command',
            matcher,
            command,
            timeoutSec,
            statusMessage,
            sourcePath: input.hooksPath,
            source: input.source,
            pluginId: null,
            displayOrder: input.displayOffset + hooks.length,
            enabled: true,
            isManaged: false,
            currentHash: '',
            trustStatus: 'untrusted',
          });
        });
      });
    }
    return hooks;
  }

  hooksPaths(workspacePath: string) {
    return {
      globalHooksPath: path.join(this.codexHome, 'hooks.json'),
      projectHooksPath: path.join(workspacePath, '.codex', 'hooks.json'),
    };
  }
}
