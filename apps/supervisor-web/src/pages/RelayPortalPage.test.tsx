import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RelayRegistrationSettingsDto } from '@remote-codex/shared';
import { RelayPortalPage } from './RelayPortalPage';

const baseSettings: RelayRegistrationSettingsDto = {
  enabled: true,
  approvalRequired: false,
  googleAuthEnabled: false,
  githubAuthEnabled: false,
  emailVerificationEnabled: false,
  googleAuthAvailable: false,
  githubAuthAvailable: false,
  emailVerificationAvailable: false,
};

function renderPortal(settings: RelayRegistrationSettingsDto) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              authenticated: false,
              user: null,
              registrationEnabled: true,
              registrationSettings: settings,
            }),
        }) as Response,
    ),
  );

  render(
    <MemoryRouter initialEntries={['/relay-portal']}>
      <Routes>
        <Route path="/relay-portal" element={<RelayPortalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RelayPortalPage registration password compatibility', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'uses the public configured flag without exposing the password',
      settings: { ...baseSettings, registrationPasswordConfigured: true },
      required: true,
    },
    {
      name: 'lets the configured flag override a legacy password field',
      settings: {
        ...baseSettings,
        registrationPasswordConfigured: false,
        registrationPassword: 'legacy-secret',
      },
      required: false,
    },
    {
      name: 'falls back to the legacy Node password field',
      settings: { ...baseSettings, registrationPassword: 'legacy-secret' },
      required: true,
    },
  ])('$name', async ({ settings, required }) => {
    renderPortal(settings);

    fireEvent.click(await screen.findByRole('tab', { name: 'Create account' }));

    const input = screen.getByLabelText(
      required ? 'Registration code' : 'Registration code (if required)',
    );
    if (required) {
      expect(input).toBeRequired();
    } else {
      expect(input).not.toBeRequired();
    }
  });
});
