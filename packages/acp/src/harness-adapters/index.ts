import { cursorAcpHarnessAdapter } from './cursor';
import { codexAcpHarnessAdapter } from './codex';
import { deepseekAcpHarnessAdapter } from './deepseek';
import { grokAcpHarnessAdapter } from './grok';
import { standardAcpHarnessAdapter } from './standard';
import type { AcpHarnessAdapter } from './types';

const adapters = new Map<string, AcpHarnessAdapter>([
  [grokAcpHarnessAdapter.id, grokAcpHarnessAdapter],
  [cursorAcpHarnessAdapter.id, cursorAcpHarnessAdapter],
  [codexAcpHarnessAdapter.id, codexAcpHarnessAdapter],
  [deepseekAcpHarnessAdapter.id, deepseekAcpHarnessAdapter],
]);

export function acpHarnessAdapterFor(agentId: string | null | undefined) {
  return adapters.get(agentId ?? '') ?? standardAcpHarnessAdapter;
}

export * from './cursor';
export * from './codex';
export * from './deepseek';
export * from './effort';
export * from './grok';
export * from './standard';
export * from './types';
