import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenCodeRuntimeAdapter } from './runtimeAdapter';

const tempDirs: string[] = [];

async function tempHome() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remote-codex-opencode-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, {
    recursive: true,
    force: true,
  })));
});

describe('OpenCodeRuntimeAdapter', () => {
  it('keeps provider and variant in model selections', async () => {
    const sessionCreate = vi.fn(async () => ({
      id: 'session-1',
      directory: '/tmp/project',
      model: {
        id: 'gpt-5',
        providerID: 'openai',
        variant: 'fast',
      },
    }));
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            model: {
              list: async () => ({
                data: [
                  {
                    id: 'gpt-5',
                    providerID: 'openai',
                    name: 'GPT-5',
                    variants: [{ id: 'fast' }],
                    enabled: true,
                  },
                  {
                    id: 'sonnet-4.5',
                    providerID: 'anthropic',
                    name: 'Claude Sonnet',
                    variants: [{ id: 'default' }],
                    enabled: false,
                  },
                ],
              }),
            },
            session: {
              list: async () => [],
              create: sessionCreate,
              get: async () => ({}),
              messages: async () => [],
              prompt: async () => ({}),
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });

    await adapter.start();

    const models = await adapter.listModels();
    expect(models.map((model) => model.model)).toEqual([
      'openai/gpt-5@fast',
      'anthropic/sonnet-4.5@default',
    ]);
    expect(models[1]!.hidden).toBe(true);

    await adapter.startSession({
      cwd: '/tmp/project',
      model: 'openai/gpt-5@fast',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });

    expect(sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/tmp/project',
      model: {
        id: 'gpt-5',
        providerID: 'openai',
        variant: 'fast',
      },
    }));
  });

  it('reads provider model catalog from the v2 config providers endpoint', async () => {
    const configProviders = vi.fn(async () => ({
      data: {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            source: 'config',
            models: {
              'gpt-5.5': {
                id: 'gpt-5.5',
                providerID: 'openai',
                name: 'GPT-5.5',
                capabilities: { reasoning: true },
                variants: {
                  none: { reasoningEffort: 'none' },
                  low: { reasoningEffort: 'low' },
                  medium: { reasoningEffort: 'medium' },
                  high: { reasoningEffort: 'high' },
                  xhigh: { reasoningEffort: 'xhigh' },
                },
                status: 'active',
              },
            },
          },
          {
            id: 'opencode',
            name: 'OpenCode Zen',
            models: {
              'deepseek-v4-flash-free': {
                id: 'deepseek-v4-flash-free',
                providerID: 'opencode',
                name: 'DeepSeek V4 Flash Free',
                capabilities: { reasoning: true },
                variants: {
                  low: { reasoningEffort: 'low' },
                  high: { reasoningEffort: 'high' },
                },
                status: 'active',
              },
            },
          },
        ],
      },
    }));
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            config: {
              get: async () => ({
                provider: {
                  openai: {
                    models: {
                      'gpt-5.5': {
                        name: 'GPT-5.5',
                        variants: {
                          low: {},
                          medium: {},
                          high: {},
                          xhigh: {},
                        },
                      },
                    },
                  },
                },
              }),
              providers: configProviders,
            },
            session: {
              list: async () => [],
              create: async () => ({}),
              get: async () => ({}),
              messages: async () => [],
              prompt: async () => ({}),
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });

    await adapter.start();

    const models = await adapter.listModels();
    expect(configProviders).toHaveBeenCalledWith();
    expect(models).toEqual([
      expect.objectContaining({
        model: 'openai/gpt-5.5',
        displayName: 'GPT-5.5 (OpenAI)',
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Low reasoning' },
          { reasoningEffort: 'medium', description: 'Medium reasoning' },
          { reasoningEffort: 'high', description: 'High reasoning' },
          { reasoningEffort: 'xhigh', description: 'Maximum reasoning' },
        ],
      }),
    ]);
  });

  it('uses the legacy session prompt endpoint because v2 prompt is not available yet', async () => {
    const sessionPrompt = vi.fn(async () => ({
      info: {
        id: 'assistant-message-1',
        type: 'assistant',
        text: 'hello',
      },
      parts: [],
    }));
    const v2Prompt = vi.fn(async () => {
      throw new Error('V2 session prompt is not available yet');
    });
    const wait = vi.fn(async () => ({}));
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            v2: {
              session: {
                messages: async () => [],
                prompt: v2Prompt,
                wait,
              },
            },
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              messages: async () => [],
              prompt: sessionPrompt,
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.start();
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'hi',
      model: 'opencode/big-pickle',
      reasoningEffort: 'low',
      workspacePath: '/tmp/project',
    });

    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: 'turn.completed',
      }));
    });
    expect(v2Prompt).not.toHaveBeenCalled();
    expect(sessionPrompt).toHaveBeenCalledWith({
      sessionID: 'session-1',
      directory: '/tmp/project',
      model: {
        providerID: 'opencode',
        modelID: 'big-pickle',
      },
      variant: 'low',
      parts: [{ type: 'text', text: 'hi' }],
    });
    expect(wait).toHaveBeenCalledWith({
      sessionID: 'session-1',
      directory: '/tmp/project',
    });
  });

  it('uses the OpenCode plan agent for plan collaboration mode', async () => {
    const sessionPrompt = vi.fn(async () => ({
      info: {
        id: 'assistant-message-1',
        role: 'assistant',
        time: { created: 2, completed: 3 },
      },
      parts: [{ type: 'text', text: 'Plan ready.' }],
    }));
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              messages: async () => [
                {
                  info: {
                    id: 'user-message-1',
                    role: 'user',
                    time: { created: 1 },
                  },
                  parts: [{ type: 'text', text: 'plan it' }],
                },
                {
                  info: {
                    id: 'assistant-message-1',
                    role: 'assistant',
                    time: { created: 2, completed: 3 },
                  },
                  parts: [{ type: 'text', text: 'Plan ready.' }],
                },
              ],
              prompt: sessionPrompt,
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.start();
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'plan it',
      model: 'opencode/big-pickle',
      collaborationMode: 'plan',
      workspacePath: '/tmp/project',
    });

    await vi.waitFor(() => {
      expect(sessionPrompt).toHaveBeenCalledWith(expect.objectContaining({
        agent: 'plan',
      }));
    });
    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: 'turn.completed',
        turn: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              kind: 'plan',
              text: 'Plan ready.',
            }),
          ]),
        }),
      }));
    });
  });

  it('falls back to legacy session APIs when v2 session reads or waits are unavailable', async () => {
    const sessionPrompt = vi.fn(async () => ({
      info: {
        id: 'assistant-message-1',
        type: 'assistant',
        text: 'hello',
      },
      parts: [],
    }));
    const legacyMessages = vi.fn(async () => [
      {
        info: {
          id: 'user-message-1',
          role: 'user',
          time: { created: 1 },
        },
        parts: [{ type: 'text', text: 'hi' }],
      },
      {
        info: {
          id: 'assistant-message-1',
          role: 'assistant',
          time: { created: 2, completed: 3 },
        },
        parts: [{ type: 'text', text: 'hello' }],
      },
    ]);
    const v2Messages = vi.fn(async () => {
      throw new Error('V2 session messages are not available yet');
    });
    const v2Wait = vi.fn(async () => {
      throw new Error('V2 session wait failed');
    });
    const legacyWait = vi.fn(async () => ({}));
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            v2: {
              session: {
                messages: v2Messages,
                wait: v2Wait,
              },
            },
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              messages: legacyMessages,
              prompt: sessionPrompt,
              wait: legacyWait,
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.start();
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'hi',
      model: 'opencode/big-pickle',
      workspacePath: '/tmp/project',
    });

    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: 'turn.completed',
      }));
    });
    expect(sessionPrompt).toHaveBeenCalledOnce();
    expect(v2Wait).toHaveBeenCalledOnce();
    expect(legacyWait).toHaveBeenCalledWith({
      sessionID: 'session-1',
      directory: '/tmp/project',
    });
    expect(v2Messages).not.toHaveBeenCalled();
    expect(legacyMessages).toHaveBeenCalledWith({
      sessionID: 'session-1',
      directory: '/tmp/project',
    });
  });

  it('uses legacy messages before v2 messages because v2 can omit assistant content', async () => {
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            v2: {
              session: {
                messages: async () => ({
                  items: [
                    { id: 'model-1', type: 'model-switched', model: { id: 'gpt-5.5', providerID: 'openai', variant: 'low' } },
                    { id: 'agent-1', type: 'agent-switched', agent: 'build' },
                  ],
                }),
              },
            },
            session: {
              list: async () => [],
              create: async () => ({}),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              messages: async () => [
                {
                  info: {
                    id: 'user-message-1',
                    role: 'user',
                    time: { created: 1 },
                  },
                  parts: [{ type: 'text', text: 'hi' }],
                },
                {
                  info: {
                    id: 'assistant-message-1',
                    role: 'assistant',
                    time: { created: 2, completed: 3 },
                  },
                  parts: [{ type: 'text', text: 'hello' }],
                },
              ],
              prompt: async () => ({}),
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });

    await adapter.start();
    const detail = await adapter.readSession('session-1', { workspacePath: '/tmp/project' });

    expect(detail.turns.at(-1)?.items).toContainEqual(expect.objectContaining({
      kind: 'agentMessage',
      text: 'hello',
    }));
  });

  it('does not complete a new turn from an older assistant message', async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [
      {
        info: {
          id: 'old-user-message',
          role: 'user',
          time: { created: 1 },
        },
        parts: [{ type: 'text', text: 'old hi' }],
      },
      {
        info: {
          id: 'old-assistant-message',
          role: 'assistant',
          time: { created: 2, completed: 3 },
        },
        parts: [{ type: 'text', text: 'old reply' }],
      },
    ];
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              status: async () => ({
                'session-1': { type: 'idle' },
              }),
              messages: async () => messages,
              prompt: async () => {
                messages.push({
                  info: {
                    id: 'new-user-message',
                    role: 'user',
                    time: { created: 4 },
                  },
                  parts: [{ type: 'text', text: 'new hi' }],
                });
                return new Promise(() => {});
              },
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.start();
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'new hi',
      model: 'opencode/big-pickle',
      workspacePath: '/tmp/project',
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'turn.completed',
    }));
    vi.useRealTimers();
  });

  it('emits live item events while polling OpenCode messages', async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [
      {
        info: {
          id: 'old-user-message',
          role: 'user',
          time: { created: 1 },
        },
        parts: [{ type: 'text', text: 'old hi' }],
      },
      {
        info: {
          id: 'old-assistant-message',
          role: 'assistant',
          time: { created: 2, completed: 3 },
        },
        parts: [{ type: 'text', text: 'old reply' }],
      },
    ];
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              status: async () => ({
                'session-1': { type: 'idle' },
              }),
              messages: async () => messages,
              prompt: async () => {
                messages.push(
                  {
                    info: {
                      id: 'new-user-message',
                      role: 'user',
                      time: { created: 4 },
                    },
                    parts: [{ type: 'text', text: 'new hi' }],
                  },
                  {
                    info: {
                      id: 'new-assistant-message',
                      role: 'assistant',
                      time: { created: 5, completed: 6 },
                    },
                    parts: [{ id: 'new-text-part', type: 'text', text: 'new reply' }],
                  },
                );
                return new Promise(() => {});
              },
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.start();
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'new hi',
      model: 'opencode/big-pickle',
      workspacePath: '/tmp/project',
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(events).toContainEqual(expect.objectContaining({
      type: 'item.completed',
      item: expect.objectContaining({
        kind: 'agentMessage',
        text: 'new reply',
      }),
    }));
    vi.useRealTimers();
  });

  it('keeps polling after completed todo tools until an assistant message arrives', async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    let busy = true;
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              status: async () => ({
                'session-1': { type: busy ? 'busy' : 'idle' },
              }),
              messages: async () => messages,
              prompt: async () => {
                messages.push(
                  {
                    info: {
                      id: 'new-user-message',
                      role: 'user',
                      time: { created: 1 },
                    },
                    parts: [{ type: 'text', text: 'new hi' }],
                  },
                  {
                    info: {
                      id: 'todo-message',
                      role: 'assistant',
                      time: { created: 2 },
                    },
                    parts: [
                      {
                        id: 'todo-part',
                        type: 'tool',
                        tool: 'todowrite',
                        state: {
                          status: 'completed',
                          input: {
                            todos: [
                              {
                                content: 'Inspect code',
                                status: 'in_progress',
                                priority: 'high',
                              },
                            ],
                          },
                          output: '[]',
                          title: '1 todo',
                          metadata: {},
                        },
                      },
                    ],
                  },
                );
                setTimeout(() => {
                  messages.push({
                    info: {
                      id: 'assistant-message',
                      role: 'assistant',
                      time: { created: 3, completed: 4 },
                    },
                    parts: [{ id: 'text-part', type: 'text', text: 'done' }],
                  });
                  busy = false;
                }, 1_500);
                return new Promise(() => {});
              },
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.start();
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'new hi',
      model: 'opencode/big-pickle',
      workspacePath: '/tmp/project',
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(events).toContainEqual(expect.objectContaining({
      type: 'plan.updated',
      explanation: null,
      plan: [
        {
          step: 'Inspect code',
          status: 'in_progress',
        },
      ],
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'turn.completed',
    }));

    await vi.advanceTimersByTimeAsync(1_500);
    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: 'turn.completed',
        turn: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              kind: 'agentMessage',
              text: 'done',
            }),
          ]),
        }),
      }));
    });

    vi.useRealTimers();
  });

  it('keeps a turn running while OpenCode status is busy after assistant text', async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    let busy = true;
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              status: async () => ({
                'session-1': { type: busy ? 'busy' : 'idle' },
              }),
              messages: async () => messages,
              prompt: async () => {
                messages.push(
                  {
                    info: {
                      id: 'user-message',
                      role: 'user',
                      time: { created: 1 },
                    },
                    parts: [{ type: 'text', text: 'new hi' }],
                  },
                  {
                    info: {
                      id: 'assistant-message',
                      role: 'assistant',
                      time: { created: 2 },
                    },
                    parts: [{ id: 'text-part', type: 'text', text: 'partial reply' }],
                  },
                );
                setTimeout(() => {
                  busy = false;
                }, 1_500);
                return new Promise(() => {});
              },
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.start();
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'new hi',
      model: 'opencode/big-pickle',
      workspacePath: '/tmp/project',
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(events).toContainEqual(expect.objectContaining({
      type: 'item.completed',
      item: expect.objectContaining({
        kind: 'agentMessage',
        text: 'partial reply',
      }),
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'turn.completed',
    }));

    await vi.advanceTimersByTimeAsync(1_500);

    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.completed',
      turn: expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            kind: 'agentMessage',
            text: 'partial reply',
          }),
        ]),
      }),
    }));
    vi.useRealTimers();
  });

  it('treats string OpenCode session status values as terminal status', async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    let busy = true;
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              status: async () => ({
                'session-1': busy ? 'busy' : 'idle',
              }),
              messages: async () => messages,
              prompt: async () => {
                messages.push(
                  {
                    info: {
                      id: 'user-message',
                      role: 'user',
                      time: { created: 1 },
                    },
                    parts: [{ type: 'text', text: 'new hi' }],
                  },
                  {
                    info: {
                      id: 'assistant-message',
                      role: 'assistant',
                      time: { created: 2 },
                    },
                    parts: [{ id: 'text-part', type: 'text', text: 'done' }],
                  },
                );
                setTimeout(() => {
                  busy = false;
                }, 1_500);
                return new Promise(() => {});
              },
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.start();
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'new hi',
      model: 'opencode/big-pickle',
      workspacePath: '/tmp/project',
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'turn.completed',
    }));

    await vi.advanceTimersByTimeAsync(1_500);

    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.completed',
      turn: expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            kind: 'agentMessage',
            text: 'done',
          }),
        ]),
      }),
    }));
    vi.useRealTimers();
  });

  it('emits token usage from OpenCode step finish parts', async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              status: async () => ({
                'session-1': { type: 'idle' },
              }),
              messages: async () => messages,
              prompt: async () => {
                messages.push(
                  {
                    info: {
                      id: 'user-message-1',
                      role: 'user',
                      time: { created: 1 },
                    },
                    parts: [{ type: 'text', text: 'hi' }],
                  },
                  {
                    info: {
                      id: 'assistant-message-1',
                      role: 'assistant',
                      time: { created: 2, completed: 3 },
                    },
                    parts: [
                      { id: 'text-1', type: 'text', text: 'done' },
                      {
                        id: 'finish-1',
                        type: 'step-finish',
                        tokens: {
                          input: 140000,
                          output: 25200,
                          reasoning: 1200,
                          cache: { read: 8200, write: 0 },
                          contextWindow: 258400,
                        },
                      },
                    ],
                  },
                );
                return new Promise(() => {});
              },
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.start();
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'hi',
      model: 'openai/gpt-5.5',
      workspacePath: '/tmp/project',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: 'usage.updated',
        provider: 'opencode',
        usage: {
          total: {
            totalTokens: 165200,
            inputTokens: 140000,
            cachedInputTokens: 8200,
            outputTokens: 25200,
            reasoningOutputTokens: 1200,
          },
          last: {
            totalTokens: 165200,
            inputTokens: 140000,
            cachedInputTokens: 8200,
            outputTokens: 25200,
            reasoningOutputTokens: 1200,
          },
          modelContextWindow: 258400,
          cumulative: false,
        },
      }));
    });

    vi.useRealTimers();
  });

  it('maps sandbox modes to OpenCode session permissions', async () => {
    const sessionCreate = vi.fn(async () => ({
      id: 'session-1',
      directory: '/tmp/project',
    }));
    const sessionUpdate = vi.fn(async () => ({}));
    const sessionPrompt = vi.fn(async () => ({
      info: {
        id: 'assistant-message-1',
        role: 'assistant',
        time: { created: 2, completed: 3 },
      },
      parts: [{ type: 'text', text: 'done' }],
    }));
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            session: {
              list: async () => [],
              create: sessionCreate,
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              update: sessionUpdate,
              messages: async () => [
                {
                  info: {
                    id: 'user-message-1',
                    role: 'user',
                    time: { created: 1 },
                  },
                  parts: [{ type: 'text', text: 'hi' }],
                },
                {
                  info: {
                    id: 'assistant-message-1',
                    role: 'assistant',
                    time: { created: 2, completed: 3 },
                  },
                  parts: [{ type: 'text', text: 'done' }],
                },
              ],
              prompt: sessionPrompt,
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });

    await adapter.start();
    expect(adapter.capabilities.controls.sandboxMode).toBe(false);
    await adapter.startSession({
      cwd: '/tmp/project',
      model: 'opencode/big-pickle',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'hi',
      model: 'opencode/big-pickle',
      workspacePath: '/tmp/project',
      sandboxMode: 'danger-full-access',
    });

    expect(sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      permission: expect.arrayContaining([
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: '*', action: 'ask' },
        { permission: 'external_directory', pattern: '*', action: 'ask' },
      ]),
    }));
    expect(sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'session-1',
      directory: '/tmp/project',
      permission: expect.arrayContaining([
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: '*', action: 'allow' },
        { permission: 'external_directory', pattern: '*', action: 'allow' },
      ]),
    }));
  });

  it('does not append duplicate OpenCode permissions when sandbox mode is unchanged', async () => {
    const sessionUpdate = vi.fn(async () => ({}));
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              update: sessionUpdate,
              messages: async () => [
                {
                  info: {
                    id: 'user-message-1',
                    role: 'user',
                    time: { created: 1 },
                  },
                  parts: [{ type: 'text', text: 'hi' }],
                },
                {
                  info: {
                    id: 'assistant-message-1',
                    role: 'assistant',
                    time: { created: 2, completed: 3 },
                  },
                  parts: [{ type: 'text', text: 'done' }],
                },
              ],
              prompt: async () => ({
                info: {
                  id: 'assistant-message-1',
                  role: 'assistant',
                  time: { created: 2, completed: 3 },
                },
                parts: [{ type: 'text', text: 'done' }],
              }),
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });

    await adapter.start();
    await adapter.startSession({
      cwd: '/tmp/project',
      model: 'opencode/big-pickle',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'hi',
      model: 'opencode/big-pickle',
      workspacePath: '/tmp/project',
      sandboxMode: 'workspace-write',
    });

    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it('updates OpenCode permissions when sandbox mode changes', async () => {
    const sessionUpdate = vi.fn(async () => ({}));
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              update: sessionUpdate,
              messages: async () => [
                {
                  info: {
                    id: 'user-message-1',
                    role: 'user',
                    time: { created: 1 },
                  },
                  parts: [{ type: 'text', text: 'hi' }],
                },
                {
                  info: {
                    id: 'assistant-message-1',
                    role: 'assistant',
                    time: { created: 2, completed: 3 },
                  },
                  parts: [{ type: 'text', text: 'done' }],
                },
              ],
              prompt: async () => ({
                info: {
                  id: 'assistant-message-1',
                  role: 'assistant',
                  time: { created: 2, completed: 3 },
                },
                parts: [{ type: 'text', text: 'done' }],
              }),
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });

    await adapter.start();
    await adapter.startSession({
      cwd: '/tmp/project',
      model: 'opencode/big-pickle',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'hi',
      model: 'opencode/big-pickle',
      workspacePath: '/tmp/project',
      sandboxMode: 'danger-full-access',
    });

    expect(sessionUpdate).toHaveBeenCalledOnce();
  });

  it('completes turns from legacy prompt responses when session wait does not return', async () => {
    vi.useFakeTimers();
    const sessionPrompt = vi.fn(async () => ({
      info: {
        id: 'assistant-message-1',
        role: 'assistant',
        time: { created: 1_700_000_000_000, completed: 1_700_000_001_000 },
      },
      parts: [{ id: 'part-1', type: 'text', text: 'hello from opencode' }],
    }));
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
      sdk: {
        createOpencode: async () => ({
          client: {
            v2: {
              session: {
                messages: async () => ({ items: [] }),
                wait: vi.fn(() => new Promise(() => {})),
              },
            },
            session: {
              list: async () => [],
              create: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              get: async () => ({
                id: 'session-1',
                directory: '/tmp/project',
              }),
              messages: async () => [],
              prompt: sessionPrompt,
              abort: async () => ({}),
            },
          },
          server: {
            url: 'http://127.0.0.1:4099',
            close() {},
          },
        }),
      },
    });
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.start();
    await adapter.startTurn({
      providerSessionId: 'session-1',
      prompt: 'hi',
      model: 'opencode/big-pickle',
      workspacePath: '/tmp/project',
    });
    await vi.advanceTimersByTimeAsync(1_500);

    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: 'turn.completed',
        turn: expect.objectContaining({
          items: [expect.objectContaining({
            kind: 'agentMessage',
            text: 'hello from opencode',
          })],
        }),
      }));
    });
    vi.useRealTimers();
  });

  it('reports missing SDK as an unavailable installation instead of throwing', async () => {
    const adapter = new OpenCodeRuntimeAdapter({
      home: await tempHome(),
    });

    await adapter.start();

    expect(adapter.installation.installed).toBe(false);
    expect(adapter.installation.lastError).toContain('Install OpenCode support');
    expect(adapter.getStatus()).toMatchObject({
      state: 'stopped',
      transport: 'sdk',
    });
  });
});
