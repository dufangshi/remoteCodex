import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dbModule = await import(pathToFileURL(path.join(repoRoot, 'packages/db/src/index.ts')));

const databaseUrl = process.env.DATABASE_URL;
const workspaceRoot = process.env.WORKSPACE_ROOT;

if (!databaseUrl || !workspaceRoot) {
  throw new Error('DATABASE_URL and WORKSPACE_ROOT are required.');
}

await fs.mkdir(workspaceRoot, { recursive: true });
dbModule.runMigrations(databaseUrl);
const database = dbModule.createDatabase(databaseUrl);
dbModule.seedDefaults(database.db);

const workspace =
  dbModule.getWorkspaceRecordByPath(database.db, workspaceRoot) ??
  dbModule.createWorkspaceRecord(database.db, {
    absPath: workspaceRoot,
    label: 'XYZ plugin fixture',
  });

const thread = dbModule.createThreadRecord(database.db, {
  workspaceId: workspace.id,
  provider: 'codex',
  providerSessionId: 'plugin-xyz-fixture-session',
  title: 'XYZ plugin fixture',
  model: 'fixture-model',
  approvalMode: 'yolo',
  source: 'supervisor',
  isConnected: false,
});

const benzeneXyz = `12
benzene example
C        0.00000        1.40272        0.00000
H        0.00000        2.49029        0.00000
C       -1.21479        0.70136        0.00000
H       -2.15666        1.24515        0.00000
C       -1.21479       -0.70136        0.00000
H       -2.15666       -1.24515        0.00000
C        0.00000       -1.40272        0.00000
H        0.00000       -2.49029        0.00000
C        1.21479       -0.70136        0.00000
H        2.15666       -1.24515        0.00000
C        1.21479        0.70136        0.00000
H        2.15666        1.24515        0.00000
`;

const item = {
  id: 'fixture-agent-message',
  kind: 'agentMessage',
  text: `Here is a benzene molecule from the Open Babel XYZ format example.\n\nSource: https://openbabel.org/docs/FileFormats/XYZ_cartesian_coordinates_format.html\n\n\`\`\`xyz\n${benzeneXyz}\`\`\``,
  sequence: 1,
  sourceTurnId: 'fixture-turn',
};

dbModule.upsertThreadHistoryItemRecord(database.db, {
  threadId: thread.id,
  turnId: 'fixture-turn',
  itemId: item.id,
  itemJson: JSON.stringify(item),
});

database.sqlite.close();

console.log(JSON.stringify({
  workspaceId: workspace.id,
  threadId: thread.id,
}, null, 2));
