import { useEffect } from 'react';

import { useAppShellNav } from '../components/AppShellNavContext';

export function RelaySettingsPage() {
  const shellNav = useAppShellNav();

  useEffect(() => {
    shellNav?.openSettings();
  }, [shellNav]);

  return (
    <div className="sr-only" data-testid="relay-settings-page">
      Settings
    </div>
  );
}
