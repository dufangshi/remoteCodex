import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import type {
  RelayAccessGrantDto,
  RelayDeviceDto,
  RelayPortalSummaryDto,
  RelaySessionDto,
  RelaySessionShareDto,
  RelayUserDto,
} from '../packages/shared/src/index';

const now = '2026-09-03T12:00:00.000Z';
const relayModeKey = 'remote-codex-relay-mode';
const relayTokenKey = 'remote-codex-relay-token';
const relayReturnToKey = 'remote-codex-relay-return-to';

const relayUser = {
  id: 'relay-user-1',
  email: 'operator@example.test',
  username: 'operator',
  role: 'user',
  enabled: true,
  createdAt: now,
} satisfies RelayUserDto;

const ownedDevice = {
  id: 'device-owned',
  ownerUserId: relayUser.id,
  name: 'Studio Mac',
  token: 'relay-device-token',
  tokenPreview: 'rcx_dev_...studio',
  connected: true,
  connectedAt: now,
  lastHeartbeatAt: now,
  createdAt: now,
  hostedStatus: null,
} satisfies RelayDeviceDto;

const incomingThreadShare = {
  id: 'share-incoming',
  ownerUserId: 'relay-user-2',
  ownerUsername: 'reviewer',
  targetUserId: relayUser.id,
  targetUsername: relayUser.username,
  deviceId: 'device-shared',
  deviceName: 'Review Mac',
  threadId: 'thread-incoming',
  threadTitle: 'Inbound review',
  workspaceId: 'workspace-shared',
  workspaceLabel: 'Shared project',
  label: 'Review access',
  threadAccess: 'read',
  workspaceAccess: 'read',
  createdAt: now,
  revokedAt: null,
  expiresAt: null,
  lastAccessedAt: null,
  lastAccessedByUsername: null,
  accessEvents: [],
} satisfies RelaySessionShareDto;

const outgoingThreadShare = {
  ...incomingThreadShare,
  id: 'share-outgoing',
  ownerUserId: relayUser.id,
  ownerUsername: relayUser.username,
  targetUserId: 'relay-user-3',
  targetUsername: 'collaborator',
  deviceId: ownedDevice.id,
  deviceName: ownedDevice.name,
  threadId: 'thread-outgoing',
  threadTitle: 'Outbound planning',
  workspaceId: 'workspace-owned',
  workspaceLabel: 'Owned project',
  label: 'Planning access',
} satisfies RelaySessionShareDto;

const incomingDeviceGrant = {
  id: 'grant-incoming',
  ownerUserId: 'relay-user-2',
  ownerUsername: 'reviewer',
  targetUserId: relayUser.id,
  targetUsername: relayUser.username,
  deviceId: 'device-shared',
  deviceName: 'Review Mac',
  scope: 'device',
  threadId: null,
  threadTitle: null,
  workspaceId: null,
  workspaceLabel: null,
  workspaceScope: 'all',
  workspaceIds: [],
  label: 'Shared review device',
  threadAccess: 'control',
  workspaceAccess: 'read',
  canCreateThreads: true,
  createdAt: now,
  revokedAt: null,
  expiresAt: null,
  lastAccessedAt: null,
  lastAccessedByUsername: null,
  accessEvents: [],
} satisfies RelayAccessGrantDto;

const outgoingDeviceGrant = {
  ...incomingDeviceGrant,
  id: 'grant-outgoing',
  ownerUserId: relayUser.id,
  ownerUsername: relayUser.username,
  targetUserId: 'relay-user-3',
  targetUsername: 'collaborator',
  deviceId: ownedDevice.id,
  deviceName: ownedDevice.name,
  label: 'Studio access',
} satisfies RelayAccessGrantDto;

