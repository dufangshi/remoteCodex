import { createContext, useContext } from 'react';

interface AppShellNavContextValue {
  toggleNav: () => void;
  closeNav: () => void;
}

export const AppShellNavContext = createContext<AppShellNavContextValue | null>(
  null,
);

export function useAppShellNav() {
  return useContext(AppShellNavContext);
}
