/**
 * session.ts — Login/cookie manager and auth command handler (§5.5)
 */

import chalk from 'chalk';
import {
  saveCookies,
  loadCookies,
  saveCredentials,
  loadCredentials,
  clearAuth,
  isAuthFresh,
} from '../lib/auth-store.js';
import { runAuthFlow } from '../templates/auth-template.js';
import { loadFlow, getFlowDir } from './list.js';
import { chromium } from 'playwright';
import { join } from 'path';

/** Save current browser session cookies for a flow */
export async function authSave(flowName: string): Promise<void> {
  const flow = loadFlow(flowName);
  if (!flow) {
    console.error(chalk.red(`❌ Flow "${flowName}" not found.`));
    process.exit(1);
  }

  // Launch browser, navigate to the flow's URL, and save cookies
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(flow.metadata.url);
  const cookies = await context.cookies();
  await browser.close();

  saveCookies(flowName, cookies as unknown as Record<string, unknown>[]);
  console.log(chalk.green(`✅ Cookies saved for flow "${flowName}".`));
}

/** Refresh auth by re-running the login flow */
export async function authRefresh(flowName: string): Promise<void> {
  const flow = loadFlow(flowName);
  if (!flow) {
    console.error(chalk.red(`❌ Flow "${flowName}" not found.`));
    process.exit(1);
  }

  await runAuthFlow(flowName, flow.metadata.url);
  console.log(chalk.green(`✅ Auth refreshed for flow "${flowName}".`));
}

/** Clear stored auth data for a flow */
export function authClear(flowName: string): void {
  clearAuth(flowName);
  console.log(chalk.green(`✅ Auth cleared for flow "${flowName}".`));
}

/** Store username/password credentials */
export function authSetCreds(
  flowName: string,
  username: string,
  password: string
): void {
  const existing = loadCredentials(flowName) ?? {};
  saveCredentials(flowName, { ...existing, username, password });
  console.log(chalk.green(`✅ Credentials saved for flow "${flowName}".`));
}

/** Store a TOTP secret for MFA */
export function authSetTotp(flowName: string, secret: string): void {
  const existing = loadCredentials(flowName) ?? {};
  saveCredentials(flowName, { ...existing, totpSecret: secret });
  console.log(chalk.green(`✅ TOTP secret saved for flow "${flowName}".`));
}

/** Resume an MFA-paused flow by providing an OTP code */
export async function resumeMfa(code: string): Promise<void> {
  // The resume handler writes the code to a known IPC file
  const { writeFileSync } = await import('fs');
  writeFileSync(join(process.env['HOME'] ?? '~', '.openclaw', 'browser-auto', 'mfa-code.txt'), code, 'utf8');
  console.log(chalk.green(`✅ MFA code submitted.`));
}
