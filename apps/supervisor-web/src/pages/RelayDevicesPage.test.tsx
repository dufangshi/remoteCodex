import { describe, expect, it } from 'vitest';

import type { RelaySessionShareDto } from '@remote-codex/shared';
import {
  relayShareTitleText,
  relayShareWorkspaceLabel,
} from './RelayDevicesPage';

const noWorkspaceShare = {
  threadTitle: 'Release planning',
  workspaceLabel: null,
  workspaceAccess: 'none',
  label: null,
} as RelaySessionShareDto;

describe('relay share labels', () => {
  it('keeps a view-only thread available when workspace access is disabled', () => {
    expect(relayShareTitleText(noWorkspaceShare)).toBe('Release planning');
    expect(relayShareWorkspaceLabel(noWorkspaceShare)).toBe(
      'No workspace access',
    );
  });

  it('uses a neutral thread fallback for legacy shares without metadata', () => {
    expect(
      relayShareTitleText({
        ...noWorkspaceShare,
        threadTitle: null,
      }),
    ).toBe('Shared thread');
  });
});
