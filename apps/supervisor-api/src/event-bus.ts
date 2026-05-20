import { EventEmitter } from 'node:events';

import {
  ShellEventEnvelope,
  ThreadEventEnvelope,
} from '../../../packages/shared/src/index';

export class SupervisorEventBus extends EventEmitter {
  emitThreadEvent(event: ThreadEventEnvelope) {
    this.emit('thread-event', event);
  }

  onThreadEvent(listener: (event: ThreadEventEnvelope) => void) {
    this.on('thread-event', listener);
    return () => {
      this.off('thread-event', listener);
    };
  }

  emitShellEvent(event: ShellEventEnvelope) {
    this.emit('shell-event', event);
  }

  onShellEvent(listener: (event: ShellEventEnvelope) => void) {
    this.on('shell-event', listener);
    return () => {
      this.off('shell-event', listener);
    };
  }
}
