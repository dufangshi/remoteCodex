import type { ReactNode } from 'react';

export function ControlPlaneShell({
  topBar,
  alerts,
  children,
  sidebar,
  main,
  inspector,
  inspectorOpen,
}: {
  topBar: ReactNode;
  alerts: ReactNode;
  children?: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
  inspector: ReactNode;
  inspectorOpen: boolean;
}) {
  const gridChildren = children ?? (
    <>
      {sidebar}
      <main className="control-main-column">{main}</main>
      <button
        type="button"
        className="control-inspector-scrim"
        aria-hidden="true"
        tabIndex={-1}
      />
      {inspector}
    </>
  );

  return (
    <div className="control-plane-console">
      {topBar}
      <div className="control-alert-stack">{alerts}</div>
      <div className={`control-console-grid ${inspectorOpen ? 'inspector-open' : 'inspector-collapsed'}`}>
        {gridChildren}
      </div>
    </div>
  );
}
