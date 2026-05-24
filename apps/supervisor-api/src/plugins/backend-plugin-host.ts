import type { FastifyInstance } from 'fastify';

import type {
  SupervisorSocketClientEnvelope,
  SupervisorSocketServerEnvelope,
} from '../../../../packages/shared/src/index';

export interface BackendPluginSocketContext {
  app: FastifyInstance;
  send: (message: SupervisorSocketServerEnvelope) => void;
  onClose: (handler: () => void) => void;
  state: Map<string, unknown>;
}

export interface BackendPluginSocketMessageContext extends BackendPluginSocketContext {
  message: SupervisorSocketClientEnvelope;
}

export type BackendPluginSocketMessageHandler = (
  context: BackendPluginSocketMessageContext,
) => Promise<boolean> | boolean;

export interface BackendPluginContribution {
  pluginId: string;
  registerHttp?: (app: FastifyInstance) => void;
  registerSocket?: (host: BackendPluginHost) => void;
}

export class BackendPluginHost {
  private readonly socketHandlers: BackendPluginSocketMessageHandler[] = [];

  constructor(private readonly app: FastifyInstance) {}

  registerSocketHandler(handler: BackendPluginSocketMessageHandler) {
    this.socketHandlers.push(handler);
  }

  register(contribution: BackendPluginContribution) {
    contribution.registerHttp?.(this.app);
    contribution.registerSocket?.(this);
  }

  async handleSocketMessage(context: BackendPluginSocketMessageContext) {
    for (const handler of this.socketHandlers) {
      if (await handler(context)) {
        return true;
      }
    }
    return false;
  }
}
