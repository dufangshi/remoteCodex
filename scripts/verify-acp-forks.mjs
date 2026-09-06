// Real provider-context verification, isolated from the user's supervisor DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
const root = path.resolve(`.local/fork-verification-${randomUUID().slice(0,8)}`);
fs.mkdirSync(root, { recursive:true });
const port = Number(process.env.FORK_TEST_PORT ?? 19273);
const base = `http://127.0.0.1:${port}`;
const log = fs.openSync(path.join(root,'supervisor.log'),'a');
const start = () => spawn(path.resolve('target/debug/remote-codex'), ['supervisor'], {
 env:{...process.env, PORT:String(port), HOST:'127.0.0.1', REMOTE_CODEX_MODE:'local', REMOTE_CODEX_E2E_FAKE_RUNTIME:'0', DATABASE_URL:path.join(root,'supervisor.sqlite'), WORKSPACE_ROOT:root}, stdio:['ignore',log,log], detached:true,
});
let proc = start();
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
async function stop() {
 if (proc.exitCode !== null) return;
 const exited = once(proc,'exit');
 try {process.kill(-proc.pid,'SIGTERM');} catch {}
 await exited;
}
async function ready() {
 for(let i=0;i<100;i++){try{await api('/healthz');return;}catch{await sleep(100);}}
 throw Error('supervisor did not become healthy');
}
async function api(url, body) {
 const res=await fetch(base+url,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 const text=await res.text();if(!res.ok) throw Error(`${url}: ${res.status} ${text}`);return JSON.parse(text);
}
async function prompt(thread, text) {
 const previous=(await api(`/api/threads/${thread.id}`)).turns.at(-1)?.id;
 await api(`/api/threads/${thread.id}/prompt`,{prompt:text});
 const end=Date.now()+240000;
 while(Date.now()<end) {
  const d=await api(`/api/threads/${thread.id}`);
  const turn=d.turns.at(-1);
  if(turn && turn.id !== previous && !['running','inProgress','queued','pending'].includes(turn.status)) {
   assert.equal(turn.status,'completed',JSON.stringify(turn));return d;
  }
  await sleep(300);
 }
 throw Error('prompt timed out');
}
const answer=d=>d.turns.at(-1).items.filter(i=>i.kind==='agentMessage').map(i=>i.text).join('\n');
try {
 await ready();
 const workspace=await api('/api/workspaces',{absPath:root,label:'Isolated fork verification'});
 for(const harness of (process.env.FORK_TEST_AGENTS??'codex,claude,grok').split(',')) {
  console.log(`${harness}: creating source`);
  const source=await api('/api/threads/start',{workspaceId:workspace.id,title:`${harness} fork verification`,provider:harness==='grok'?'acp':harness,agentId:harness==='grok'?'grok':null,model:'default',approvalMode:'yolo'});
  const marker=`MEMORY_${randomUUID().replaceAll('-','')}`;
  await prompt(source,`Remember this private conversation marker: ${marker}. Do not write files or use tools. Reply only READY.`);
  const caps=await api(`/api/threads/${source.id}/capabilities`);
  assert.equal(caps.effectiveCapabilities.branching.fork,true);
  console.log(`${harness}: toolbox ${caps.toolboxItems.map(i=>i.command).join(' ')}`);
  const result=await api(`/api/threads/${source.id}/fork`,{mode:'latest'});
  const child=result.thread.thread;
  assert.ok(child?.id,'fork response thread');assert.notEqual(child.providerSessionId,source.providerSessionId);
  const branched=await prompt(child,'Without tools or files, reply with only the private conversation marker I asked you to remember earlier.');
  assert.equal(answer(branched).trim(),marker);
  if(harness==='grok') {
   assert.ok(branched.turns.at(-1).tokenUsage?.total.inputTokens>0,'Grok tokens persisted');
   assert.ok(branched.turns.at(-1).priceEstimate?.totalUsd>0,'Grok cost persisted');
  }
  console.log(`${harness}: fork context PASS; usage=${Boolean(branched.turns.at(-1).priceEstimate)}`);
  const unique=`CHILD_${randomUUID().replaceAll('-','')}`;
  await prompt(child,`The branch-only marker is ${unique}. Do not use tools. Reply only READY.`);
  const parentMarker=`PARENT_${randomUUID().replaceAll('-','')}`;
  const parent=await prompt(source,`Remember parent-only marker ${parentMarker}. Without tools, what is the branch-only marker? If no branch-only marker was given in this conversation, reply only ABSENT.`);
  assert.ok(!answer(parent).includes(unique));assert.match(answer(parent),/ABSENT/);
  console.log(`${harness}: parent isolation PASS`);
  if(harness==='codex') {
   const turns=await api(`/api/threads/${source.id}/fork-turns`);
   const historical=await api(`/api/threads/${source.id}/fork`,{mode:'turn',turnId:turns[0].turnId});
   const old=await prompt(historical.thread.thread,'Without tools, reply with the private conversation marker I asked you to remember earlier, then the parent-only marker. If no parent-only marker was given, use ABSENT.');
   assert.ok(answer(old).includes(marker));
   assert.ok(!answer(old).includes(parentMarker));
   assert.match(answer(old),/ABSENT/);
   console.log('codex: historical fork PASS');
  }
  await stop();
  if(harness==='grok') {
   // Simulate the previous runtime's missing-usage rows in THIS isolated test DB.
   execFileSync('python3',['-c',`import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute("UPDATE thread_turns SET token_usage_json=NULL WHERE thread_id=?",(sys.argv[2],))
c.commit()
`,path.join(root,'supervisor.sqlite'),child.id]);
  }
  proc=start(); await ready();
  if(harness==='grok') {
   const restored=await api(`/api/threads/${child.id}`);
   assert.ok(restored.turns.at(-1).tokenUsage?.total.inputTokens>0,'Grok history backfill');
   assert.ok(restored.turns.at(-1).priceEstimate?.totalUsd>0,'Grok historical cost');
   console.log('grok: historical usage backfill PASS');
  }
  const resumed=await prompt(child,'Without tools or files, reply with only the private conversation marker I asked you to remember earlier.');
  assert.equal(answer(resumed).trim(),marker);
  console.log(`${harness}: supervisor restart and fork continuation PASS`);
  fs.writeFileSync(path.join(root,`${harness}-result.json`),JSON.stringify({passed:true,sourceThreadId:source.id,childThreadId:child.id,commands:caps.toolboxItems.map(i=>i.command)},null,2));
 }
 console.log(`PASS evidence: ${root}`);
} finally {
 await stop();
 fs.closeSync(log);
}
