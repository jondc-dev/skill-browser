/**
 * script-template.ts — Base template for generated Playwright scripts
 *
 * This file defines the structure that codegen.ts uses when generating
 * flow scripts. resilientLocator is the key utility for robust element finding.
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import { resilientLocator } from '../lib/retry.js';
import type { SelectorSet } from '../lib/step-types.js';

/** Override params type per-flow — this is replaced during codegen */
export interface Params {
  [key: string]: string;
}

/**
 * The run() function is the entry point for every generated script.
 * Codegen fills in the steps inside the try block.
 */
export async function run(params: Params = {} as Params): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context: BrowserContext = await browser.newContext();
  const page: Page = await context.newPage();

  try {
    // <<< GENERATED STEPS GO HERE >>>
    void params;
    void resilientLocator;
  } finally {
    await context.close();
    await browser.close();
  }
}

// Standalone execution
run().catch((err: Error) => {
  console.error('Flow failed:', err.message);
  process.exit(1);
});
