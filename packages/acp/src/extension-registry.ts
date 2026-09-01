import { EventEmitter } from 'node:events';

import type { AgentProviderCapabilities } from '../../agent-runtime/src/types';
import {
  REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL,
  type HarnessExtensionCallEnvelope,
  type HarnessExtensionDescriptor,
  type HarnessExtensionErrorEnvelope,
  type HarnessExtensionEventEnvelope,
  createHarnessExtensionCall,
  harnessExtensionMethodName,
} from './extensions';

interface HarnessExtensionTransport {
  request(
    method: string,
    params: unknown,
    signal: AbortSignal,
  ): Promise<unknown>;
}

interface RegisteredExtension {
  ownerId: string;
  descriptor: HarnessExtensionDescriptor;
  transport: HarnessExtensionTransport;
  wireMethods: Record<string, string>;
  capabilityPatch: AgentProviderCapabilityPatch | null;
  paramMappers: Record<
    string,
    (envelope: HarnessExtensionCallEnvelope) => unknown
  >;
}

export type AgentProviderCapabilityPatch = {
  [Section in keyof AgentProviderCapabilities]?: Partial<
    AgentProviderCapabilities[Section]
  >;
};

interface CachedOperation {
  fingerprint: string;
  promise: Promise<unknown>;
}

export class HarnessExtensionInvocationError extends Error {
  constructor(public readonly payload: HarnessExtensionErrorEnvelope) {
    super(payload.message);
    this.name = 'HarnessExtensionInvocationError';
  }
}

function extensionKey(extensionId: string, version: number) {
  return `${extensionId}@${version}`;
}

function operationFingerprint(input: {
  extensionId: string;
  extensionVersion: number;
  method: string;
  params: unknown;
}) {
  return JSON.stringify(input);
}

export class HarnessExtensionRegistry extends EventEmitter {
  private readonly extensions = new Map<string, RegisteredExtension>();
  private readonly operations = new Map<string, CachedOperation>();
  private readonly eventSequences = new Set<string>();

  register(input: {
    ownerId: string;
    descriptor: HarnessExtensionDescriptor;
    transport: HarnessExtensionTransport;
    wireMethods?: Record<string, string>;
    capabilityPatch?: AgentProviderCapabilityPatch;
    paramMappers?: Record<
      string,
      (envelope: HarnessExtensionCallEnvelope) => unknown
    >;
  }) {
    const key = extensionKey(input.descriptor.id, input.descriptor.version);
    const existing = this.extensions.get(key);
    if (existing && existing.ownerId !== input.ownerId) {
      throw new Error(
        `Harness extension ${key} is already owned by ${existing.ownerId}.`,
      );
    }
    if (new Set(input.descriptor.methods).size !== input.descriptor.methods.length) {
      throw new Error(`Harness extension ${key} declares duplicate methods.`);
    }
    if (new Set(input.descriptor.events).size !== input.descriptor.events.length) {
      throw new Error(`Harness extension ${key} declares duplicate events.`);
    }
    this.extensions.set(key, {
      ownerId: input.ownerId,
      descriptor: structuredClone(input.descriptor),
      transport: input.transport,
      wireMethods: { ...(input.wireMethods ?? {}) },
      capabilityPatch: input.capabilityPatch
        ? structuredClone(input.capabilityPatch)
        : null,
      paramMappers: { ...(input.paramMappers ?? {}) },
    });
  }

  unregisterOwner(ownerId: string) {
    for (const [key, extension] of this.extensions) {
      if (extension.ownerId === ownerId) {
        this.extensions.delete(key);
      }
    }
  }

  list() {
    return [...this.extensions.values()].map((extension) => ({
      ownerId: extension.ownerId,
      descriptor: structuredClone(extension.descriptor),
    }));
  }

  supports(extensionId: string, version: number, method: string) {
    return this.extensions
      .get(extensionKey(extensionId, version))
      ?.descriptor.methods.includes(method) ?? false;
  }

  effectiveCapabilities(base: AgentProviderCapabilities) {
    const effective = structuredClone(base);
    for (const extension of this.extensions.values()) {
      if (!extension.capabilityPatch) continue;
      for (const [section, patch] of Object.entries(extension.capabilityPatch)) {
        Object.assign(
          effective[section as keyof AgentProviderCapabilities],
          patch,
        );
      }
    }
    return effective;
  }

