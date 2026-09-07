import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShellNavContext } from '../components/AppShellNavContext';
import { RelaySettingsPage } from './RelaySettingsPage';

describe('RelaySettingsPage', () => {
  it('opens the shared AppShell settings dialog on mount', () => {
    const openSettings = vi.fn();
    render(
      <AppShellNavContext.Provider
        value={{
          navOpen: false,
          openNav: vi.fn(),
          toggleNav: vi.fn(),
          closeNav: vi.fn(),
          settingsOpen: false,
          openSettings,
          closeSettings: vi.fn(),
          themeMode: 'system',
          setThemeMode: vi.fn(),
          effectiveTheme: 'dark',
          defaultBackend: 'codex',
          setDefaultBackend: vi.fn(),
          autoCollapseCompletedTurns: true,
          setAutoCollapseCompletedTurns: vi.fn(),
        }}
      >
        <RelaySettingsPage />
      </AppShellNavContext.Provider>,
    );
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('relay-settings-page')).toHaveTextContent('Settings');
  });
});
