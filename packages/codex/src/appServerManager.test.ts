import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { CodexAppServerManager } from './appServerManager';
import type { CodexUserInput } from './types';

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 1000,
) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

class ScriptedChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin: Writable;

  constructor(
    private readonly options: {
      initializeDelayMs?: number;
      exitOnKillDelayMs?: number;
    } = {},
  ) {
    super();

    let buffer = '';
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          const message = JSON.parse(trimmed);
          if (message.method === 'initialize') {
            const delay = this.options.initializeDelayMs ?? 0;
            setTimeout(() => {
              this.stdout.write(
                `${JSON.stringify({
                  id: message.id,
                  result: {
                    userAgent: 'fake',
                    codexHome: '/tmp',
                    platformFamily: 'unix',
                    platformOs: 'linux',
                  },
                })}\n`,
              );
            }, delay);
          }
        }

        callback();
      },
    });
  }

  kill() {
    const delay = this.options.exitOnKillDelayMs ?? 0;
    setTimeout(() => {
      this.stdout.end();
      this.emit('exit', 0, 'SIGTERM');
    }, delay);
    return true;
  }
}

describe('CodexAppServerManager', () => {
  it('starts against a newline-delimited JSON-RPC process', async () => {
    const script = [
      "const readline=require('node:readline');",
      "const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});",
      "rl.on('line',(line)=>{",
      " const msg=JSON.parse(line);",
      " if(msg.method==='initialize'){",
      "  if(!msg.params?.capabilities?.experimentalApi){ process.stderr.write('missing experimentalApi\\n'); process.exit(1); }",
      "  process.stdout.write(JSON.stringify({id:msg.id,result:{userAgent:'fake',codexHome:'/tmp',platformFamily:'unix',platformOs:'macos'}})+'\\n');",
      " } else if(msg.method==='model/list'){",
      "  process.stdout.write(JSON.stringify({id:msg.id,result:{data:[{id:'m1',model:'gpt-5',displayName:'GPT-5',description:'desc',hidden:false,isDefault:true}],nextCursor:null}})+'\\n');",
      " }",
      "});"
    ].join('');

    const manager = new CodexAppServerManager({
      command: process.execPath,
      startupTimeoutMs: 1000,
      clientInfo: {
        name: 'test',
        title: 'test',
        version: '0.1.0'
      },
      spawnProcess: (command) => {
        return spawn(command, ['-e', script], { stdio: 'pipe' });
      }
    });

    await manager.start();
    const models = await manager.listModels();

    expect(manager.getStatus().state).toBe('ready');
    expect(models[0]?.model).toBe('gpt-5');

    await manager.stop();
  });

  it('surfaces spawn failures as a failed status instead of crashing', async () => {
    class FailingChild extends EventEmitter {
      stdout = new PassThrough();
      stdin = new PassThrough();
      stderr = new PassThrough();
      kill() {
        return true;
      }
    }

    const manager = new CodexAppServerManager({
      command: 'missing-codex',
      startupTimeoutMs: 1000,
      clientInfo: {
        name: 'test',
        title: 'test',
        version: '0.1.0'
      },
      spawnProcess: () => {
        const child = new FailingChild();
        queueMicrotask(() => {
          child.emit('error', new Error('spawn missing-codex ENOENT'));
        });
        return child as any;
      }
    });

    await expect(manager.start()).rejects.toMatchObject({
      code: 'spawn_failed'
    });
    expect(manager.getStatus()).toMatchObject({
      state: 'failed'
    });
  });

  it('uses expectedTurnId when steering a running turn', async () => {
    const script = [
      "const readline=require('node:readline');",
      "const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});",
      "rl.on('line',(line)=>{",
      " const msg=JSON.parse(line);",
      " if(msg.method==='initialize'){",
      "  process.stdout.write(JSON.stringify({id:msg.id,result:{userAgent:'fake',codexHome:'/tmp',platformFamily:'unix',platformOs:'linux'}})+'\\n');",
      " } else if(msg.method==='turn/steer'){",
      "  if(msg.params?.threadId==='thread-1' && msg.params?.expectedTurnId==='turn-1' && !('turnId' in msg.params)){",
      "   process.stdout.write(JSON.stringify({id:msg.id,result:{turn:{id:'turn-1',status:'inProgress',items:[]}}})+'\\n');",
      "  } else {",
      "   process.stdout.write(JSON.stringify({id:msg.id,error:{code:-32600,message:'bad steer params'}})+'\\n');",
      "  }",
      " }",
      "});"
    ].join('');

    const manager = new CodexAppServerManager({
      command: process.execPath,
      startupTimeoutMs: 1000,
      clientInfo: {
        name: 'test',
        title: 'test',
        version: '0.1.0'
      },
      spawnProcess: (command) => {
        return spawn(command, ['-e', script], { stdio: 'pipe' });
      }
    });

    await manager.start();
    const turn = await manager.steerTurn({
      threadId: 'thread-1',
      turnId: 'turn-1',
      prompt: 'Follow up',
    });

    expect(turn).toMatchObject({
      id: 'turn-1',
      status: 'inProgress',
    });

    await manager.stop();
  });

  it('forwards structured image input when starting a turn', async () => {
    const expectedInput: CodexUserInput[] = [
      { type: 'text', text: 'Inspect this ', text_elements: [] },
      { type: 'localImage', path: '/tmp/workspace/photo.png' },
      { type: 'text', text: ' and summarize.', text_elements: [] },
    ];
    const script = [
      "const readline=require('node:readline');",
      "const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});",
      `const expectedInput=${JSON.stringify(expectedInput)};`,
      "rl.on('line',(line)=>{",
      " const msg=JSON.parse(line);",
      " if(msg.method==='initialize'){",
      "  process.stdout.write(JSON.stringify({id:msg.id,result:{userAgent:'fake',codexHome:'/tmp',platformFamily:'unix',platformOs:'linux'}})+'\\n');",
      " } else if(msg.method==='turn/start'){",
      "  if(JSON.stringify(msg.params?.input)===JSON.stringify(expectedInput)){",
      "   process.stdout.write(JSON.stringify({id:msg.id,result:{turn:{id:'turn-1',status:'completed',items:[]}}})+'\\n');",
      "  } else {",
      "   process.stdout.write(JSON.stringify({id:msg.id,error:{code:-32600,message:'bad start input',data:msg.params}})+'\\n');",
      "  }",
      " }",
      "});"
    ].join('');

    const manager = new CodexAppServerManager({
      command: process.execPath,
      startupTimeoutMs: 1000,
      clientInfo: {
        name: 'test',
        title: 'test',
        version: '0.1.0'
      },
      spawnProcess: (command) => {
        return spawn(command, ['-e', script], { stdio: 'pipe' });
      }
    });

    await manager.start();
    const turn = await manager.startTurn({
      threadId: 'thread-1',
      prompt: 'Inspect this [PHOTO photo.png] and summarize.',
      input: expectedInput,
    });

    expect(turn).toMatchObject({
      id: 'turn-1',
      status: 'completed',
    });

    await manager.stop();
  });

  it('writes hook trust state through config batch writes', async () => {
    const requests: any[] = [];
    const script = [
      "const readline=require('node:readline');",
      "const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});",
      "rl.on('line',(line)=>{",
      " const msg=JSON.parse(line);",
      " if(msg.method==='initialize'){",
      "  process.stdout.write(JSON.stringify({id:msg.id,result:{userAgent:'fake',codexHome:'/tmp',platformFamily:'unix',platformOs:'linux'}})+'\\n');",
      " } else if(msg.method==='config/batchWrite'){",
      "  process.stderr.write(JSON.stringify(msg)+'\\n');",
      "  process.stdout.write(JSON.stringify({id:msg.id,result:{status:'ok',version:'v1',filePath:'/tmp/config.toml',overriddenMetadata:null}})+'\\n');",
      " }",
      "});"
    ].join('');

    const manager = new CodexAppServerManager({
      command: process.execPath,
      startupTimeoutMs: 1000,
      clientInfo: {
        name: 'test',
        title: 'test',
        version: '0.1.0'
      },
      spawnProcess: (command) => {
        const child = spawn(command, ['-e', script], { stdio: 'pipe' });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
          const lines = stderr.split('\n');
          stderr = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim()) {
              requests.push(JSON.parse(line));
            }
          }
        });
        return child;
      }
    });

    await manager.start();
    await manager.setHookTrust({
      key: '/tmp/repo/.codex/hooks.json:stop:0:0',
      trustedHash: 'sha256:abc',
    });
    await manager.setHookTrust({
      key: '/tmp/repo/.codex/hooks.json:stop:0:0',
      trustedHash: null,
    });
    await waitForCondition(() => requests.length === 2);

    expect(requests).toEqual([
      expect.objectContaining({
        method: 'config/batchWrite',
        params: {
          edits: [
            {
              keyPath: 'hooks.state',
              mergeStrategy: 'upsert',
              value: {
                '/tmp/repo/.codex/hooks.json:stop:0:0': {
                  enabled: true,
                  trusted_hash: 'sha256:abc',
                },
              },
            },
          ],
          reloadUserConfig: true,
        },
      }),
      expect.objectContaining({
        method: 'config/batchWrite',
        params: {
          edits: [
            {
              keyPath: 'hooks.state',
              mergeStrategy: 'upsert',
              value: {
                '/tmp/repo/.codex/hooks.json:stop:0:0': {
                  trusted_hash: '',
                },
              },
            },
          ],
          reloadUserConfig: true,
        },
      }),
    ]);

    await manager.stop();
  });

  it('does not let a stale child exit close the replacement app-server client during restart', async () => {
    const firstChild = new ScriptedChild({
      initializeDelayMs: 0,
      exitOnKillDelayMs: 5,
    });
    const secondChild = new ScriptedChild({
      initializeDelayMs: 15,
      exitOnKillDelayMs: 0,
    });
    const spawnedChildren = [firstChild, secondChild];

    const manager = new CodexAppServerManager({
      command: 'fake-codex',
      startupTimeoutMs: 1000,
      clientInfo: {
        name: 'test',
        title: 'test',
        version: '0.1.0',
      },
      spawnProcess: () => {
        const child = spawnedChildren.shift();
        if (!child) {
          throw new Error('No scripted child available');
        }
        return child as any;
      },
    });

    await manager.start();
    await manager.stop();
    await expect(manager.start()).resolves.toBeUndefined();
    expect(manager.getStatus().state).toBe('ready');

    await manager.stop();
  });
});