  invoke<T = unknown>(input: {
    extensionId: string;
    extensionVersion: number;
    method: string;
    operationId: string;
    idempotencyKey: string;
    params: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<T> {
    const key = extensionKey(input.extensionId, input.extensionVersion);
    const extension = this.extensions.get(key);
    if (!extension || !extension.descriptor.methods.includes(input.method)) {
      return Promise.reject(this.error(input, {
        code: 'extension_method_unavailable',
        message: `Harness extension method is unavailable: ${key}/${input.method}`,
        retryable: false,
      }));
    }
    if (input.signal?.aborted) {
      return Promise.reject(this.error(input, {
        code: 'extension_cancelled',
        message: 'Harness extension request was cancelled before dispatch.',
        retryable: true,
      }));
    }
    const fingerprint = operationFingerprint(input);
    const cached = this.operations.get(input.idempotencyKey);
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        return Promise.reject(this.error(input, {
          code: 'idempotency_conflict',
          message: 'Harness extension idempotency key was reused for another operation.',
          retryable: false,
        }));
      }
      return cached.promise as Promise<T>;
    }

    const envelope = createHarnessExtensionCall(input);
    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? 30_000;
    let timer: NodeJS.Timeout | null = null;
    let abort: (() => void) | null = null;
    const request = new Promise<T>((resolve, reject) => {
      abort = () => {
        controller.abort(input.signal?.reason);
        reject(this.error(input, {
          code: 'extension_cancelled',
          message: 'Harness extension request was cancelled.',
          retryable: true,
        }));
      };
      input.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        controller.abort(new Error('Harness extension request timed out.'));
        reject(this.error(input, {
          code: 'extension_timeout',
          message: `Harness extension request timed out after ${timeoutMs}ms.`,
          retryable: true,
        }));
      }, timeoutMs);
      void Promise.resolve().then(() => extension.transport.request(
          extension.wireMethods[input.method] ?? harnessExtensionMethodName(
            input.extensionId,
            input.extensionVersion,
            input.method,
          ),
          extension.paramMappers[input.method]?.(envelope) ?? envelope,
          controller.signal,
        )).then((value) => resolve(value as T), (cause) => reject(
          cause instanceof HarnessExtensionInvocationError
            ? cause
            : this.error(input, {
                code: 'extension_request_failed',
                message: cause instanceof Error ? cause.message : String(cause),
                retryable: false,
              }),
        ));
    }).finally(() => {
      if (timer) clearTimeout(timer);
      if (abort) input.signal?.removeEventListener('abort', abort);
    });
    this.operations.set(input.idempotencyKey, { fingerprint, promise: request });
    request.catch(() => {
      if (this.operations.get(input.idempotencyKey)?.promise === request) {
        this.operations.delete(input.idempotencyKey);
      }
    });
    while (this.operations.size > 256) {
      this.operations.delete(this.operations.keys().next().value!);
    }
    return request;
  }

  handleEvent(ownerId: string, event: HarnessExtensionEventEnvelope) {
    if (event.protocol !== REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL) {
      throw new Error('Harness extension event protocol is unsupported.');
    }
    const extension = this.extensions.get(
      extensionKey(event.extensionId, event.extensionVersion),
    );
    if (!extension || extension.ownerId !== ownerId) {
      throw new Error('Harness extension event owner does not match registration.');
    }
    if (!extension.descriptor.events.includes(event.event)) {
      throw new Error(`Harness extension event is not declared: ${event.event}`);
    }
    if (event.sequence !== null) {
      const sequenceKey = [
        ownerId,
        event.extensionId,
        event.extensionVersion,
        event.providerSessionId,
        event.event,
        event.sequence,
      ].join('\0');
      if (this.eventSequences.has(sequenceKey)) {
        return false;
      }
      this.eventSequences.add(sequenceKey);
    }
    this.emit('event', structuredClone(event));
    return true;
  }

  private error(
    input: {
      extensionId: string;
      extensionVersion: number;
      method: string;
      operationId: string;
    },
    error: { code: string; message: string; retryable: boolean },
  ) {
    return new HarnessExtensionInvocationError({
      protocol: REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL,
      extensionId: input.extensionId,
      extensionVersion: input.extensionVersion,
      method: input.method,
      operationId: input.operationId,
      ...error,
    });
  }
}
