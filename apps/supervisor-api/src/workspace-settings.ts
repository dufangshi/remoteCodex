import {
  DatabaseClient,
  getPolicyRecordByKey,
  upsertPolicyRecord,
} from '../../../packages/db/src/index';
import {
  WorkspaceSettingsDto,
} from '../../../packages/shared/src/index';
import {
  validateExistingDirectoryPath,
  WorkspaceServiceError,
} from '../../../packages/workspace/src/index';

const DEV_HOME_POLICY_KEY = 'dev_home';

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
  };
}

export async function saveWorkspaceDevHome(
  db: DatabaseClient,
  workspaceRoot: string,
  devHome: string,
): Promise<WorkspaceSettingsDto> {
  const validated = await validateExistingDirectoryPath(workspaceRoot, devHome);

  upsertPolicyRecord(
    db,
    DEV_HOME_POLICY_KEY,
    JSON.stringify({
      absPath: validated.absPath,
    }),
  );

  return {
    workspaceRoot: (await validateExistingDirectoryPath(workspaceRoot, workspaceRoot)).absPath,
    devHome: validated.absPath,
  };
}
