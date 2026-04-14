import { createContext, useContext } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

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
}

export const AppShellNavContext = createContext<AppShellNavContextValue | null>(
  null,
);

export function useAppShellNav() {
  return useContext(AppShellNavContext);
}
