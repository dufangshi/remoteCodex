import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  AppShellMenuButton,
  AppShellNavigationMenu,
} from './AppShellNavigation';
import { RelayUserMenu } from './RelayUserMenu';

export function ProductHeader({
  title,
  backHref,
  backLabel,
  actions,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="product-topbar product-navigation">
      <div className="relative shrink-0">
        <AppShellMenuButton className="!h-11 !w-11" />
        <AppShellNavigationMenu className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-64" />
      </div>
      {backHref && (
        <Link
          to={backHref}
          aria-label={backLabel ?? 'Back'}
          title={backLabel ?? 'Back'}
          className="product-icon-button"
        >
          <ArrowLeft size={19} />
        </Link>
      )}
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
        {title}
      </h1>
      {actions}
      <RelayUserMenu
        className="[&>button]:!h-11 [&>button]:!w-11"
        menuAlign="right"
      />
    </header>
  );
}
