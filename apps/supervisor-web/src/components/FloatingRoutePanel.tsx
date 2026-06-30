import type { ReactNode } from 'react';

interface FloatingRoutePanelProps {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  maxWidthClassName?: string;
}

export function FloatingRoutePanel({
  eyebrow,
  title,
  description,
  children,
  maxWidthClassName = 'max-w-2xl',
}: FloatingRoutePanelProps) {
  return (
    <div className="flex min-h-[calc(100vh-2rem)] items-start justify-center py-[calc(env(safe-area-inset-top)+3.75rem)] sm:items-center sm:py-[calc(env(safe-area-inset-top)+2rem)]">
      <section
        className={`host-panel w-full ${maxWidthClassName} overflow-hidden rounded-[1.6rem] border shadow-2xl`}
      >
        <header className="border-b border-[var(--theme-border)] px-5 py-4 sm:px-6">
          <p className="host-page-eyebrow text-xs uppercase tracking-[0.22em]">{eyebrow}</p>
          <h1 className="host-page-title mt-2 text-xl font-semibold tracking-normal sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="host-page-description mt-2 max-w-2xl text-sm leading-6">
              {description}
            </p>
          ) : null}
        </header>
        <div className="px-5 py-5 sm:px-6">{children}</div>
      </section>
    </div>
  );
}
