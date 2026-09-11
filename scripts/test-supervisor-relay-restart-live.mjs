// Run only in the isolated Treer Linux machine. No production credentials or model calls.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
const {values:opts}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'},npm:{type:'string'}}});
assert(process.platform==='linux' && opts.binary && opts.directory && opts.npm, 'Run in Treer with --binary, --directory, --npm');
const directory=fs.mkdtempSync(path.join(path.resolve(opts.directory),'relay-restart-'));
const binary=path.resolve(opts.binary);
const version=spawnSync(binary,['version'],{encoding:'utf8'}).stdout.trim();
assert.match(version,/^\d+\.\d+\.\d+$/);
const modules=path.join(directory,'prefix/lib/node_modules');
const root=path.join(modules,'remote-codex');
fs.mkdirSync(root,{recursive:true});fs.symlinkSync(path.resolve(opts.npm),path.join(modules,'npm'));
fs.cpSync(new URL('../npm/remote-codex/bin',import.meta.url),path.join(root,'bin'),{recursive:true});
fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'remote-codex',version,type:'module'}));
const launcher=path.join(root,'bin/remote-codex.mjs');
const password=crypto.randomBytes(24).toString('hex');
const secret=crypto.randomBytes(32).toString('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function until(check){const end=Date.now()+90000;let last;while(Date.now()<end){try{const value=await check();if(value)return value;}catch(e){last=e;}await pause(200);}throw Error(`Timed out: ${last?.message??'condition not reached'}`);}
const relayPort=await port(),supervisorPort=await port();
const relayBase=`http://127.0.0.1:${relayPort}`;
const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('REMOTE_CODEX_')&&!['DATABASE_URL','WORKSPACE_ROOT','HOST','PORT','NODE_OPTIONS'].includes(key)));
const relayFd=fs.openSync(path.join(directory,'relay.log'),'a');
const relay=spawn(binary,['relay'],{cwd:directory,env:{...clean,HOST:'127.0.0.1',PORT:String(relayPort),REMOTE_CODEX_ADMIN_USERNAME:'admin',REMOTE_CODEX_ADMIN_PASSWORD:password,REMOTE_CODEX_SESSION_SECRET:secret,REMOTE_CODEX_RELAY_DATA_DIR:path.join(directory,'relay'),REMOTE_CODEX_RELAY_REGISTRATION_ENABLED:'true',REMOTE_CODEX_RELAY_SESSION_SECRET:secret},stdio:['ignore',relayFd,relayFd]});
fs.closeSync(relayFd);
let token,initialLauncher,ownedPid;
async function api(route,body){const res=await fetch(relayBase+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',origin:relayBase,...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(7000)});assert(res.ok,`${route}: HTTP ${res.status}`);return res.json();}
try {
 await until(()=>api('/healthz'));
 await api('/relay/auth/register',{username:'owner',email:'owner@example.test',password});
 token=(await api('/relay/auth/login',{username:'owner',password})).token;
 const device=await api('/relay/devices',{name:'Restart verification'});
 const cfg=path.join(directory,'device.json');
 fs.writeFileSync(cfg,JSON.stringify({REMOTE_CODEX_RELAY_SERVER_URL:`ws://127.0.0.1:${relayPort}`,REMOTE_CODEX_RELAY_AGENT_TOKEN:device.token,REMOTE_CODEX_RELAY_SUPERVISOR_PORT:String(supervisorPort),REMOTE_CODEX_DATABASE_PATH:path.join(directory,'supervisor.sqlite'),REMOTE_CODEX_ADMIN_USERNAME:'admin',REMOTE_CODEX_ADMIN_PASSWORD:password,REMOTE_CODEX_SESSION_SECRET:secret}),{mode:0o600});
 const hook=path.join(directory,'offline.mjs');
 fs.writeFileSync(hook,"const original=globalThis.fetch;globalThis.fetch=(url,opts)=>{if(!String(url).startsWith('http://127.0.0.1:'))throw Error('Unexpected registry access');return original(url,opts)}");
 const fd=fs.openSync(path.join(directory,'initial-launch.log'),'a');
 initialLauncher=spawn(process.execPath,[launcher,'relay-supervisor','start'],{cwd:directory,env:{...clean,NODE_OPTIONS:`--import=${hook}`,REMOTE_CODEX_NATIVE_BINARY:binary,REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG:cfg,REMOTE_CODEX_RELAY_SUPERVISOR_TMUX:'0',REMOTE_CODEX_RELAY_SUPERVISOR_LOG:''},stdio:['ignore',fd,fd]});
 fs.closeSync(fd);
 const prefix=`/relay/devices/${device.device.id}`;
 console.log(JSON.stringify({phase:'waiting for device',directory}));
 const before=await until(async()=>{const h=await api(prefix+'/healthz');return h.relayConnected?h:false;});ownedPid=before.processId;
 const pids=[ownedPid];
 for(let attempt=0;attempt<2;attempt++){
  const accepted=await api(prefix+'/api/management/supervisor/restart',{});
  assert.equal(accepted.job.action,'restart');
  console.log(JSON.stringify({phase:'restart accepted',attempt:attempt+1}));
  const after=await until(async()=>{const h=await api(prefix+'/healthz');return h.processId!==ownedPid&&h.relayConnected?h:false;});
  ownedPid=after.processId;pids.push(ownedPid);
  const done=await until(async()=>{const s=await api(prefix+'/api/management/supervisor');return s.job.phase==='completed'?s:false;});
  assert.equal(done.runningVersion,version);assert.equal(done.canRestart,true);
  assert.equal((await api(prefix+'/presence')).connected,true);
 }
 assert.equal(new Set(pids).size,3);
 const result={ok:true,directory,version,pids,relayConnected:true,completedRestarts:2,emptyLogOverride:true};
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
 if(ownedPid){try{process.kill(ownedPid,'SIGTERM')}catch{}}
 initialLauncher?.kill('SIGTERM');relay.kill('SIGTERM');
}
