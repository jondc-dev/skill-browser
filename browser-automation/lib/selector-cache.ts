/**
 * selector-cache.ts — Cache which selector strategy worked per step
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SelectorCacheEntry } from './step-types.js';

/** Load the selector cache for a flow */
export function loadSelectorCache(flowDir: string): SelectorCacheEntry[] {
  const file = join(flowDir, '.selector-cache.json');
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SelectorCacheEntry[];
  } catch {
    return [];
  }
}

/** Save the selector cache for a flow */
export function saveSelectorCache(
  flowDir: string,
  cache: SelectorCacheEntry[]
): void {
  const file = join(flowDir, '.selector-cache.json');
  writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
}

/** Record a successful selector for a step */
export function recordSelectorSuccess(
  flowDir: string,
  stepIndex: number,
  selector: string,
  strategy: SelectorCacheEntry['strategy']
): void {
  const cache = loadSelectorCache(flowDir);
  const existing = cache.find((e) => e.stepIndex === stepIndex);

  if (existing) {
    if (existing.winningSelector === selector) {
      existing.successCount++;
      existing.lastUsed = new Date().toISOString();
    } else {
      // New winning selector for this step
      existing.winningSelector = selector;
      existing.strategy = strategy;
      existing.successCount = 1;
      existing.lastUsed = new Date().toISOString();
    }
  } else {
    cache.push({
      stepIndex,
      winningSelector: selector,
      strategy,
      successCount: 1,
      lastUsed: new Date().toISOString(),
    });
  }

  saveSelectorCache(flowDir, cache);
}

/** Get the cached selector for a step, or null if not cached */
export function getCachedSelector(
  flowDir: string,
  stepIndex: number
): SelectorCacheEntry | null {
  const cache = loadSelectorCache(flowDir);
  return cache.find((e) => e.stepIndex === stepIndex) ?? null;
}
