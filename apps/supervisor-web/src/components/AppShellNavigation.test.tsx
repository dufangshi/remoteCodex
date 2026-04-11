import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppShellNavContext } from './AppShellNavContext';
import {
  AppShellNavigationMenu,
  AppShellSettingsDialog,
} from './AppShellNavigation';

function NavigationHarness() {
  const [navOpen, setNavOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <AppShellNavContext.Provider
      value={{
        navOpen,
        openNav: () => setNavOpen(true),
        toggleNav: () => setNavOpen((current) => !current),
        closeNav: () => setNavOpen(false),
        settingsOpen,
        openSettings: () => {
          setNavOpen(false);
          setSettingsOpen(true);
        },
        closeSettings: () => setSettingsOpen(false),
      }}
    >
      <AppShellNavigationMenu />
      <AppShellSettingsDialog />
    </AppShellNavContext.Provider>
  );
}

describe('AppShellNavigation', () => {
  it('shows only workspaces and settings, with workspaces disabled on the workspaces route', () => {
    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Workspaces' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Threads' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Thread' })).not.toBeInTheDocument();
  });

  it('opens and closes the settings dialog from the shared navigation menu', () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Close Settings' })[0]!);

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
