#!/usr/bin/env python3
"""Run inside the isolated Docker fixture with its fake-runtime Supervisor.
Exercises the actual native/launcher CLI and HTTP/KV boundaries, without models.
"""
import json, os, pathlib, subprocess, time, urllib.request
binary = os.environ.get('E2E_BINARY', '/build/debug/pockymoe')
base = 'http://127.0.0.1:' + os.environ.get('PORT', '8787')
state_dir = pathlib.Path(os.environ.get('E2E_STATE_DIR', '/test-state'))
source_dir = pathlib.Path(os.environ.get('E2E_SOURCE_DIR', '/src'))
def api(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers={'content-type':'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=10))
def cli(*args, caller=None):
    env = dict(os.environ)
    env.pop('POCKYMOE_THREAD_ID', None)
    if caller: env['POCKYMOE_THREAD_ID'] = caller
    result = subprocess.run([binary, *args], env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)
def rejected(*args, caller=None):
    env = dict(os.environ)
    env.pop('POCKYMOE_THREAD_ID', None)
    if caller: env['POCKYMOE_THREAD_ID'] = caller
    result = subprocess.run([binary, *args], env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode != 0, result.stdout
def until(check):
    end=time.monotonic()+40
    while time.monotonic()<end:
        result=check()
        if result: return result
        time.sleep(.1)
    raise AssertionError('Timed out waiting for fixture condition')
path=state_dir / ('workspaces/inbox-' + str(time.time_ns()));path.mkdir(parents=True,exist_ok=True)
workspace=api('/api/workspaces',{'absPath':str(path),'label':'Inbox E2E'})['id']
a=cli('thread','create','--workspace',workspace,'--provider','codex','--model','ios-e2e-stream','--title','Inbox sender')['threadId']
b=cli('thread','create','--workspace',workspace,'--provider','acp','--agent','grok','--model','ios-e2e-stream','--title','Inbox recipient')['threadId']
mail=cli('thread','send',b,'--text','Passive report','--request-id','mail-1',caller=a)
assert mail['delivery']=='inbox'
assert cli('thread','send',b,'--text','Passive report','--request-id','mail-1',caller=a)==mail
assert cli('thread','status',b)['queuedCount']==0
assert cli('thread','status',b)['status']=='idle'
assert cli('inbox',caller=b)['messages'][0]['id']==mail['messageId']
assert cli('inbox','read',mail['messageId'],caller=b)['text']=='Passive report'
assert cli('thread','status',b)['unreadMessageCount']==1
cli('inbox','ack',mail['messageId'],caller=b)
assert cli('inbox',caller=b)['messages']==[]
assert len(cli('inbox','list','--all',caller=b)['messages'])==1
# Creation still executes the initial task. Notifications are passive by default.
c=cli('thread','create','--provider','acp','--agent','grok','--model','ios-e2e-stream','--text','Complete this task','--notify-on-complete',caller=a)['threadId']
until(lambda:cli('thread','status',a)['unreadMessageCount']==1)
assert cli('thread','status',a)['queuedCount']==0
notice=cli('inbox',caller=a)['messages'][0]['id']
assert c in cli('inbox','read',notice,caller=a)['text']
# Completion stays passive, and ordinary reports cannot dispatch execution.
rejected('thread','send',b,'--delivery','queue','--kind','task','--text','Finish a short task','--notify-on-complete','--notify-delivery','queue',caller=a)
rejected('thread','send',b,'--delivery','direct','--kind','result','--text','Result ready',caller=a)
rejected('thread','send',b,'--delivery','queue','--kind','result','--text','Result ready',caller=a)
rejected('thread','send',b,'--delivery','direct','--kind','task','--text','Stop invalid work',caller=a)
assert cli('thread','status',b)['queuedCount']==0
# Full progress snapshots replace status only, retaining readable history.
old=cli('thread','send',b,'--kind','status','--topic-key','batch','--text','r1: 10 of 100','--request-id','progress-1',caller=a)
latest=cli('thread','send',b,'--kind','status','--topic-key','batch','--text','r2: 20 of 100','--request-id','progress-2',caller=a)
assert latest['supersededMessageCount']==1
assert cli('inbox','read',old['messageId'],caller=b)['supersededBy']==latest['messageId']
assert cli('inbox','list','--kind','status','--from-thread',a,caller=b)['messages'][0]['id']==latest['messageId']
assert cli('inbox','wait','--kind','status','--from-thread',a,caller=b)['messages'][0]['id']==latest['messageId']
cli('inbox','ack',latest['messageId'],caller=b)
assert cli('thread','status',b)['unreadMessageCount']==0
# Use a slow fake turn to exercise steering while busy.
cli('thread','send',a,'--delivery','queue','--kind','task','--text','long task '+('x'*200),caller=b)
until(lambda:cli('thread','status',a)['status']=='running')
turn=cli('thread','status',a)['activeTurnId']
steer_args=('thread','send',a,'--delivery','direct','--kind','task','--interrupt-reason','The active task uses invalid inputs and would waste the calculation','--text','Immediate correction','--request-id','urgent-1')
steer=cli(*steer_args,caller=b)
assert steer['delivery']=='steered',steer
assert cli('thread','status',a)['activeTurnId']==turn
until(lambda:cli('thread','status',a)['status']=='idle')
assert cli(*steer_args,caller=b)['delivery']=='steered'
assert len(cli('transcript',a)['turns'])==1
assert 'Immediate correction' in json.dumps(cli('transcript',a,'--turn',turn,'--view','overview'))
# Real npm launcher must expose native subcommand flags, not top-level help.
env=dict(os.environ,POCKYMOE_NATIVE_BINARY=binary)
for args,expected in [(['thread','send','--help'],'--interrupt-reason'),(['inbox','list','--help'],'--from-thread'),(['inbox','read','--help'],'--text-offset'),(['transcript','--help'],'--before-turn')]:
    help_text=subprocess.check_output(['node',str(source_dir / 'npm/remote-codex/bin/remote-codex.mjs'),*args],env=env,text=True)
    assert expected in help_text
    if args[:2]==['thread','send']: assert 'direct' in help_text
result={'passed':True,'sender':a,'recipient':b,'createdTask':c,'scenarios':['passive mail and ack','idempotent send','create task','inbox completion','peer delivery rejection','status coalescing and filtered reads','direct active steer and retry after completion','launcher subcommand help']}
(state_dir / 'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
