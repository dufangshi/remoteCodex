import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Optional Safari/WebKit security regression, independent of the Chromium suite.
export default defineConfig({
  ...base,
  testMatch: 'relay-encryption.spec.ts',
  projects: [
    { name: 'security-mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
