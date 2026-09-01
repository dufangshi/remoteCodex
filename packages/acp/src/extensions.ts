export const REMOTE_CODEX_HARNESS_EXTENSION_META_KEY =
  'remoteCodex.harnessExtensions';
export const REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL =
  'remote-codex.harness-extension/v1';
export const REMOTE_CODEX_HARNESS_EXTENSION_VERSION = 1;
export const REMOTE_CODEX_HARNESS_EXTENSION_EVENT_METHOD =
  'remoteCodex/harness-extension/event';

export type HarnessExtensionStability = 'experimental' | 'stable';

export interface HarnessExtensionDescriptor {
  id: string;
  version: number;
  stability: HarnessExtensionStability;
  methods: string[];
  events: string[];
}

export interface HarnessExtensionCallEnvelope<TParams = unknown> {
  protocol: typeof REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL;
  extensionId: string;
  extensionVersion: number;
  method: string;
  operationId: string;
  idempotencyKey: string;
  params: TParams;
}

export interface HarnessExtensionEventEnvelope<TPayload = unknown> {
  protocol: typeof REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL;
  extensionId: string;
  extensionVersion: number;
  event: string;
  operationId: string | null;
  providerSessionId: string;
  providerTurnId: string | null;
  providerItemId: string | null;
  sequence: number | null;
  payload: TPayload;
}

export interface HarnessExtensionErrorEnvelope {
  protocol: typeof REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL;
  extensionId: string;
  extensionVersion: number;
  method: string;
  operationId: string;
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

const extensionSegmentPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function assertExtensionSegment(value: string, label: string) {
  if (!extensionSegmentPattern.test(value)) {
    throw new Error(`${label} must be a lowercase extension identifier.`);
  }
}

export function harnessExtensionMethodName(
  extensionId: string,
  version: number,
  method: string,
) {
  assertExtensionSegment(extensionId, 'Extension id');
  assertExtensionSegment(method, 'Extension method');
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('Extension version must be a positive integer.');
  }
  return `remoteCodex/${extensionId}/v${version}/${method}`;
}

export function createHarnessExtensionCall<TParams>(input: {
  extensionId: string;
  extensionVersion: number;
  method: string;
  operationId: string;
  idempotencyKey: string;
  params: TParams;
}): HarnessExtensionCallEnvelope<TParams> {
  harnessExtensionMethodName(
    input.extensionId,
    input.extensionVersion,
    input.method,
  );
  if (!input.operationId.trim()) {
    throw new Error('Extension operation id is required.');
  }
  if (!input.idempotencyKey.trim()) {
    throw new Error('Extension idempotency key is required.');
  }
  return {
    protocol: REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL,
    extensionId: input.extensionId,
    extensionVersion: input.extensionVersion,
    method: input.method,
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    params: input.params,
  };
}
