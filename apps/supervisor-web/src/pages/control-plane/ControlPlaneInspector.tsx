import type { ReactNode } from 'react';

export function ControlPlaneInspector({
  eyebrow,
  hidden,
  onClose,
  children,
}: {
  eyebrow: string;
  hidden: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className="control-right-column" aria-hidden={hidden}>
      <section className="control-panel control-inspector-panel">
        <div className="control-panel-heading">
          <h2>Inspector</h2>
          <span>{eyebrow}</span>
          <button
            type="button"
            className="control-inline-icon-button"
            onClick={onClose}
            aria-label="Close details inspector"
          >
            x
          </button>
        </div>
        {children}
      </section>
    </aside>
  );
}
