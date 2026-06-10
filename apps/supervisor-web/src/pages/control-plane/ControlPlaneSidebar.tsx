import type { ReactNode } from 'react';

export function ControlPlaneSidebar({ children }: { children: ReactNode }) {
  return <aside className="control-explorer-panel">{children}</aside>;
}
