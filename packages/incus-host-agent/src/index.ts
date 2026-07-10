import { ZodError } from 'zod';
import { JsonFileAuditLogger } from './audit-log';
import { SpawnCommandRunner } from './command-runner';
import { loadIncusHostAgentConfig } from './config';
import { IncusClient } from './incus-client';
import { FileOperationStore } from './operation-store';
import { buildIncusHostAgent } from './server';
import { EncryptedFileSecretStore } from './secret-store';

let config;
try {
  config = loadIncusHostAgentConfig();
} catch (error) {
  if (error instanceof ZodError) {
    console.error('Incus host-agent configuration is invalid.');
    for (const issue of error.issues) {
      console.error(
        `- ${issue.path.join('.') || 'environment'}: ${issue.message}`,
      );
    }
    process.exit(1);
  }
  throw error;
}

const client = new IncusClient(config, new SpawnCommandRunner());
const app = buildIncusHostAgent({
  config,
  client,
  operations: new FileOperationStore(config.operationDir),
  audit: new JsonFileAuditLogger(config.auditLog),
  secrets: config.secretMasterKey
    ? new EncryptedFileSecretStore(config.secretDir, config.secretMasterKey)
    : null,
});

app.listen({ host: config.host, port: config.port }).catch((error) => {
  console.error('Failed to start Incus host-agent.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
