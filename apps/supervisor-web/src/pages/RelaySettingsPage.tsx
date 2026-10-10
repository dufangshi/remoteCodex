import { translate, useI18n } from '@pockymoe/thread-ui/i18n';
import { useEffect } from 'react';

import { useAppShellNav } from '../components/AppShellNavContext';

export function RelaySettingsPage() {
  useI18n();
  const shellNav = useAppShellNav();

  useEffect(() => {
    shellNav?.openSettings();
  }, [shellNav]);

  return (
    <div className="sr-only" data-testid="relay-settings-page">
      {translate("settings.settings")}</div>
  );
}