function relaySession(authenticated: boolean): RelaySessionDto {
  return {
    authenticated,
    user: authenticated ? relayUser : null,
    registrationEnabled: false,
    registrationSettings: {
      enabled: false,
      registrationPassword: null,
      approvalRequired: false,
      googleAuthEnabled: false,
      githubAuthEnabled: false,
      emailVerificationEnabled: false,
      googleAuthAvailable: false,
      githubAuthAvailable: false,
      emailVerificationAvailable: false,
    },
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function portalSummary(
  devices: RelayDeviceDto[] = [ownedDevice],
): RelayPortalSummaryDto {
  return {
    user: relayUser,
    devices,
    sharedWithMe: [incomingThreadShare],
    sharedByMe: [outgoingThreadShare],
    sharedDevicesWithMe: [incomingDeviceGrant],
    sharedThreadsWithMe: [],
    grantsByMe: [outgoingDeviceGrant],
  };
}

async function installAuthenticatedDevicesMocks(
  page: Page,
  options: {
    portalInitiallyUnavailable?: boolean;
    failLogout?: boolean;
  } = {},
) {
  let devices = [ownedDevice];
  const deletedDeviceIds: string[] = [];
  const logoutRequests: unknown[] = [];
  let portalRequestCount = 0;
  let portalUnavailable = options.portalInitiallyUnavailable ?? false;

  await page.addInitScript(
    ({ modeKey, tokenKey }) => {
      window.localStorage.setItem(modeKey, 'true');
      window.localStorage.setItem(tokenKey, 'relay-ui-test-token');
      const trackedWindow = window as typeof window & {
        __relayNativeConfirmCalls: number;
      };
      trackedWindow.__relayNativeConfirmCalls = 0;
      window.confirm = () => {
        trackedWindow.__relayNativeConfirmCalls += 1;
        return false;
      };
    },
    { modeKey: relayModeKey, tokenKey: relayTokenKey },
  );

  await page.route('**/*', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/relay/auth/session') {
      return json(route, relaySession(true));
    }
    if (pathname === '/relay/portal') {
      portalRequestCount += 1;
      if (portalUnavailable) {
        return json(
          route,
          {
            code: 'service_unavailable',
            message: 'Initial portal request failed.',
          },
          503,
        );
      }
      return json(route, portalSummary(devices));
    }
    if (pathname === '/relay/auth/logout' && request.method() === 'POST') {
      logoutRequests.push(request.postDataJSON());
      if (options.failLogout) {
        return json(
          route,
          {
            code: 'service_unavailable',
            message: 'Logout failed for regression test.',
          },
          503,
        );
      }
      return json(route, relaySession(false));
    }
    if (
      pathname === `/relay/devices/${ownedDevice.id}` &&
      request.method() === 'DELETE'
    ) {
      deletedDeviceIds.push(ownedDevice.id);
      devices = devices.filter((device) => device.id !== ownedDevice.id);
      return json(route, { id: ownedDevice.id });
    }
    if (pathname.endsWith('/api/plugins')) {
      return json(route, []);
    }

    return route.continue();
  });

  return {
    deletedDeviceIds,
    logoutRequests,
    portalRequestCount: () => portalRequestCount,
    recoverPortal: () => {
      portalUnavailable = false;
    },
  };
}

async function installPortalLoginMocks(page: Page) {
  let authenticated = false;
  const loginRequests: Array<Record<string, unknown>> = [];

  await page.addInitScript(
    ({ modeKey, tokenKey, returnToKey }) => {
      window.localStorage.setItem(modeKey, 'true');
      window.localStorage.removeItem(tokenKey);
      window.sessionStorage.removeItem(returnToKey);
    },
    {
      modeKey: relayModeKey,
      tokenKey: relayTokenKey,
      returnToKey: relayReturnToKey,
    },
  );

  await page.route('**/*', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/relay/auth/session') {
      return json(route, relaySession(authenticated));
    }
    if (pathname === '/relay/auth/login' && request.method() === 'POST') {
      loginRequests.push(request.postDataJSON() as Record<string, unknown>);
      authenticated = true;
      return json(route, {
        token: 'relay-ui-test-token',
        session: relaySession(true),
      });
    }
    if (pathname === '/relay/portal') {
      return json(route, portalSummary());
    }
    if (pathname === `/relay/devices/${ownedDevice.id}/api/workspaces`) {
      return json(route, [
        {
          id: 'workspace-owned',
          hostId: ownedDevice.id,
          label: 'Owned project',
          absPath: '/tmp/owned-project',
          isFavorite: false,
          createdAt: now,
          lastOpenedAt: now,
        },
      ]);
    }
    if (pathname === `/relay/devices/${ownedDevice.id}/api/config/runtime`) {
      return json(route, {
        mode: 'relay',
        appName: 'Remote Codex',
        appVersion: 'e2e',
        environment: 'test',
        host: '127.0.0.1',
        port: 8788,
        workspaceRoot: '/tmp',
        authEnabled: true,
        relayEnabled: true,
      });
    }
    if (pathname.endsWith('/api/plugins')) {
      return json(route, []);
    }

    return route.continue();
  });

  return { loginRequests };
}

