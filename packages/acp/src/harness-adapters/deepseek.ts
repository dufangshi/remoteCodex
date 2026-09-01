import type { AcpHarnessAdapter } from './types';

// Current DeepSeek Harness releases expose their control surface through the
// shipped `dsh --profile acp` standard ACP v1 profile. Keep a named adapter so
// future verified gaps have one owner, but do not invent extensions today.
export const deepseekAcpHarnessAdapter: AcpHarnessAdapter = {
  id: 'deepseek',
};
