import { createContext, useContext } from 'react';

interface AppShellNavContextValue {
  navOpen: boolean;
  openNav: () => void;
  toggleNav: () => void;
  closeNav: () => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export const AppShellNavContext = createContext<AppShellNavContextValue | null>(
  null,
);

export function useAppShellNav() {
  return useContext(AppShellNavContext);
}
