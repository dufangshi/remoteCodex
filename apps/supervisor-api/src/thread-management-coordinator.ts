import type {
  AgentRuntime,
} from '../../../packages/agent-runtime/src/index';
import type {
  AgentHookDto,
  AgentSkillDto,
  CreateThreadHookInput,
  ThreadHooksDto,
  ThreadMcpServersDto,
  ThreadSkillsDto,
  TrustThreadHookInput,
  UntrustThreadHookInput,
  UpdateThreadHookInput,
} from '../../../packages/shared/src/index';
import { HttpError } from './app';

interface ThreadManagementCoordinatorCallbacks {
  runtimeForProvider(provider: string | null | undefined): AgentRuntime;
}

type AgentHookEntry = Awaited<ReturnType<NonNullable<AgentRuntime['listHooks']>>>[number];

export interface ThreadHookFileManagement {
  canManageHookFiles(provider: string | null | undefined): boolean;
  isUnsupportedHooksListError(error: unknown): boolean;
  hooksListFallbackWarning(): string;
  writeHookEntry(
    runtime: AgentRuntime,
    workspacePath: string,
    input: CreateThreadHookInput,
  ): Promise<void>;
  updateHookEntry(
    runtime: AgentRuntime,
    workspacePath: string,
    input: UpdateThreadHookInput,
  ): Promise<void>;
  hooksPaths(workspacePath: string): {
    globalHooksPath: string;
    projectHooksPath: string;
  };
  readLocalHookDtos(input: {
    hooksPath: string;
    source: AgentHookDto['source'];
    displayOffset: number;
  }): Promise<AgentHookDto[]>;
}

export class ThreadManagementCoordinator {
  constructor(
    private readonly hookFileManagement: ThreadHookFileManagement,
    private readonly callbacks: ThreadManagementCoordinatorCallbacks,
  ) {}

