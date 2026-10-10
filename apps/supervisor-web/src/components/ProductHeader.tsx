import { translate, useI18n } from '@pockymoe/thread-ui/i18n';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  AppShellMenuButton,
  AppShellNavigationMenu,
} from './AppShellNavigation';
import { relayModeActive } from '../lib/api';
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
  useI18n();
  return (
    <div className="product-navigation-space">
      <header className="product-topbar product-navigation">
        {relayModeActive() ? <RelayUserMenu className="[&>button]:!h-11 [&>button]:!w-11" /> : <div className="relative shrink-0">
          <AppShellMenuButton className="!h-11 !w-11" />
          <AppShellNavigationMenu className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-64" />
        </div>}
        {backHref && (
          <Link
            to={backHref}
            aria-label={backLabel ?? translate("workbench.back")}
            title={backLabel ?? translate("workbench.back")}
            className="product-icon-button"
          >
            <ArrowLeft size={19} />
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
          {title}
        </h1>
        {actions}

      </header>
    </div>
  );
}
