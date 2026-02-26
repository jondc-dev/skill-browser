/**
 * auth-template.ts — Template for auth flow scripts with credential injection
 */

import { chromium, type Page } from 'playwright';
import { loadCredentials } from '../lib/auth-store.js';
import { saveCookies } from '../lib/auth-store.js';
import { totp } from 'otplib';

export interface AuthParams {
  flowName: string;
  loginUrl: string;
}

/**
 * Run the authentication flow for a given flow name.
 * Uses stored credentials; prompts for MFA if needed.
 */
export async function runAuthFlow(flowName: string, loginUrl: string): Promise<void> {
  const creds = loadCredentials(flowName);
  if (!creds) {
    throw new Error(
      `No credentials found for flow "${flowName}". ` +
        'Run: browser-auto auth set-creds <flow> --username <u> --password'
    );
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page: Page = await context.newPage();

  try {
    await page.goto(loginUrl, { waitUntil: 'networkidle' });

    // Fill username
    if (creds.username) {
      const userField = page.locator('[name=username],[name=email],[type=email]').first();
      await userField.fill(creds.username);
    }

    // Fill password
    if (creds.password) {
      const passField = page.locator('[type=password]').first();
      await passField.fill(creds.password);
      await passField.press('Enter');
    }

    await page.waitForLoadState('networkidle');

    // Handle TOTP MFA if applicable
    if (creds.totpSecret) {
      const mfaField = page
        .locator('[name=otp],[name=code],[name=mfa],[placeholder*=code i]')
        .first();
      const isVisible = await mfaField.isVisible().catch(() => false);
      if (isVisible) {
        const code = totp.generate(creds.totpSecret);
        await mfaField.fill(code);
        await mfaField.press('Enter');
        await page.waitForLoadState('networkidle');
      }
    }

    // Save cookies
    const cookies = await context.cookies();
    saveCookies(flowName, cookies as unknown as Record<string, unknown>[]);

    console.log(`✅ Auth flow completed for "${flowName}".`);
  } finally {
    await context.close();
    await browser.close();
  }
}
