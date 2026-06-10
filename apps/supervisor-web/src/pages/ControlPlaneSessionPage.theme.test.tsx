import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AppShellNavContext,
  type AppShellNavContextValue,
  type ThemeMode,
} from '@remote-codex/thread-ui';
import { ControlPlaneSessionPage } from './ControlPlaneSessionPage';

const threadDetailSurfaceMock = vi.hoisted(() => vi.fn());

vi.mock('@remote-codex/thread-ui', async () => {
  const React = await import('react');
  const AppShellNavContext = React.createContext<unknown>(null);

  return {
    AppShellNavContext,
    AppShellMenuButton: () => <button type="button">Open Navigation</button>,
    AppShellNavigationMenu: ({ children }: { children?: ReactNode }) => (
      <nav>{children}</nav>
    ),
    ThreadDetailSurface: (props: Record<string, unknown>) => {
      threadDetailSurfaceMock(props);
      return <div data-testid="thread-detail-surface" />;
    },
    formatLongTimestamp: (value: string) => value,
    threadStatusLabel: (value: string) => value,
    useAppShellNav: () => React.useContext(AppShellNavContext),
    usePlugins: () => ({
      plugins: [],
      renderArtifact: () => null,
    }),
  };
});

function renderWithShellNav(input: {
  themeMode: ThemeMode;
  effectiveTheme: 'light' | 'dark';
  setThemeMode?: (mode: ThemeMode) => void;
}) {
  const value: AppShellNavContextValue = {
    navOpen: false,
    openNav: () => {},
    toggleNav: () => {},
    closeNav: () => {},
    settingsOpen: false,
    openSettings: () => {},
    closeSettings: () => {},
    themeMode: input.themeMode,
    setThemeMode: input.setThemeMode ?? (() => {}),
    effectiveTheme: input.effectiveTheme,
    defaultBackend: 'codex',
    setDefaultBackend: () => {},
  };

  return render(
    <AppShellNavContext.Provider value={value}>
      <MemoryRouter initialEntries={['/control-plane/sessions/session-1']}>
        <Routes>
          <Route path="/control-plane/sessions/:sessionId" element={<ControlPlaneSessionPage />} />
          <Route path="/control-plane/login" element={<div>Login</div>} />
        </Routes>
      </MemoryRouter>
    </AppShellNavContext.Provider>,
  );
}

describe('ControlPlaneSessionPage theme integration', () => {
  beforeEach(() => {
    threadDetailSurfaceMock.mockClear();
    window.localStorage.clear();
    window.localStorage.setItem(
      'remote-codex-control-plane-auth',
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:8790',
        token: 'dev:dev-user',
      }),
    );
  });

  it('passes the app shell theme state into the embedded thread surface', () => {
    const setThemeMode = vi.fn();

    renderWithShellNav({
      themeMode: 'light',
      effectiveTheme: 'light',
      setThemeMode,
    });

    expect(screen.getByTestId('thread-detail-surface')).toBeInTheDocument();
    const latestProps = threadDetailSurfaceMock.mock.lastCall?.[0];

    expect(latestProps).toMatchObject({
      shellEffectiveTheme: 'light',
      shellThemeMode: 'light',
      onShellThemeModeChange: setThemeMode,
    });
  });
});
