// Runs the real restart API and detached worker in the Treer Linux machine.
// Fake harnesses make this process/recovery test deterministic for every provider.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
const {values:opts}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'},npm:{type:'string'}}});
if(process.platform!=='linux'||!opts.binary||!opts.directory||!opts.npm) throw Error('Run only inside the isolated Linux machine with --binary, --directory, --npm.');
const directory=fs.mkdtempSync(path.join(path.resolve(opts.directory),'restart-'));
const prefix=path.join(directory,'prefix');const modules=path.join(prefix,'lib/node_modules');
const root=path.join(modules,'remote-codex');fs.mkdirSync(root,{recursive:true});
fs.symlinkSync(path.resolve(opts.npm),path.join(modules,'npm'));
fs.cpSync(new URL('../npm/remote-codex/bin',import.meta.url),path.join(root,'bin'),{recursive:true});
fs.mkdirSync(path.join(root,'web'));fs.writeFileSync(path.join(root,'web/index.html'),'<title>Restart fixture</title>');
const binary=path.resolve(opts.binary);
const version=spawnSync(binary,['version'],{encoding:'utf8'}).stdout.trim();
assert.match(version,/^\d+\.\d+\.\d+$/);
fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'remote-codex',version,type:'module'}));
const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;await new Promise(r=>server.close(r));
const base=`http://127.0.0.1:${port}`;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('REMOTE_CODEX_')));
Object.assign(env,{
 REMOTE_CODEX_NATIVE_BINARY:binary,REMOTE_CODEX_SERVICE_DIR:path.join(directory,'service'),
 REMOTE_CODEX_DATABASE_PATH:path.join(directory,'supervisor.sqlite'),DATABASE_URL:path.join(directory,'supervisor.sqlite'),
 REMOTE_CODEX_WORKSPACE_ROOT:directory,WORKSPACE_ROOT:directory,REMOTE_CODEX_MODE:'local',
 SERVICE_HOST:'127.0.0.1',SERVICE_PORT:String(port),REMOTE_CODEX_E2E_FAKE_RUNTIME:'1',
 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS:'codex,claude,opencode,acp',
});
// A restart must work with no registry access at all.
const offline=path.join(directory,'offline.mjs');fs.writeFileSync(offline,"const original=globalThis.fetch;globalThis.fetch=(url,opts)=>{if(!String(url).startsWith('http://127.0.0.1:'))throw Error('Unexpected external network access from restart helper');return original(url,opts)}");
env.NODE_OPTIONS=`--import=${offline}`;
const start=spawnSync(process.execPath,[path.join(root,'bin/remote-codex.mjs'),'start'],{env,cwd:directory,encoding:'utf8'});
assert.equal(start.status,0,start.stderr);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body){const res=await fetch(base+route,{method:body?'POST':'GET',headers:body?{'content-type':'application/json',origin:base}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const value=await res.json();assert.ok(res.ok,JSON.stringify(value));return value;}
async function until(check){const deadline=Date.now()+120000;while(Date.now()<deadline){const result=await check();if(result)return result;await pause(250);}throw Error('Timed out');}
let ownedPid;
try {
 const before=await api('/healthz');ownedPid=before.processId;
 const ws=await api('/api/workspaces',{absPath:directory,label:'isolated restart'});
 const threads=[];
 for(const provider of ['codex','claude','opencode','acp']){
  const t=await api('/api/threads/start',{workspaceId:ws.id,title:provider,provider,agentId:provider==='acp'?'grok':undefined,model:'ios-e2e-stream',approvalMode:'yolo'});
  const id=t.id??t.thread.id;
  await api(`/api/threads/${id}/prompt`,{prompt:'Inspect this repository in depth',clientRequestId:`initial-${provider}`});
  await until(async()=> (await api(`/api/threads/${id}`)).thread.status==='running');
  await api(`/api/threads/${id}/prompt`,{prompt:`Saved follow-up ${provider}`,clientRequestId:`queued-${provider}`});
  threads.push({id,provider,session:(await api(`/api/threads/${id}`)).thread.providerSessionId});
 }
 const idle=await api('/api/threads/start',{workspaceId:ws.id,title:'must stay idle',provider:'codex',model:'ios-e2e-stream',approvalMode:'yolo'});
 const status=await api('/api/management/supervisor');assert.equal(status.canRestart,true);assert.equal(typeof status.uptimeSeconds,'number');
 const accepted=await api('/api/management/supervisor/restart',{});assert.equal(accepted.job.action,'restart');
 console.log(JSON.stringify({phase:'restart accepted',directory,before,providers:threads.map(t=>t.provider)}));
 const after=await until(async()=>{try{const h=await api('/healthz');return h.processId!==before.processId?h:false;}catch{return false;}});
 ownedPid=after.processId;assert.equal(after.runningVersion,before.runningVersion);
 const outcomes=[];
 for(const t of threads){const d=await until(async()=>{const d=await api(`/api/threads/${t.id}`);return d.thread.status==='idle'&&d.turns.length===3?d:false;});
  assert.equal(d.thread.providerSessionId,t.session);assert.deepEqual(d.turns.map(t=>t.status),['interrupted','completed','completed']);assert.equal(d.pendingSteers.length,0);
  await api(`/api/threads/${t.id}/prompt`,{prompt:`Saved follow-up ${t.provider}`,clientRequestId:`queued-${t.provider}`});
  assert.equal((await api(`/api/threads/${t.id}`)).turns.length,3);
  outcomes.push({provider:t.provider,session:t.session,turns:d.turns.map(t=>t.status)});
 }
 const untouched=await api(`/api/threads/${idle.id??idle.thread.id}`);assert.equal(untouched.turns.length,0);
 const final=await api('/api/management/supervisor');assert.equal(final.job.phase,'completed');assert.notEqual(final.startedAt,status.startedAt);
 const result={ok:true,directory,before,after,status:final,outcomes,idleTurns:untouched.turns.length};
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally { if(ownedPid){try{process.kill(ownedPid,'SIGTERM')}catch{}} }