  async listThreadSkills(input: {
    provider: string | null | undefined;
    workspacePath: string;
  }): Promise<ThreadSkillsDto> {
    const runtime = this.callbacks.runtimeForProvider(input.provider);
    if (!runtime.listSkills) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not expose skills.',
      });
    }

    const [entry] = await runtime.listSkills({
      cwds: [input.workspacePath],
      forceReload: true,
    }) as Awaited<ReturnType<NonNullable<AgentRuntime['listSkills']>>>;

    return {
      cwd: input.workspacePath,
      skills: (entry?.skills ?? []).map((skill) => ({
        name: skill.name,
        description: skill.description,
        ...(skill.shortDescription ? { shortDescription: skill.shortDescription } : {}),
        ...(skill.interface
          ? {
              interface: {
                ...(skill.interface.displayName
                  ? { displayName: skill.interface.displayName }
                  : {}),
                ...(skill.interface.shortDescription
                  ? { shortDescription: skill.interface.shortDescription }
                  : {}),
                ...(skill.interface.brandColor
                  ? { brandColor: skill.interface.brandColor }
                  : {}),
                ...(skill.interface.defaultPrompt
                  ? { defaultPrompt: skill.interface.defaultPrompt }
                  : {}),
              },
            }
          : {}),
        path: skill.path,
        scope: skill.scope as AgentSkillDto['scope'],
        enabled: skill.enabled,
      })),
      errors: (entry?.errors ?? []).map((error) => ({
        path: error.path,
        message: error.message,
      })),
    };
  }

  async listThreadMcpServers(input: {
    provider: string | null | undefined;
  }): Promise<ThreadMcpServersDto> {
    const runtime = this.callbacks.runtimeForProvider(input.provider);
    if (!runtime.listMcpServers) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not expose MCP server status.',
      });
    }

    return {
      servers: ((await runtime.listMcpServers()) as Awaited<ReturnType<NonNullable<AgentRuntime['listMcpServers']>>>).map((server) => ({
        name: server.name,
        authStatus: server.authStatus as ThreadMcpServersDto['servers'][number]['authStatus'],
        tools: server.tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
        })),
        resourceCount: server.resourceCount,
        resourceTemplateCount: server.resourceTemplateCount,
      })),
    };
  }

  async listThreadHooks(input: {
    provider: string | null | undefined;
    workspacePath: string;
  }): Promise<ThreadHooksDto> {
    let entry: AgentHookEntry | undefined;
    let fallbackWarnings: string[] = [];
    const runtime = this.callbacks.runtimeForProvider(input.provider);
    try {
      if (!runtime.listHooks) {
        throw new HttpError(409, {
          code: 'conflict',
          message: 'This backend does not expose hooks.',
        });
      }
      [entry] = await runtime.listHooks({
        cwds: [input.workspacePath],
      }) as Awaited<ReturnType<NonNullable<AgentRuntime['listHooks']>>>;
    } catch (error) {
      if (
        !this.hookFileManagement.canManageHookFiles(input.provider) ||
        !this.hookFileManagement.isUnsupportedHooksListError(error)
      ) {
        throw error;
      }

      fallbackWarnings = [this.hookFileManagement.hooksListFallbackWarning()];
    }

    return this.toThreadHooksDto(input.provider, input.workspacePath, entry, fallbackWarnings);
  }

  async createThreadHook(input: {
    provider: string | null | undefined;
    workspacePath: string;
    hook: CreateThreadHookInput;
  }): Promise<ThreadHooksDto> {
    const runtime = this.callbacks.runtimeForProvider(input.provider);
    this.assertHooksCapability(runtime);
    this.assertHookFileManagement(input.provider);

    await this.hookFileManagement.writeHookEntry(runtime, input.workspacePath, input.hook);

    return this.listThreadHooks(input);
  }

  async updateThreadHook(input: {
    provider: string | null | undefined;
    workspacePath: string;
    hook: UpdateThreadHookInput;
  }): Promise<ThreadHooksDto> {
    const runtime = this.callbacks.runtimeForProvider(input.provider);
    this.assertHooksCapability(runtime);
    this.assertHookFileManagement(input.provider);

    await this.hookFileManagement.updateHookEntry(runtime, input.workspacePath, input.hook);

    return this.listThreadHooks(input);
  }

  async trustThreadHook(input: {
    provider: string | null | undefined;
    workspacePath: string;
    hook: TrustThreadHookInput;
  }): Promise<ThreadHooksDto> {
    const runtime = this.callbacks.runtimeForProvider(input.provider);
    if (!runtime.setHookTrust) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support hook trust.',
      });
    }

    await runtime.setHookTrust({
      key: input.hook.key,
      trustedHash: input.hook.currentHash,
    });

    return this.listThreadHooks(input);
  }

  async untrustThreadHook(input: {
    provider: string | null | undefined;
    workspacePath: string;
    hook: UntrustThreadHookInput;
  }): Promise<ThreadHooksDto> {
    const runtime = this.callbacks.runtimeForProvider(input.provider);
    if (!runtime.setHookTrust) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support hook trust.',
      });
    }

    await runtime.setHookTrust({
      key: input.hook.key,
      trustedHash: null,
    });

    return this.listThreadHooks(input);
  }

  private assertHooksCapability(runtime: AgentRuntime) {
    if (!runtime.capabilities.management.hooks) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not expose hooks.',
      });
    }
  }

  private assertHookFileManagement(provider: string | null | undefined): void {
    if (!this.hookFileManagement.canManageHookFiles(provider)) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support hooks file editing.',
      });
    }
  }

  private async toThreadHooksDto(
    provider: string | null | undefined,
    workspacePath: string,
    entry: AgentHookEntry | undefined,
    fallbackWarnings: string[] = [],
  ): Promise<ThreadHooksDto> {
    const { globalHooksPath, projectHooksPath } =
      this.hookFileManagement.hooksPaths(workspacePath);
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
    const [globalHooks, projectHooks] = this.hookFileManagement.canManageHookFiles(provider)
      ? await Promise.all([
          this.hookFileManagement.readLocalHookDtos({
            hooksPath: globalHooksPath,
            source: 'user',
            displayOffset: officialHooks.length,
          }),
          this.hookFileManagement.readLocalHookDtos({
            hooksPath: projectHooksPath,
            source: 'project',
            displayOffset: officialHooks.length + 10_000,
          }),
        ])
      : [[], []];
    const hooksBySignature = new Map<string, AgentHookDto>();
    for (const hook of [...globalHooks, ...projectHooks, ...officialHooks]) {
      const signature = [
        hook.sourcePath,
        hook.eventName,
        hook.matcher ?? '',
        hook.command ?? '',
        hook.timeoutSec,
        hook.statusMessage ?? '',
      ].join('\0');
      hooksBySignature.set(signature, hook);
    }

    return {
      cwd: entry?.cwd ?? workspacePath,
      hooks: [...hooksBySignature.values()].sort(
        (left, right) => left.displayOrder - right.displayOrder,
      ),
      warnings: [...fallbackWarnings, ...(entry?.warnings ?? [])],
      errors: entry?.errors ?? [],
      globalHooksPath,
      projectHooksPath,
    };
  }
}
