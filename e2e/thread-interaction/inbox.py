#!/usr/bin/env python3
"""Run inside the isolated Docker fixture with its fake-runtime Supervisor.
Exercises the actual native/launcher CLI and HTTP/KV boundaries, without models.
"""
import json, os, pathlib, subprocess, time, urllib.request
binary = os.environ.get('E2E_BINARY', '/build/debug/remote-codex')
base = 'http://127.0.0.1:' + os.environ.get('PORT', '8787')
def api(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers={'content-type':'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=10))
def cli(*args, caller=None):
    env = dict(os.environ)
    env.pop('REMOTE_CODEX_THREAD_ID', None)
    if caller: env['REMOTE_CODEX_THREAD_ID'] = caller
    result = subprocess.run([binary, *args], env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)
def until(check):
    end=time.monotonic()+40
    while time.monotonic()<end:
        result=check()
        if result: return result
        time.sleep(.1)
    raise AssertionError('Timed out waiting for fixture condition')
path=pathlib.Path('/test-state/workspaces/inbox-' + str(time.time_ns()));path.mkdir(parents=True,exist_ok=True)
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
# An explicitly requested queued callback wakes the sender.
cli('thread','send',b,'--delivery','queue','--text','Finish a short task','--notify-on-complete','--notify-delivery','queue',caller=a)
until(lambda:len(cli('transcript',a)['turns'])>0)
until(lambda:cli('thread','status',a)['status']=='idle')
# Use a slow fake turn to exercise steering while busy.
cli('thread','send',a,'--delivery','queue','--text','long task '+('x'*200),caller=b)
until(lambda:cli('thread','status',a)['status']=='running')
turn=cli('thread','status',a)['activeTurnId']
steer=cli('thread','send',a,'--delivery','steer','--text','Immediate correction',caller=b)
assert steer['delivery']=='steered',steer
assert cli('thread','status',a)['activeTurnId']==turn
until(lambda:cli('thread','status',a)['status']=='idle')
assert 'Immediate correction' in json.dumps(cli('transcript',a,'--turn',turn,'--view','overview'))
# Real npm launcher must expose native subcommand flags, not top-level help.
env=dict(os.environ,REMOTE_CODEX_NATIVE_BINARY=binary)
for args,expected in [(['thread','send','--help'],'--delivery'),(['inbox','read','--help'],'--text-offset'),(['transcript','--help'],'--before-turn')]:
    help_text=subprocess.check_output(['node','/src/npm/remote-codex/bin/remote-codex.mjs',*args],env=env,text=True)
    assert expected in help_text
result={'passed':True,'sender':a,'recipient':b,'createdTask':c,'scenarios':['passive mail and ack','idempotent send','create task','inbox completion','queued wakeup','active steer','launcher subcommand help']}
pathlib.Path('/test-state/result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
