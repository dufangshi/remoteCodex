import type { FastifyInstance } from 'fastify';

import { TERMINAL_PLUGIN_ID } from '../../../../packages/plugin-terminal/src/index';
import type { ShellEventEnvelope } from '../../../../packages/shared/src/index';
import type {
  BackendPluginContribution,
  BackendPluginHost,
  BackendPluginSocketMessageContext,
} from './backend-plugin-host';
import type { ShellBackend } from '../shell/shell-backend';
import { PtyShellBackend } from '../shell/pty-shell-backend';
import { TmuxShellBackend } from '../shell/tmux-shell-backend';
import { ShellServiceError } from '../shell/shell-session-service';
import { registerShellRoutes } from '../routes/shells';

export function createTerminalShellBackend(env: NodeJS.ProcessEnv = process.env): ShellBackend {
  return env.REMOTE_CODEX_SHELL_BACKEND === 'tmux'
    ? new TmuxShellBackend()
    : new PtyShellBackend();
}

export function isTerminalPluginEnabled(app: FastifyInstance) {
  return app.services.pluginService.getPlugin(TERMINAL_PLUGIN_ID)?.enabled === true;
}

export function requireTerminalPluginEnabled(app: FastifyInstance) {
  if (!isTerminalPluginEnabled(app)) {
    throw new ShellServiceError(
      'plugin_disabled',
      'The Terminal plugin is disabled.',
    );
  }
}

export function registerTerminalPluginBackend(app: FastifyInstance) {
  app.register(registerShellRoutes, {
    preHandler: async () => {
      requireTerminalPluginEnabled(app);
    },
  });
}

export function createTerminalPluginBackendContribution(): BackendPluginContribution {
  return {
    pluginId: TERMINAL_PLUGIN_ID,
    registerHttp: registerTerminalPluginBackend,
    registerSocket(host: BackendPluginHost) {
      host.registerSocketHandler(createTerminalSocketHandler());
    },
  };
}

function createTerminalSocketHandler() {
  return async (context: BackendPluginSocketMessageContext) => {
    const { app, message, send } = context;
    const shellService = app.services.shellService;
    const stateKey = `${TERMINAL_PLUGIN_ID}:attached-shell`;
    const cleanupRegisteredKey = `${TERMINAL_PLUGIN_ID}:cleanup-registered`;
    const getAttachedShell = () =>
      context.state.get(stateKey) as { shellId: string; viewerId: string } | undefined;
    const setAttachedShell = (value: { shellId: string; viewerId: string } | null) => {
      if (value) {
        context.state.set(stateKey, value);
      } else {
        context.state.delete(stateKey);
      }
    };

    try {
      if (message.type === 'shell.attach') {
        requireTerminalPluginEnabled(app);
        const attachedShell = getAttachedShell();
        if (attachedShell && attachedShell.shellId !== message.shellId) {
          await shellService.detachShell(
            attachedShell.shellId,
            attachedShell.viewerId,
          );
          setAttachedShell(null);
        }

        const attachment = await shellService.attachShell(message.shellId, {
          cols: message.cols,
          rows: message.rows,
          onConnected: (connected) => {
            setAttachedShell({
              shellId: message.shellId,
              viewerId: connected.viewerId,
            });
            send({
              type: 'shell.connected',
              shellId: message.shellId,
              timestamp: new Date().toISOString(),
              payload: {
                viewerId: connected.viewerId,
              },
            });
            send({
              type: 'shell.status',
              shellId: message.shellId,
              timestamp: new Date().toISOString(),
              payload: {
                threadId: connected.shell.threadId,
                state: 'attached',
                viewerId: connected.viewerId,
              },
            });
          },
          onData: (data, options) => {
            send({
              type: 'shell.output',
              shellId: message.shellId,
              timestamp: new Date().toISOString(),
              payload: {
                data,
                ...(options?.replace ? { replace: true } : {}),
                ...(options?.cursorX !== undefined
                  ? { cursorX: options.cursorX }
                  : {}),
                ...(options?.cursorY !== undefined
                  ? { cursorY: options.cursorY }
                  : {}),
                ...(options?.paneHeight !== undefined
                  ? { paneHeight: options.paneHeight }
                  : {}),
                ...(options?.cwdBaseName !== undefined
                  ? { cwdBaseName: options.cwdBaseName }
                  : {}),
                ...(options?.envPrefix !== undefined
                  ? { envPrefix: options.envPrefix }
                  : {}),
                ...(options?.isCommandRunning !== undefined
                  ? { isCommandRunning: options.isCommandRunning }
                  : {}),
              },
            });
          },
        });
        if (!getAttachedShell()) {
          setAttachedShell({
            shellId: message.shellId,
            viewerId: attachment.viewerId,
          });
        }
        if (context.state.get(cleanupRegisteredKey) !== true) {
          context.state.set(cleanupRegisteredKey, true);
          context.onClose(() => {
            const attached = getAttachedShell();
            if (attached) {
              void shellService.detachShell(attached.shellId, attached.viewerId).catch(() => {});
              setAttachedShell(null);
            }
          });
        }
        return true;
      }

      if (message.type === 'shell.detach') {
        requireTerminalPluginEnabled(app);
        await shellService.detachShell(message.shellId, message.viewerId);
        const attachedShell = getAttachedShell();
        if (
          attachedShell?.shellId === message.shellId &&
          attachedShell.viewerId === message.viewerId
        ) {
          setAttachedShell(null);
        }
        return true;
      }

      if (message.type === 'shell.input') {
        requireTerminalPluginEnabled(app);
        await shellService.sendInput(
          message.shellId,
          message.viewerId,
          message.data,
        );
        return true;
      }

      if (message.type === 'shell.resize') {
        requireTerminalPluginEnabled(app);
        await shellService.resizeShell(
          message.shellId,
          message.viewerId,
          message.cols,
          message.rows,
        );
        return true;
      }

      if (message.type === 'shell.clear') {
        requireTerminalPluginEnabled(app);
        await shellService.clearShell(message.shellId, message.viewerId);
        return true;
      }

      return false;
    } catch (error) {
      if ('shellId' in message) {
        send(makeShellErrorEnvelope(message.shellId, error));
        return true;
      }
      throw error;
    }
  };
}

function makeShellErrorEnvelope(
  shellId: string,
  error: unknown,
): ShellEventEnvelope {
  if (error instanceof ShellServiceError) {
    return {
      type: 'shell.error',
      shellId,
      timestamp: new Date().toISOString(),
      payload: {
        code: error.code,
        message: error.message,
      },
    };
  }

  return {
    type: 'shell.error',
    shellId,
    timestamp: new Date().toISOString(),
    payload: {
      code: 'unknown',
      message:
        error instanceof Error ? error.message : 'Unexpected shell error.',
    },
  };
}
