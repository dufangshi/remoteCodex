import { test, expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';
import { createServer } from 'node:net';

// Independent RFC 6238 fixture generator, never a production authentication path.
function otp(secret: string, nextWindow = false) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.toUpperCase()]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((v) => parseInt(v, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(Math.floor(Date.now() / 30000) + Number(nextWindow)),
  );
  const digest = createHmac('sha1', bytes).update(counter).digest(),
    offset = digest[19]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    '0',
  );
}
async function json(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    },
    { path, method, body },
  );
}

test('authenticator and passkey enrollment, new-browser challenge and trusted-browser login', async ({
  browser,
  context,
}) => {
  // Includes several real password KDFs in a debug Rust build, plus both factor enrollment flows.
  test.setTimeout(180_000);
  const root = await mkdtemp(resolve('.local/mfa-regression-'));
  const port = await new Promise<number>((done) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });
  const base = `http://localhost:${port}`,
    password = randomBytes(24).toString('hex');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('REMOTE_CODEX_'),
    ),
  );
  const proc = spawn(resolve('target/debug/remote-codex'), ['relay'], {
    env: {
      ...env,
      HOST: '127.0.0.1',
      PORT: String(port),
      REMOTE_CODEX_RELAY_DATA_DIR: join(root, 'relay'),
      REMOTE_CODEX_RELAY_WEB_DIST_DIR: resolve('apps/supervisor-web/dist'),
      REMOTE_CODEX_PUBLIC_BASE_URL: base,
      REMOTE_CODEX_ADMIN_USERNAME: 'testadmin',
      REMOTE_CODEX_ADMIN_PASSWORD: password,
      REMOTE_CODEX_RELAY_SESSION_SECRET: randomBytes(32).toString('hex'),
      REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let startupError = '';
  proc.stderr?.on('data', (chunk) => {
    startupError += chunk.toString();
  });
  proc.stdout?.on('data', (chunk) => {
    startupError += chunk.toString();
  });
  try {
    await expect
      .poll(() =>
        (proc.exitCode !== null
          ? Promise.reject(
              new Error(startupError || `relay exited ${proc.exitCode}`),
            )
          : fetch(`http://127.0.0.1:${port}/healthz`)
        )
          .then((r) => r.status)
          .catch((error) => {
            if (proc.exitCode !== null) throw error;
            return 0;
          }),
      )
      .toBe(200);
    const registered = await fetch(`${base}/relay/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'mfaowner',
        email: 'mfa@example.test',
        password,
      }),
    });
    expect(registered.status).toBe(200);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto(`${base}/relay-portal`);
    const firstLogin = await json(page, '/relay/auth/login', 'POST', {
      username: 'mfaowner',
      password,
    });
    expect(firstLogin.status).toBe(200);
    expect(firstLogin.data.challengeRequired).toBeUndefined();
    await page.goto(`${base}/relay-account`);
    const enrollmentResponse = page.waitForResponse((r) =>
      r.url().endsWith('/security/authenticator/enroll'),
    );
    await page.getByRole('button', { name: 'Set up', exact: true }).click();
    const enrollment = await (await enrollmentResponse).json();
    expect(enrollment.secret).toMatch(/^[A-Z2-7]+$/);
    await expect(
      page.getByAltText('Authenticator setup QR code'),
    ).toBeVisible();
    await page
      .getByLabel('Setup verification code')
      .fill(otp(enrollment.secret));
    const enabledResponse = page.waitForResponse((r) =>
      r.url().endsWith('/authenticator/confirm'),
    );
    await page
      .getByRole('button', { name: 'Enable authenticator', exact: true })
      .click();
    const recoveryCodes = (await (await enabledResponse).json())
      .recoveryCodes as string[];
    await expect(
      page.getByRole('region', { name: 'Save recovery codes' }),
    ).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    expect((await download).suggestedFilename()).toBe(
      'remote-codex-recovery-codes.txt',
    );
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('button', { name: 'Add passkey', exact: true })
      .click();
    await page.getByLabel('Passkey name', { exact: true }).fill('Test passkey');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Test passkey', { exact: true })).toBeVisible();
    expect(
      (await json(page, '/relay/account/security')).data.passkeys,
    ).toHaveLength(1);

    await json(page, '/relay/auth/logout', 'POST');
    const challenge = await json(page, '/relay/auth/login', 'POST', {
      username: 'mfaowner',
      password,
    });
    expect(challenge.data.challengeRequired).toBe(true);
    expect(challenge.data.token).toBeUndefined();
    expect((await json(page, '/relay/account/security')).status).toBe(401);
    await page.goto(`${base}/relay-portal`);
    await expect(
      page.getByRole('heading', { name: 'Verify it’s you' }),
    ).toBeVisible();
    await page.screenshot({
      path: resolve(
        `.local/security-audit/mfa-${test.info().project.name}.png`,
      ),
    });
    await page.reload();
    await page.evaluate(() => {
      navigator.credentials.get = async () => {
        throw new DOMException('Cancelled', 'NotAllowedError');
      };
    });
    await page
      .getByRole('button', { name: 'Use a passkey', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText('cancelled');
    await expect(
      page.getByLabel('Authenticator code', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole('button', { name: 'Use a passkey', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await json(page, '/relay/auth/session')).data.authenticated,
      )
      .toBe(true);
    await page.goto(`${base}/relay-account`);
    expect(
      (await json(page, '/relay/account/security')).data.trustedBrowsers,
    ).toHaveLength(1);
    await json(page, '/relay/auth/logout', 'POST');
    const trustedLogin = await json(page, '/relay/auth/login', 'POST', {
      username: 'mfaowner',
      password,
    });
    expect(trustedLogin.data.challengeRequired).toBeUndefined();
    expect(trustedLogin.data.session.authenticated).toBe(true);
    expect(
      (await json(page, '/relay/account/security')).data.recentlyVerified,
    ).toBe(false);
    expect(
      await page.evaluate(() =>
        localStorage.getItem('remote-codex-relay-token'),
      ),
    ).toBeNull();

    const fresh = await browser.newContext({
      viewport: page.viewportSize()!,
      isMobile: test.info().project.name.startsWith('mobile'),
    });
    try {
      const another = await fresh.newPage();
      await another.goto(`${base}/relay-portal`);
      const otherLogin = await json(another, '/relay/auth/login', 'POST', {
        username: 'mfaowner',
        password,
      });
      expect(otherLogin.data.challengeRequired).toBe(true);
      await another.reload();
      await another.getByLabel('Trust this browser for 30 days').uncheck();
      await another
        .getByLabel('Authenticator code', { exact: true })
        .fill(otp(enrollment.secret, true));
      await another
        .getByRole('button', { name: 'Verify', exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await json(another, '/relay/auth/session')).data.authenticated,
        )
        .toBe(true);
      const security = (await json(another, '/relay/account/security')).data;
      expect(security.trustedBrowsers).toHaveLength(1);
      await another.goto(`${base}/relay-account`);
      await another
        .getByRole('button', { name: 'Revoke', exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await json(another, '/relay/account/security')).data
              .trustedBrowsers.length,
        )
        .toBe(0);
      expect((await json(page, '/relay/account/security')).status).toBe(401);
      const revokedLogin = await json(page, '/relay/auth/login', 'POST', {
        username: 'mfaowner',
        password,
      });
      expect(revokedLogin.data.challengeRequired).toBe(true);
      expect(
        (
          await json(page, '/relay/auth/challenge', 'POST', {
            code: otp(enrollment.secret, true),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await json(page, '/relay/auth/challenge', 'POST', {
            code: recoveryCodes[0],
            rememberBrowser: true,
          })
        ).status,
      ).toBe(200);
      const recovered = (await json(page, '/relay/account/security')).data;
      expect(recovered.trustedBrowsers).toHaveLength(0);
      expect(recovered.recoveryCodesRemaining).toBe(9);
      expect((await json(another, '/relay/account/security')).status).toBe(401);
      await json(page, '/relay/auth/logout', 'POST');
      await json(page, '/relay/auth/login', 'POST', {
        username: 'mfaowner',
        password,
      });
      expect(
        (
          await json(page, '/relay/auth/challenge', 'POST', {
            code: recoveryCodes[0],
          })
        ).status,
      ).toBe(400);
      await page.goto(`${base}/relay-portal`);
      await page
        .getByRole('button', { name: 'Back to sign in', exact: true })
        .click();
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Verify it’s you' }),
      ).toHaveCount(0);
    } finally {
      await fresh.close();
    }
    // Exercise management controls, rather than only checking that they render.
    await json(page, '/relay/auth/login', 'POST', {
      username: 'mfaowner',
      password,
    });
    expect(
      (
        await json(page, '/relay/auth/challenge', 'POST', {
          code: recoveryCodes[1],
        })
      ).status,
    ).toBe(200);
    await page.goto(`${base}/relay-account`);
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByLabel('Rename passkey', { exact: true }).fill('My phone');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('My phone', { exact: true })).toBeVisible();
    await page.screenshot({
      path: resolve(
        `.local/security-audit/security-management-${test.info().project.name}.png`,
      ),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Generate new codes', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Save recovery codes' }),
    ).toBeVisible();
    const regenerated = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await regenerated;
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    expect(
      (await json(page, '/relay/account/security')).data.recoveryCodesRemaining,
    ).toBe(10);
    // Recent login/enrollment must not bypass a fresh password-change verification.
    const changedPassword = `${password}-changed`;
    expect(
      (
        await json(page, '/relay/account/password', 'PATCH', {
          currentPassword: password,
          newPassword: changedPassword,
        })
      ).status,
    ).toBe(403);
    await expect(
      page.getByLabel('Current password', { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Change password', exact: true })
      .click();
    const passwordDialog = page.getByRole('dialog', {
      name: 'Change password',
      exact: true,
    });
    await passwordDialog
      .getByLabel('Current password', { exact: true })
      .fill(password);
    await passwordDialog
      .getByLabel('New password', { exact: true })
      .fill(changedPassword);
    await passwordDialog
      .getByLabel('Confirm new password', { exact: true })
      .fill(changedPassword);
    await passwordDialog
      .getByRole('button', { name: 'Change password', exact: true })
      .click();
    const verification = page.getByRole('dialog', {
      name: 'Verify your identity',
      exact: true,
    });
    await expect(verification).toBeVisible();
    await verification.getByRole('button', { name: 'Use a passkey' }).click();
    await expect(
      page.getByText('Password changed.', { exact: true }),
    ).toBeVisible();
    await expect(passwordDialog).toHaveCount(0);
    expect(
      (
        await json(page, '/relay/account/password', 'PATCH', {
          currentPassword: changedPassword,
          newPassword: `${changedPassword}-again`,
        })
      ).status,
    ).toBe(403);
    await page
      .getByRole('button', { name: 'Remove My phone', exact: true })
      .click();
    await expect(page.getByText('My phone', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Set up', exact: true }),
    ).toBeVisible();
    expect(
      (await json(page, '/relay/account/security')).data.authenticatorEnabled,
    ).toBe(false);
    await json(page, '/relay/auth/logout', 'POST');
    const admin = await json(page, '/relay/auth/login', 'POST', {
      username: 'testadmin',
      password,
    });
    expect(admin.data.session.user.role).toBe('admin');
    await page.goto(`${base}/relay-admin?tab=security`);
    const adminEnrollmentResponse = page.waitForResponse((r) =>
      r.url().endsWith('/authenticator/enroll'),
    );
    await page.getByRole('button', { name: 'Set up', exact: true }).click();
    const adminEnrollment = await (await adminEnrollmentResponse).json();
    await page
      .getByLabel('Setup verification code')
      .fill(otp(adminEnrollment.secret));
    await page
      .getByRole('button', { name: 'Enable authenticator', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Save recovery codes' }),
    ).toBeVisible();
    expect((await json(page, '/relay/account/security')).status).toBe(401);
  } finally {
    if (test.info().status !== test.info().expectedStatus)
      console.error(
        'Isolated relay startup:',
        startupError.replaceAll(password, '[redacted]'),
      );
    await context.close();
    await new Promise<void>((done) => {
      if (proc.exitCode !== null) return done();
      proc.once('exit', () => done());
      proc.kill('SIGTERM');
      const timer = setTimeout(() => proc.kill('SIGKILL'), 2000);
      timer.unref();
    });
    await rm(root, { recursive: true, force: true });
  }
});
