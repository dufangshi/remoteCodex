import type { ReactNode } from 'react';

export function ControlPlaneTopBar({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions: ReactNode;
}) {
  return (
    <header className="control-console-header">
      <div className="control-titlebar-copy">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      <div className="control-header-actions">{actions}</div>
    </header>
  );
}
