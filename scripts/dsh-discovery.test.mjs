import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { apply } from '../crates/runtime/src/acp/deepseek-plugin.mjs';

test('DSH waits for startup, preserves per-model capabilities and excludes configuration secrets', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let ready, disposed;
  const result = new Promise(resolve => server.once('connection', socket => {
    let text = '';
    socket.on('data', data => { text += data; });
    socket.on('end', () => resolve(JSON.parse(text)));
  }));
  try {
    apply({
      appReady: { onReady: fn => { ready = fn; return () => { disposed = true; }; } },
      on: (event, fn) => { assert.equal(event, 'dispose'); assert.equal(typeof fn, 'function'); },
      loader: {entries: () => [{id:'llm',options:{name:'llm-test',config:{apiKey:'never-export-this'}},disabled:false}]},
      llm: {
        listProviders: () => [{id:'custom',name:'Custom'}],
        listModels: async () => [{id:'with-reasoning',name:'Reasoning'},{id:'plain',name:'Plain'}],
        resolveModelInfo: async (_, model) => model === 'plain' ? {} : {reasoning:{efforts:[{id:'xhigh',name:'Xhigh'}]}},
      },
    }, {port:server.address().port,token:'test-token'});
    assert.equal(disposed, undefined);
    ready();
    const snapshot = await result;
    assert.equal(snapshot.token,'test-token');
    assert.equal(snapshot.data.models[0].model,'["custom","with-reasoning"]');
    assert.deepEqual(snapshot.data.models[0].supportedReasoningEfforts.map(e=>e.reasoningEffort),['','xhigh']);
    assert.equal(snapshot.data.models[0].defaultReasoningEffort,'');
    assert.deepEqual(snapshot.data.models[1].supportedReasoningEfforts,[]);
    assert.equal(snapshot.data.models[1].defaultReasoningEffort,null);
    assert.deepEqual(snapshot.data.plugins,[{id:'llm',name:'llm-test',enabled:true}]);
    assert.equal(JSON.stringify(snapshot).includes('never-export-this'),false);
  } finally { server.close(); }
});
