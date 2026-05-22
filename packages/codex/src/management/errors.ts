import {
  AgentRuntimeManagementError,
} from '../../../agent-runtime/src/index';

export class CodexManagementError extends AgentRuntimeManagementError {
  constructor(
    statusCode: ConstructorParameters<typeof AgentRuntimeManagementError>[0],
    payload: ConstructorParameters<typeof AgentRuntimeManagementError>[1],
  ) {
    super(statusCode, payload);
    this.name = 'CodexManagementError';
  }
}

export function codexBadRequest(message: string): never {
  throw new AgentRuntimeManagementError(400, {
    code: 'bad_request',
    message,
  });
}
