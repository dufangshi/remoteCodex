import process from 'node:process';

import {
  AcpRuntimeAdapter,
  acpCapabilities,
} from '../packages/acp/src/index';
import { codexCapabilities } from '../packages/codex/src/index';

const command = process.env.REMOTE_CODEX_ACP_COMMAND ?? 'codex-acp';
const adapter = new AcpRuntimeAdapter({
  command,
  startupTimeoutMs: Number(process.env.ACP_STARTUP_TIMEOUT_MS ?? 30_000),
  clientInfo: {
    name: 'remote-codex-capability-inspector',
    title: 'Remote Codex Capability Inspector',
    version: '1.0.0',
  },
});

try {
  await adapter.start();
  process.stdout.write(`${JSON.stringify({
    runtimeStatus: adapter.getStatus(),
    negotiated: adapter.getProtocolSnapshot(),
    nativeCodexDeclaredCapabilities: codexCapabilities,
    acpBaseDeclaredCapabilities: acpCapabilities,
    effectiveCapabilities: adapter.capabilities,
  }, null, 2)}\n`);
} finally {
  await adapter.stop();
}
