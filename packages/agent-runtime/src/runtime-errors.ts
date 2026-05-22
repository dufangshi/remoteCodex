import { AgentRuntimeError } from './types';

export type TurnSteerRace =
  | { type: 'missing' }
  | { type: 'turnIdMismatch'; actualTurnId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : null;
}

function remoteErrorMessage(error: unknown) {
  if (error instanceof AgentRuntimeError) {
    return error.message;
  }
  return error instanceof Error ? error.message : null;
}

export function parseTurnSteerRace(error: unknown): TurnSteerRace | null {
  if (error instanceof AgentRuntimeError) {
    const raceType = stringField(error.details, 'turnSteerRace');
    if (raceType === 'missing') {
      return { type: 'missing' };
    }
    if (raceType === 'turnIdMismatch') {
      const actualTurnId = stringField(error.details, 'actualTurnId');
      if (actualTurnId) {
        return { type: 'turnIdMismatch', actualTurnId };
      }
    }
  }

  const message = remoteErrorMessage(error);
  if (!message) {
    return null;
  }

  if (message === 'no active turn to steer') {
    return { type: 'missing' };
  }

  const mismatchPrefix = 'expected active turn id `';
  const mismatchSeparator = '` but found `';
  if (!message.startsWith(mismatchPrefix)) {
    return null;
  }

  const actualTurnId = message
    .slice(mismatchPrefix.length)
    .split(mismatchSeparator)[1]
    ?.replace(/`$/, '');

  if (!actualTurnId) {
    return null;
  }

  return {
    type: 'turnIdMismatch',
    actualTurnId,
  };
}

export function isRuntimeRequestError(error: unknown) {
  return error instanceof AgentRuntimeError;
}

export function isRemoteThreadBootstrapError(error: unknown) {
  if (!(error instanceof AgentRuntimeError)) {
    return false;
  }

  return (
    error.message.includes('includeTurns is unavailable before first user message') ||
    error.message.includes('is not materialized yet') ||
    error.message.includes('no rollout found for thread id') ||
    error.message.includes('failed to load rollout') ||
    (error.message.includes('rollout at') && error.message.includes('is empty'))
  );
}

export function isUnsupportedHooksListError(error: unknown) {
  if (!(error instanceof AgentRuntimeError)) {
    return false;
  }

  const remoteCode = isRecord(error.details) ? error.details.code : null;
  const message = error.message.toLowerCase();
  return (
    remoteCode === -32601 ||
    message.includes('endpoint not found') ||
    message.includes('method not found') ||
    (message.includes('hooks/list') && message.includes('not found'))
  );
}
