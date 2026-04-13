import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { CodexAppServerManager } from './appServerManager';

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
});
