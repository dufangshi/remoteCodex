#!/usr/bin/env python3
"""Run as the disposable container's ordinary user, with a real candidate Supervisor.
Real npm + Codex validate installation/models/create. Only inference uses a local Responses API fixture; the real adapter handles the queue.
Never run against a user's home or active Supervisor.
"""
import json, os, pathlib, time, urllib.request, urllib.error, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
home=pathlib.Path('/home/tester')
assert pathlib.Path.home()==home and os.getuid()!=0
assert not os.access('/usr/local/lib/node_modules',os.W_OK)
prefix=home/'.local/share/remote-codex/adapters'
settings=json.loads((home/'db.cli.json').read_text())
url='http://127.0.0.1:8787'
def api(path, body=None):
    headers={'Content-Type':'application/json'}
    if path=='/cli': headers['Authorization']='Bearer '+settings['token']
    req=urllib.request.Request(url+'/api'+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=320) as r: return json.load(r)
    except urllib.error.HTTPError as e: raise AssertionError(e.read().decode()) from e

def until(fn,timeout=30):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        result=fn()
        if result:return result
        time.sleep(.3)
    raise AssertionError('timed out')

def codex_row():return next(r for r in api('/management/harnesses') if r['id']=='codex')
# Fresh runs omit the adapter; repeated verification may use the already-installed copy.
class Responses(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length',0)))
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        part={'type':'output_text','text':'queue-recovered','annotations':[]}
        item={'id':'msg_fixture','type':'message','role':'assistant','status':'completed','content':[part]}
        response={'id':'resp_fixture','object':'response','created_at':1,'status':'completed','model':'gpt-6-astra','output':[item],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}
        events=[{'type':'response.created','response':dict(response,status='in_progress',output=[])},
            {'type':'response.output_item.added','output_index':0,'item':dict(item,status='in_progress',content=[])},
            {'type':'response.content_part.added','output_index':0,'item_id':item['id'],'content_index':0,'part':dict(part,text='')},
            {'type':'response.output_text.delta','output_index':0,'item_id':item['id'],'content_index':0,'delta':'queue-recovered'},
            {'type':'response.output_item.done','output_index':0,'item':item},
            {'type':'response.completed','response':response}]
        for i,e in enumerate(events):
            e['sequence_number']=i
            self.wfile.write(('event: '+e['type']+'\ndata: '+json.dumps(e)+'\n\n').encode())
        self.wfile.flush()
server=HTTPServer(('127.0.0.1',18992),Responses)
threading.Thread(target=server.serve_forever,daemon=True).start()
(home/'.codex/config.toml').write_text('model_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:18992/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n')
before=codex_row()
assert before['base']['version']=='0.154.0'
if not before['adapter']['installed']:
    assert before['adapter']['canInstall'] and not before['adapter']['canUpdate']
# Dummy local authentication enables discovery without sending inference traffic.
(home/'.codex/auth.json').write_text(json.dumps({'OPENAI_API_KEY':'local-fixture-not-secret'}))
models=api('/agent-runtimes/acp/models?agentId=codex&cwd=/home/tester/workspaces')
assert any(m['model']=='gpt-6-astra' for m in models)
after=codex_row()
assert after['adapter']['installed'] and after['adapter']['path']==str(prefix/'bin/codex-acp')
agents=api('/agent-runtimes/acp/agents')
meta=next(r['acpAgent'] for r in agents if r['id']=='codex')
assert meta['serverPath']==after['adapter']['path'] and meta['baseVersion']==after['base']['version']
assert meta['serverVersion']==after['adapter']['version'] and meta['connectionStatus']=='verified'
workspace=api('/workspaces',{'name':'Adapter regression','absPath':str(home/'workspaces')})
thread=api('/threads/start',{'workspaceId':workspace['id'],'provider':'acp','agentId':'codex','model':'gpt-6-astra','title':'Dependency recovery'})
tid=thread['id']
def status():return api('/cli',{'operation':'status','threadId':tid})
# Codex persists its rollout after the first turn, not for an unused empty session.
api('/cli',{'operation':'send','threadId':tid,'delivery':'queue','text':'warm up native rollout'})
until(lambda:status()['queuedCount']==0 and status()['status']=='idle')
assert len(api('/cli',{'operation':'transcript','threadId':tid})['turns'])==1
api('/management/harnesses/codex',{'action':'restart'})
until(lambda:codex_row()['job']['state']=='completed')
# Hide the dependency after a thread exists; force npm to fail instead of contacting the network.
adapter=prefix/'bin/codex-acp'; saved=adapter.with_name('codex-acp.saved')
adapter.rename(saved)
npm=prefix/'bin/npm'; attempts=home/'npm-attempts'
attempts.unlink(missing_ok=True)
npm.write_text('#!/bin/sh\necho attempt >> /home/tester/npm-attempts\necho fixture-install-failure >&2\nexit 1\n');npm.chmod(0o755)
try:
    receipt=api('/cli',{'operation':'send','threadId':tid,'delivery':'queue','text':'original queued task','clientRequestId':'dependency-recovery'})
    assert receipt['delivery']=='queued'
    def status():return api('/cli',{'operation':'status','threadId':tid})
    def blocked_status():
        s=status()
        return s if s.get('lastError') and 'codex-acp' in s['lastError'] else None
    blocked=until(blocked_status)
    assert blocked['queuedCount']==1 and 'Settings' in blocked['lastError']
    time.sleep(6)
    assert attempts.read_text().splitlines()==['attempt'], 'installer must back off'
    # A lower-priority ~/.local/bin copy must also be discoverable without restarting.
    local=home/'.local/bin';local.mkdir(parents=True,exist_ok=True)
    fixture=local/'codex-acp'
    fixture.symlink_to(saved.resolve())
    npm.unlink()
    until(lambda:status()['queuedCount']==0 and status()['status']=='idle')
    transcript=api('/cli',{'operation':'transcript','threadId':tid})
    assert len(transcript['turns'])==2 and 'queue-recovered' in json.dumps(transcript)
    assert codex_row()['adapter']['path']==str(fixture)
    saved.rename(adapter)
    assert codex_row()['adapter']['path']==str(adapter), 'managed prefix must win over another user prefix'
    fixture.unlink()
finally:
    npm.unlink(missing_ok=True)
    if saved.exists() or saved.is_symlink(): saved.rename(adapter)
installed=api('/agent-runtimes/acp/install?agentId=codex',{})
assert installed['installation']['installed'] and installed['status']['state']=='ready'
print(json.dumps({'passed':True,'threadId':tid,'scenarios':['real user-owned npm install','root system prefix unchanged','real Codex models and thread creation','matching paths and versions','missing dependency queue retained','installer backoff','late PATH discovery','original queue executes exactly once']}))
