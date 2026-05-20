import {
  DatabaseClient,
  getPolicyRecordByKey,
  upsertPolicyRecord,
} from '../../../packages/db/src/index';
import {
  AgentBackendIdDto,
  WorkspaceSettingsDto,
} from '../../../packages/shared/src/index';
import {
  validateExistingDirectoryPath,
  WorkspaceServiceError,
} from '../../../packages/workspace/src/index';

const DEV_HOME_POLICY_KEY = 'dev_home';
const DEFAULT_BACKEND_POLICY_KEY = 'default_backend';

function normalizeBackend(value: unknown): AgentBackendIdDto {
  return value === 'claude' ? 'claude' : 'codex';
}

function parseDevHomePolicy(valueJson: string | null | undefined) {
  if (!valueJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(valueJson) as { absPath?: unknown };
    return typeof parsed.absPath === 'string' && parsed.absPath.trim()
      ? parsed.absPath
      : null;
  } catch {
    return null;
  }
}

export async function getWorkspaceSettings(
  db: DatabaseClient,
  workspaceRoot: string,
): Promise<WorkspaceSettingsDto> {
  const policy = getPolicyRecordByKey(db, DEV_HOME_POLICY_KEY);
  const backendPolicy = getPolicyRecordByKey(db, DEFAULT_BACKEND_POLICY_KEY);
  const policyDevHome = parseDevHomePolicy(policy?.valueJson);
  const root = await validateExistingDirectoryPath(workspaceRoot, workspaceRoot);
  let devHome = root;

  if (policyDevHome) {
    try {
      devHome = await validateExistingDirectoryPath(workspaceRoot, policyDevHome);
    } catch (error) {
      if (!(error instanceof WorkspaceServiceError)) {
        throw error;
      }
    }
  }

  return {
    workspaceRoot: root.absPath,
    devHome: devHome.absPath,
    defaultBackend: normalizeBackend(
      backendPolicy?.valueJson ? JSON.parse(backendPolicy.valueJson).provider : null,
    ),
  };
}

export async function saveWorkspaceSettings(
  db: DatabaseClient,
  workspaceRoot: string,
  input: { devHome: string; defaultBackend?: AgentBackendIdDto },
): Promise<WorkspaceSettingsDto> {
  const validated = await validateExistingDirectoryPath(workspaceRoot, input.devHome);

  upsertPolicyRecord(
    db,
    DEV_HOME_POLICY_KEY,
    JSON.stringify({
      absPath: validated.absPath,
    }),
  );

  if (input.defaultBackend !== undefined) {
    upsertPolicyRecord(
      db,
      DEFAULT_BACKEND_POLICY_KEY,
      JSON.stringify({
        provider: normalizeBackend(input.defaultBackend),
      }),
    );
  }

  return getWorkspaceSettings(db, workspaceRoot);
}

export const saveWorkspaceDevHome = (
  db: DatabaseClient,
  workspaceRoot: string,
  devHome: string,
) => saveWorkspaceSettings(db, workspaceRoot, { devHome });
