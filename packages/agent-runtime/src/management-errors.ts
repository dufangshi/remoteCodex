import type { ApiErrorShape } from '../../shared/src/index';

export class AgentRuntimeManagementError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly payload: ApiErrorShape,
  ) {
    super(payload.message);
    this.name = 'AgentRuntimeManagementError';
  }
}
