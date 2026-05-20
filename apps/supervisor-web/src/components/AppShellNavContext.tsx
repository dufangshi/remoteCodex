import { createContext, useContext } from 'react';

import type { AgentBackendIdDto } from '../../../../packages/shared/src/index';

export type ThemeMode = 'system' | 'light' | 'dark';
export type AgentBackendId = AgentBackendIdDto;

interface AppShellNavContextValue {
  navOpen: boolean;
  openNav: () => void;
  toggleNav: () => void;
  closeNav: () => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  effectiveTheme: 'light' | 'dark';
  defaultBackend: AgentBackendId;
  setDefaultBackend: (backend: AgentBackendId) => void;
}

export const AppShellNavContext = createContext<AppShellNavContextValue | null>(
  null,
);

export function useAppShellNav() {
  return useContext(AppShellNavContext);
}
