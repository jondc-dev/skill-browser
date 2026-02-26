/**
 * retry.ts — Per-step retry with exponential backoff and selector failover
 */

import type { Page } from 'playwright';
import type { RetryConfig, SelectorSet } from './step-types.js';
import { prioritizedSelectors } from './selector-engine.js';

/** Default retry configuration */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  backoffMs: 500,
  backoffMultiplier: 2,
  maxBackoffMs: 8000,
};

/** Sleep for the given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calculate the backoff delay for a given attempt */
export function calcBackoff(attempt: number, config: RetryConfig): number {
  const delay = config.backoffMs * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxBackoffMs);
}

/** Callback invoked when a step fails */
export type OnStepFail = (
  stepIndex: number,
  error: Error,
  attempt: number
) => 'retry' | 'skip' | 'abort';

/**
 * Execute a step function with per-step retry and exponential backoff.
 * onStepFail callback controls behavior: 'retry', 'skip', or 'abort'.
 */
export async function withRetry<T>(
  stepIndex: number,
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onStepFail?: OnStepFail
): Promise<T | null> {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < config.maxRetries) {
        const action = onStepFail?.(stepIndex, lastError, attempt) ?? 'retry';
        if (action === 'abort') throw lastError;
        if (action === 'skip') return null;

        const delay = calcBackoff(attempt, config);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * resilientLocator — try each selector strategy in priority order.
 * Returns the first Playwright Locator that resolves to a visible element.
 *
 * @param page     - Playwright Page instance
 * @param selectors - SelectorSet with multiple strategies
 * @param config   - Retry config
 */
export async function resilientLocator(
  page: Page,
  selectors: SelectorSet,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
) {
  const ordered = prioritizedSelectors(selectors);
  let lastError: Error = new Error('No selectors available');

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    for (const selector of ordered) {
      try {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: 5000 });
        return locator;
      } catch (_err) {
        // try next selector
      }
    }

    lastError = new Error(
      `No selector matched for step. Tried: ${ordered.join(', ')}`
    );

    if (attempt < config.maxRetries) {
      const delay = calcBackoff(attempt, config);
      await sleep(delay);
    }
  }

  throw lastError;
}
