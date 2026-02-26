/**
 * screenshot.ts — Step screenshot capture for debugging
 */

import { mkdirSync } from 'fs';
import { join } from 'path';
import type { Page } from 'playwright';

/** Capture a screenshot and return the relative file path */
export async function captureScreenshot(
  page: Page,
  screenshotsDir: string,
  label: string
): Promise<string> {
  mkdirSync(screenshotsDir, { recursive: true });

  const timestamp = Date.now();
  const safe = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safe}_${timestamp}.png`;
  const fullPath = join(screenshotsDir, filename);

  await page.screenshot({ path: fullPath, fullPage: false });

  return filename;
}

/** Capture a full-page screenshot */
export async function captureFullPageScreenshot(
  page: Page,
  screenshotsDir: string,
  label: string
): Promise<string> {
  mkdirSync(screenshotsDir, { recursive: true });

  const timestamp = Date.now();
  const safe = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safe}_full_${timestamp}.png`;
  const fullPath = join(screenshotsDir, filename);

  await page.screenshot({ path: fullPath, fullPage: true });

  return filename;
}
