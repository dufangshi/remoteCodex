import type { ReactNode } from 'react';

export function WorkspaceInfoCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="thread-workspace-card rounded-lg border p-3">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--theme-fg-muted)]">
        {label}
      </p>
      <div className="mt-2 text-sm text-[var(--theme-fg)]">{children}</div>
    </section>
  );
}
