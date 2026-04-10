import { EventEmitter } from 'node:events';

import { ThreadEventEnvelope } from '../../../../packages/shared/src/index';

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
}