async function expectMinimumTouchTarget(locator: Locator, name: string) {
  await expect(locator, `${name} should be visible`).toBeVisible();
  const box = await locator.boundingBox();

  expect(box, `${name} should have a measurable hit area`).not.toBeNull();
  expect.soft(box!.width, `${name} should be at least 44px wide`).toBeGreaterThanOrEqual(44);
  expect.soft(box!.height, `${name} should be at least 44px tall`).toBeGreaterThanOrEqual(44);
}

async function expectMobileTouchTargets(
  isMobile: boolean,
  targets: Array<[name: string, locator: Locator]>,
) {
  if (!isMobile) {
    return;
  }

  for (const [name, locator] of targets) {
    await expectMinimumTouchTarget(locator, name);
  }
}

async function expectNoPageHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  expect.soft(dimensions.rootScrollWidth, 'document should not scroll horizontally').toBeLessThanOrEqual(
    dimensions.viewportWidth + 1,
  );
  expect.soft(dimensions.bodyScrollWidth, 'body should not scroll horizontally').toBeLessThanOrEqual(
    dimensions.viewportWidth + 1,
  );
}

async function signIn(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Email or username' }).fill('operator');
  await page.locator('input[name="password"]').fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe('relay product UI regressions', () => {
  test('relay product routes reflow across the target width matrix', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chromium',
      'One browser project is sufficient for the explicit viewport matrix.',
    );
    await installAuthenticatedDevicesMocks(page);

    for (const width of [320, 375, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const pathname of ['/', '/relay-guide', '/relay-devices', '/relay-account']) {
        await page.goto(pathname);
        await expect(page.locator('body')).toBeVisible();
        await expectNoPageHorizontalOverflow(page);
      }
    }
  });

  test('Devices keeps one shared panel and uses inline, menu, and product confirmation flows', async ({
    page,
  }, testInfo) => {
    const mocks = await installAuthenticatedDevicesMocks(page);

    await page.goto('/relay-devices');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Devices and shared sessions' }),
    ).toBeVisible();

    const tabCases = [
      { name: /Threads with me/, heading: 'Shared with me' },
      { name: /Devices with me/, heading: 'Shared devices' },
      { name: /Devices by me/, heading: 'Shared devices by me' },
      { name: /Threads by me/, heading: 'Shared threads by me' },
    ];
    for (const tabCase of tabCases) {
      const tab = page.getByRole('tab', { name: tabCase.name });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const panel = page.locator('[role="tabpanel"]');
      await expect(panel).toHaveCount(1);
      await expect(panel).toHaveAttribute('aria-labelledby', await tab.getAttribute('id'));
      await expect(panel.getByRole('heading', { name: tabCase.heading })).toBeVisible();
    }

    const devicesSection = page.locator('section[aria-labelledby="devices-heading"]');
    const addDevice = devicesSection.locator('button[aria-controls="add-device-form"]');
    await addDevice.click();
    const addForm = devicesSection.locator('#add-device-form');
    await expect(addForm).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    const deviceName = addForm.getByRole('textbox', { name: 'Device name' });
    const createToken = addForm.getByRole('button', { name: 'Create token' });
    const cancelAdd = addForm.getByRole('button', { name: 'Cancel' });
    await expect(createToken).toBeDisabled();

    const isMobile = Boolean(testInfo.project.use.isMobile);
    await expectMobileTouchTargets(isMobile, [
      ['relay account menu', page.getByRole('button', { name: 'Relay account menu for operator' })],
      ['relay home', page.getByRole('link', { name: 'Relay home' })],
      ['add device', addDevice],
      ['device name', deviceName],
      ['cancel add device', cancelAdd],
      ['create token', createToken],
      ...tabCases.map(
        (tabCase) =>
          [`${String(tabCase.heading)} tab`, page.getByRole('tab', { name: tabCase.name })] as [
            string,
            Locator,
          ],
      ),
    ]);
    await expectNoPageHorizontalOverflow(page);

    await cancelAdd.click();
    await expect(addForm).toHaveCount(0);

    const deviceRow = devicesSection.getByRole('article').filter({ hasText: ownedDevice.name });
    const connect = deviceRow.getByRole('button', { name: 'Connect' });
    const actionsTrigger = deviceRow.getByRole('button', {
      name: `More actions for ${ownedDevice.name}`,
    });
    await actionsTrigger.click();
    const actionsMenu = page.getByRole('menu', { name: `Actions for ${ownedDevice.name}` });
    const copyUnix = actionsMenu.getByRole('menuitem', {
      name: 'Copy setup for macOS/Linux',
    });
    const copyWindows = actionsMenu.getByRole('menuitem', {
      name: 'Copy setup for Windows',
    });
    const shareDevice = actionsMenu.getByRole('menuitem', { name: 'Share device' });
    const deleteDevice = actionsMenu.getByRole('menuitem', { name: 'Delete device' });
    await expect(copyUnix).toBeVisible();
    await expect(copyWindows).toBeVisible();
    await expect(shareDevice).toBeVisible();
    await expect(deleteDevice).toBeVisible();

    await expectMobileTouchTargets(isMobile, [
      ['connect device', connect],
      ['device actions', actionsTrigger],
      ['copy macOS/Linux setup', copyUnix],
      ['copy Windows setup', copyWindows],
      ['share device', shareDevice],
      ['delete device', deleteDevice],
    ]);
    await expectNoPageHorizontalOverflow(page);

    await deleteDevice.click();
    const confirmDialog = page.getByRole('dialog', { name: 'Delete relay device' });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toHaveAttribute('aria-modal', 'true');
    await expect(confirmDialog).toContainText(`Delete ${ownedDevice.name}?`);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __relayNativeConfirmCalls: number })
            .__relayNativeConfirmCalls,
      ),
    ).toBe(0);

    await page.keyboard.press('Escape');
    await expect(confirmDialog).toHaveCount(0);
    await expect(actionsTrigger).toBeFocused();

    await actionsTrigger.click();
    await expect(actionsMenu).toBeVisible();
    await deleteDevice.click();
    await expect(confirmDialog).toBeVisible();

    const confirmDelete = confirmDialog.getByRole('button', {
      name: 'Delete device',
      exact: true,
    });
    await expectMobileTouchTargets(isMobile, [
      ['close delete confirmation', confirmDialog.getByRole('button', { name: 'Close dialog' })],
      ['cancel delete confirmation', confirmDialog.getByRole('button', { name: 'Cancel' })],
      ['confirm delete device', confirmDelete],
    ]);
    await expectNoPageHorizontalOverflow(page);

    await confirmDelete.click();
    await expect(confirmDialog).toHaveCount(0);
    await expect(deviceRow).toHaveCount(0);
    expect(mocks.deletedDeviceIds).toEqual([ownedDevice.id]);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement !== document.body &&
            document.activeElement !== document.documentElement,
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __relayNativeConfirmCalls: number })
            .__relayNativeConfirmCalls,
      ),
    ).toBe(0);
  });

  test('Relay user menu stays open and shows an alert when logout fails', async ({
    page,
  }) => {
    const mocks = await installAuthenticatedDevicesMocks(page, {
      failLogout: true,
    });

    await page.goto('/relay-devices');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Devices and shared sessions' }),
    ).toBeVisible();

    const trigger = page.getByRole('button', {
      name: 'Relay account menu for operator',
    });
    await trigger.click();
    const menu = page.getByRole('menu');
    const logout = menu.getByRole('menuitem', { name: 'Log out' });
    await logout.click();

    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('alert')).toHaveText(
      'Logout failed for regression test.',
    );
    await expect(logout).toBeEnabled();
    expect(mocks.logoutRequests).toHaveLength(1);
    await expect(page).toHaveURL(/\/relay-devices$/);
  });

  test('Devices clears an initial portal error after a successful controlled retry', async ({
    page,
  }) => {
    const mocks = await installAuthenticatedDevicesMocks(page, {
      portalInitiallyUnavailable: true,
    });

    await page.goto('/relay-devices');
    const fatalError = page
      .getByRole('alert')
      .filter({ hasText: 'Initial portal request failed.' });
    await expect(fatalError).toBeVisible();
    const failedRequestCount = mocks.portalRequestCount();
    expect(failedRequestCount).toBeGreaterThan(0);

    mocks.recoverPortal();
    await page.waitForTimeout(50);
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );

    await expect.poll(mocks.portalRequestCount).toBeGreaterThan(failedRequestCount);
    await expect(
      page
        .locator('section[aria-labelledby="devices-heading"]')
        .getByRole('article')
        .filter({ hasText: ownedDevice.name }),
    ).toBeVisible();
    await expect(fatalError).toHaveCount(0);
  });

  test('Portal restores a safe returnTo deep link after login', async ({ page }, testInfo) => {
    const mocks = await installPortalLoginMocks(page);
    const returnTo = `/devices/${ownedDevice.id}/workspaces?workspaceId=workspace-owned#registry`;

    await page.goto(`/relay-portal?returnTo=${encodeURIComponent(returnTo)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await expectMobileTouchTargets(Boolean(testInfo.project.use.isMobile), [
      ['relay home', page.getByRole('link', { name: 'Relay home' })],
      ['relay guide', page.getByRole('link', { name: 'Guide' })],
      ['sign in tab', page.getByRole('tab', { name: 'Sign in' })],
      ['email or username', page.getByRole('textbox', { name: 'Email or username' })],
      ['password', page.locator('input[name="password"]')],
      ['show password', page.getByRole('button', { name: 'Show password' })],
      ['sign in', page.getByRole('button', { name: 'Sign in', exact: true })],
    ]);
    await expectNoPageHorizontalOverflow(page);
    await signIn(page);

    await expect(page).toHaveURL(new RegExp(`${returnTo.replace(/[?#]/g, '\\$&')}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();
    expect(mocks.loginRequests).toEqual([
      { identifier: 'operator', password: 'test-password' },
    ]);
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), relayReturnToKey)).toBeNull();
  });

  test('Portal rejects an external returnTo and falls back to Relay Devices', async ({
    page,
  }) => {
    const mocks = await installPortalLoginMocks(page);
    const maliciousReturnTo = '//attacker.example/steal-session';

    await page.goto(
      `/relay-portal?returnTo=${encodeURIComponent(maliciousReturnTo)}`,
    );
    await signIn(page);

    await expect(page).toHaveURL(/\/relay-devices$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Devices and shared sessions' }),
    ).toBeVisible();
    expect(page.url()).not.toContain('attacker.example');
    expect(mocks.loginRequests).toHaveLength(1);
  });

  test('Admin presents a compatibility state when the relay admin API returns 404', async ({
    page,
  }) => {
    await page.route('**/*', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/relay/auth/session') {
        return json(route, {
          authenticated: true,
          user: { ...relayUser, role: 'admin' },
          registrationEnabled: false,
        });
      }
      if (pathname === '/relay/admin') {
        return json(
          route,
          { code: 'not_found', message: 'Admin API is unavailable.' },
          404,
        );
      }
      if (pathname.endsWith('/api/plugins')) {
        return json(route, []);
      }
      return route.continue();
    });

    await page.goto('/relay-admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
    const compatibility = page.getByRole('status').filter({
      hasText: 'Admin API is not available',
    });
    await expect(compatibility).toBeVisible();
    await expect(compatibility).toContainText('HTTP 404');
    await expect(page.getByRole('heading', { name: 'Relay admin sign in' })).toHaveCount(0);
  });
});
